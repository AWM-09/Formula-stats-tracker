#!/usr/bin/env python3
"""Import FIA grid sanctions from Formula 2 and Formula 3 decision archives.

This importer scans the FIA document archives, not news stories. It only emits
records when a PDF explicitly states a grid drop, back-of-grid or pit-lane start.
The season archive list is attempted from each series' documented start year;
unavailable FIA archive years are retained as coverage gaps, not treated as zero.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "grid-penalties.json"
CURRENT_YEAR = datetime.now(timezone.utc).year
USER_AGENT = "FormulaStatsTracker/1.0 (independent motorsport statistics archive)"
MAX_PDFS_PER_SEASON = 90
SERIES_CONFIG = {
    "f2": {
        "label": "Formula 2",
        "first": 2017,
        "slug": "formula-2-championship-44",
        "alternate_slug": "formula-2-championship-44",
    },
    "f3": {
        "label": "Formula 3",
        "first": 2019,
        "slug": "fia-formula-3-championship-1012",
        "alternate_slug": "fia-formula-3-championship-1012",
    },
}
RELEVANT_TITLE = re.compile(
    r"\b(decision|summons|starting grid|final grid|provisional grid|"
    r"grid penalty|penalty|power unit|gearbox|back of the grid|offence|infringement)\b",
    re.I,
)
PENALTY_WORD = r"(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
GRID_PATTERNS = [
    re.compile(r"\b(" + PENALTY_WORD + r")\s*[- ]place\s+grid\s+penalt(?:y|ies)\b", re.I),
    re.compile(r"\b(?:grid|starting grid)\s+penalt(?:y|ies)\s+(?:of\s+)?(" + PENALTY_WORD + r")\s+(?:place|position)", re.I),
    re.compile(r"\b(?:drop|dropped|demoted|relegated)\s+(?:by\s+)?(" + PENALTY_WORD + r")\s+(?:grid\s+)?(?:places?|positions?)\b", re.I),
    re.compile(r"\b(" + PENALTY_WORD + r")\s+(?:grid\s+)?(?:places?|positions?)\s+penalt(?:y|ies)\b", re.I),
    re.compile(r"\bwill\s+be\s+dropped\s+(" + PENALTY_WORD + r")\s+places?\s+on\s+the\s+grid\b", re.I),
    re.compile(r"\b(" + PENALTY_WORD + r")\s+positions?\s+on\s+the\s+grid\b", re.I),
]
BACK_OF_GRID = re.compile(
    r"(?:penalt\w*|demot\w*|relegat\w*).{0,140}back\s+of\s+the\s+grid|"
    r"back\s+of\s+the\s+grid.{0,140}(?:penalt\w*|demot\w*|relegat\w*)|"
    r"required\s+to\s+start\s+from\s+the\s+back\s+of\s+the\s+grid",
    re.I | re.S,
)
PIT_LANE = re.compile(
    r"(?:required|instructed|ordered)\s+to\s+start\s+from\s+the\s+pit\s+lane|"
    r"start\s+from\s+the\s+pit\s+lane|pit lane start",
    re.I,
)
CAR_MARKER = re.compile(r"\bcar\s*#?\s*(\d{1,2})\b", re.I)
EVENT_RE = re.compile(r"\b([A-Z][A-Za-zÀ-ÿ'’ -]{2,50} Grand Prix)\b", re.I)


def read_url(url: str, accept: str = "*/*") -> bytes:
    request = Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )
    with urlopen(request, timeout=35) as response:
        return response.read()


def load_previous() -> dict:
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"penalties": [], "documents": [], "seriesCoverage": {}}


def season_urls(series: str, year: int) -> list[str]:
    cfg = SERIES_CONFIG[series]
    slug = cfg["slug"]

    # FIA Drupal document-season IDs are not a simple year offset. Use only
    # verified season IDs and the championship collection page for 2026.
    season_ids = {
        2019: 1106,
        2020: 1107,
        2021: 1108,
        2022: 2005,
        2023: 2042,
        2024: 2043,
        2025: 2071,
        2026: 2072,
    }
    candidates: list[str] = []

    if year == 2026:
        candidates.extend([
            f"https://www.fia.com/documents/championship/championships/{slug}",
            f"https://www.fia.com/documents/championships/{slug}/season/season-2026-2072",
            f"https://www.fia.com/documents/season/season-2026-2072/championships/{slug}",
        ])
    elif year in season_ids:
        season_id = season_ids[year]
        candidates.extend([
            f"https://www.fia.com/documents/championships/{slug}/season/season-{year}-{season_id}",
            f"https://www.fia.com/documents/season/season-{year}-{season_id}/championships/{slug}",
            f"https://www.fia.com/documents/championship/season/season-{year}-{season_id}/championships/{slug}",
        ])
    return candidates


def collect_page_documents(series: str, year: int) -> tuple[list[dict], str | None]:
    for page_url in season_urls(series, year):
        try:
            payload = read_url(page_url, "text/html,application/xhtml+xml")
            soup = BeautifulSoup(payload, "html.parser")
            documents: dict[str, dict] = {}
            for anchor in soup.find_all("a", href=True):
                href = urljoin(page_url, anchor["href"].strip())
                if ".pdf" not in href.lower():
                    continue
                if "fia.com" not in urlparse(href).netloc.lower():
                    continue
                title = " ".join(anchor.stripped_strings).strip()
                if not title:
                    title = str(anchor.get("title") or anchor.get("aria-label") or "").strip()
                if not RELEVANT_TITLE.search(title):
                    continue

                context_parts = [title]
                parent = anchor.parent
                for _ in range(3):
                    if parent is None:
                        break
                    context_parts.extend(parent.stripped_strings)
                    parent = parent.parent
                context = " ".join(dict.fromkeys(x for x in context_parts if x))
                published = None
                match = re.search(r"Published on\s+(\d{2}\.\d{2}\.\d{2})", context, re.I)
                if match:
                    try:
                        published = datetime.strptime(match.group(1), "%d.%m.%y").replace(
                            tzinfo=timezone.utc
                        ).isoformat(timespec="seconds").replace("+00:00", "Z")
                    except ValueError:
                        pass
                documents[href.split("?")[0]] = {
                    "series": series,
                    "season": year,
                    "title": title[:260] or f"{SERIES_CONFIG[series]['label']} FIA document",
                    "context": context[:1200],
                    "url": href,
                    "published": published,
                    "page": page_url,
                }
            if documents:
                values = sorted(
                    documents.values(),
                    key=lambda item: item.get("published") or "",
                    reverse=True,
                )
                print(f"{series.upper()} {year}: {len(values)} relevant FIA PDFs")
                return values[:MAX_PDFS_PER_SEASON], page_url
            # Page was reachable; record that it was checked even if no matching PDFs were visible.
            print(f"{series.upper()} {year}: FIA page reachable, no matching PDF links exposed")
            return [], page_url
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            print(f"{series.upper()} {year}: archive route unavailable ({page_url}): {error}", file=sys.stderr)
    return [], None


def pdf_text(payload: bytes) -> str:
    reader = PdfReader(io.BytesIO(payload), strict=False)
    pages = []
    for page in reader.pages[:6]:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            continue
    return re.sub(r"\s+", " ", " ".join(pages)).strip()


def parse_number(value: str) -> int | None:
    raw = value.lower()
    return NUMBER_WORDS.get(raw) if raw in NUMBER_WORDS else int(raw) if raw.isdigit() else None


def event_name(document: dict, text: str) -> str:
    for candidate in (text[:1800], document.get("context", ""), document.get("title", "")):
        match = EVENT_RE.search(candidate or "")
        if match:
            return " ".join(match.group(1).split()).title()
    title = document.get("title", "")
    # Common FIA event headings which do not always include "Grand Prix".
    for name in [
        "Melbourne", "Bahrain", "Jeddah", "Melbourne", "Monaco", "Barcelona",
        "Spielberg", "Silverstone", "Spa-Francorchamps", "Budapest", "Zandvoort",
        "Monza", "Baku", "Singapore", "Austin", "Mexico City", "São Paulo",
        "Las Vegas", "Lusail", "Abu Dhabi", "Madrid", "Imola", "Miami",
    ]:
        if name.lower() in (title + " " + document.get("context", "")).lower():
            return name
    return "Event not identified"


def load_driver_names(series: str, year: int) -> list[str]:
    path = ROOT / "data" / series / f"{year}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    names = set()
    for row in data.get("driverStandings", []) or []:
        driver = row.get("Driver") or {}
        name = " ".join(
            value for value in [
                driver.get("givenName", ""),
                driver.get("familyName", ""),
            ] if value
        ).strip()
        if name:
            names.add(name)
    for race in data.get("races", []) or []:
        for result in race.get("Results", []) or []:
            driver = result.get("Driver") or {}
            name = " ".join(
                value for value in [
                    driver.get("givenName", ""),
                    driver.get("familyName", ""),
                ] if value
            ).strip()
            if name:
                names.add(name)
    return sorted(names, key=len, reverse=True)


def extract_penalties(document: dict, text: str, driver_names: list[str]) -> list[dict]:
    source_text = " ".join([document.get("title", ""), text])
    car_markers = list(CAR_MARKER.finditer(source_text))
    if car_markers:
        segments = [
            (marker.group(1), source_text[marker.start():(
                car_markers[index + 1].start()
                if index + 1 < len(car_markers) else len(source_text)
            )])
            for index, marker in enumerate(car_markers)
        ]
    else:
        segments = [("", source_text)]

    results: list[dict] = []
    season = int(document["season"])
    event = event_name(document, text)
    series = document["series"]
    for car_number, segment in segments:
        place_count = None
        grid_match = None
        for pattern in GRID_PATTERNS:
            grid_match = pattern.search(segment)
            if grid_match:
                place_count = parse_number(grid_match.group(1))
                break
        back = bool(BACK_OF_GRID.search(segment))
        pit_lane = bool(PIT_LANE.search(segment))
        if place_count is None and not back and not pit_lane:
            continue

        if pit_lane and place_count is None and not back:
            sanction_type, penalty, places = "pit-lane-start", "Pit-lane start", None
            match = PIT_LANE.search(segment)
        elif back:
            sanction_type, penalty, places = "back-of-grid", "Back of the grid", None
            match = BACK_OF_GRID.search(segment)
        else:
            sanction_type, penalty, places = "grid-drop", f"{place_count}-place grid drop", place_count
            match = grid_match

        lower_title = document.get("title", "").lower()
        status = "pending" if re.search(r"\b(summons|provisional|alleged|pending)\b", lower_title) else "confirmed"
        if match:
            reason = " ".join(segment[max(0, match.start() - 190):min(len(segment), match.end() + 320)].split())
        else:
            reason = "Explicit grid sanction wording in FIA decision document."
        matched_driver = ""
        lower_segment = segment.lower()
        for name in driver_names:
            if name.lower() in lower_segment:
                matched_driver = name
                break

        identity = matched_driver or f"Car {car_number}" if car_number else matched_driver or "Driver not identified"
        key_material = "|".join([
            series, str(season), event, car_number, matched_driver,
            sanction_type, str(places or ""), document["url"],
        ])
        record_id = "fia-series-" + hashlib.sha256(key_material.encode("utf-8")).hexdigest()[:22]
        results.append({
            "id": record_id,
            "series": series,
            "season": season,
            "event": event,
            "published": document.get("published") or "",
            "date": document.get("published") or "",
            "driver": matched_driver,
            "team": "",
            "carNumber": car_number,
            "penalty": penalty,
            "gridPlaces": places,
            "sanctionType": sanction_type,
            "status": status,
            "reason": reason[:700],
            "documentTitle": document.get("title", "FIA document"),
            "sourceUrl": document["url"],
            "sourceTitle": "Official FIA document",
            "sourceType": "official-fia",
            "sourcePage": document.get("page", ""),
        })
    return results


def record_key(item: dict) -> tuple:
    return (
        str(item.get("series", "")),
        int(item.get("season") or 0),
        re.sub(r"[^a-z0-9]+", "", str(item.get("event", "")).lower()),
        re.sub(r"[^a-z0-9]+", "", str(item.get("driver", "")).lower()),
        str(item.get("sanctionType", "")),
        str(item.get("gridPlaces") or ""),
    )


def main() -> int:
    snapshot = load_previous()
    existing = snapshot.get("penalties", []) or []
    combined: dict[tuple, dict] = {record_key(item): item for item in existing}
    document_map: dict[str, dict] = {
        str(doc.get("url")): doc
        for doc in (snapshot.get("documents", []) or [])
        if doc.get("url")
    }
    coverage = snapshot.get("seriesCoverage", {}) or {}
    scanned_count = 0
    records_added = 0

    for series, config in SERIES_CONFIG.items():
        checked_years: list[int] = []
        accessible_years: list[int] = []
        documents_for_series: list[str] = []
        series_records = 0
        for year in range(config["first"], CURRENT_YEAR + 1):
            checked_years.append(year)
            documents, page_url = collect_page_documents(series, year)
            if page_url:
                accessible_years.append(year)
                if page_url not in documents_for_series:
                    documents_for_series.append(page_url)
            if not documents:
                continue
            driver_names = load_driver_names(series, year)
            for document in documents:
                try:
                    pdf = read_url(document["url"], "application/pdf,*/*;q=0.8")
                    extracted_text = pdf_text(pdf)
                    scanned_count += 1
                    document_map[document["url"]] = {
                        "title": document["title"],
                        "url": document["url"],
                        "event": event_name(document, extracted_text),
                        "published": document.get("published"),
                        "season": year,
                        "series": series,
                        "sourceType": "official-fia",
                    }
                    for penalty in extract_penalties(document, extracted_text, driver_names):
                        key = record_key(penalty)
                        current = combined.get(key)
                        if current is None or current.get("sourceType") != "official-fia":
                            combined[key] = penalty
                            records_added += 1
                        elif not current.get("driver") and penalty.get("driver"):
                            combined[key] = penalty
                        series_records += 1
                        print(f"{series.upper()} {year}: {penalty['event']} · {penalty['penalty']} · {penalty.get('driver') or penalty.get('carNumber')}")
                except Exception as error:
                    print(f"WARNING: cannot parse {document['url']}: {error}", file=sys.stderr)

        coverage[series] = {
            "label": config["label"],
            "firstSeason": config["first"],
            "lastSeasonChecked": CURRENT_YEAR,
            "checkedYears": checked_years,
            "accessibleArchiveYears": sorted(set(accessible_years)),
            "documentsScanned": sum(
                1 for doc in document_map.values()
                if doc.get("series") == series and doc.get("sourceType") == "official-fia"
            ),
            "penaltyRecords": sum(
                1 for item in combined.values()
                if item.get("series") == series
            ),
            "sourcePages": documents_for_series,
            "coverageNote": (
                "FIA decision-document archives were checked where reachable. An accessible season with no extracted grid sanctions is not proof that no penalties were issued; only explicit grid-drop, back-of-grid and pit-lane-start wording is recorded."
            ),
        }

    ordered = sorted(
        combined.values(),
        key=lambda item: (
            str(item.get("series", "")),
            int(item.get("season") or 0),
            str(item.get("published") or item.get("date") or ""),
            str(item.get("event") or ""),
        ),
        reverse=True,
    )
    snapshot["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    snapshot["source"] = "Official FIA documents + MIT-licensed historical F1 penalty compilation"
    snapshot["seriesCoverage"] = coverage
    snapshot["documents"] = sorted(
        document_map.values(),
        key=lambda doc: str(doc.get("published") or ""),
        reverse=True,
    )[:600]
    snapshot["penalties"] = ordered
    snapshot["coverageYears"] = sorted(
        {int(item["season"]) for item in ordered if item.get("season") is not None},
        reverse=True,
    )
    snapshot["coverageNote"] = (
        "F1 has a compiled historic penalty dataset from 2020 onward plus current FIA documents. F2/F3 records are extracted from FIA decision archives for seasons whose document pages are reachable. Missing years are unverified coverage gaps, not zero-penalty seasons."
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"Saved {len(ordered)} total F1/F2/F3 records; scanned {scanned_count} FIA PDFs; added {records_added} new records.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
