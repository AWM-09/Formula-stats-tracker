#!/usr/bin/env python3
"""Import explicit Formula One grid-penalty evidence from official FIA documents.

The importer deliberately does not infer penalties from component allocations,
rumours, qualifying positions or news headlines. A penalty is listed only when
an official FIA PDF contains explicit grid-drop wording.
"""
from __future__ import annotations

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
FIA_PAGES = [
    # Current FIA championship document archive. It resolves to the active season.
    "https://www.fia.com/documents/championships/fia-formula-one-world-championship-14",
    # Explicit 2026 season archive as a resilient fallback while the current route changes.
    "https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2026-2072",
]
USER_AGENT = "FormulaStatsTracker/1.0 (personal motorsport statistics project)"
CURRENT_YEAR = datetime.now(timezone.utc).year
MAX_DOCUMENTS = 100
# Verified official FIA PDF used as a bootstrap fallback if the archive page is
# temporarily rendered without document anchors to automated clients.
KNOWN_FALLBACK_DOCUMENTS = [
    {
        "url": "https://www.fia.com/system/files/decision-document/2026_hungarian_grand_prix_-_final_starting_grid.pdf",
        "title": "Doc 52 - Final Starting Grid - Hungarian Grand Prix",
        "context": "2026 Hungarian Grand Prix · Final Starting Grid",
        "published": "2026-07-26T12:00:00Z",
        "page": "https://www.fia.com/documents/championships/fia-formula-one-world-championship-14/season/season-2026-2072",
    }
]
RELEVANT_TITLE = re.compile(
    r"\b(decision|infringement|summons|starting grid|grid penalty|"
    r"power unit elements|gearbox elements|final grid|provisional grid)\b",
    re.IGNORECASE,
)
PENALTY_NUMBER = r"(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
PENALTY_PATTERNS = [
    re.compile(r"\b(" + PENALTY_NUMBER + r")\s*[- ]place\s+grid\s+penalt(?:y|ies)\b", re.I),
    re.compile(r"\b(?:grid|starting grid)\s+penalt(?:y|ies)\s+(?:of\s+)?(" + PENALTY_NUMBER + r")\s+(?:place|position)", re.I),
    re.compile(r"\b(?:drop|dropped|demoted|relegated)\s+(?:by\s+)?(" + PENALTY_NUMBER + r")\s+(?:grid\s+)?(?:places?|positions?)\b", re.I),
    re.compile(r"\b(" + PENALTY_NUMBER + r")\s+(?:grid\s+)?(?:places?|positions?)\s+penalt(?:y|ies)\b", re.I),
    re.compile(r"\bwill\s+be\s+dropped\s+(" + PENALTY_NUMBER + r")\s+places?\s+on\s+the\s+grid\b", re.I),
    re.compile(r"\b(" + PENALTY_NUMBER + r")\s+positions?\s+on\s+the\s+grid\b", re.I),
]
BACK_OF_GRID = re.compile(
    r"(?:penalt\w*|demot\w*|relegat\w*).{0,120}back\s+of\s+the\s+grid|"
    r"back\s+of\s+the\s+grid.{0,120}(?:penalt\w*|demot\w*|relegat\w*)|"
    r"required\s+to\s+start\s+from\s+the\s+back\s+of\s+the\s+grid",
    re.I | re.S,
)
PIT_LANE_START = re.compile(
    r"(?:required|instructed|ordered)\s+to\s+start\s+from\s+the\s+pit\s+lane|"
    r"start\s+from\s+the\s+pit\s+lane",
    re.I,
)
CAR_NUMBER = re.compile(r"\bcar\s*#?\s*(\d{1,2})\b", re.I)
PUBLISHED_DATE = re.compile(r"Published on\s+(\d{2}\.\d{2}\.\d{2})", re.I)
EVENT_PATTERN = re.compile(
    r"\b([A-Z][A-Za-zÀ-ÿ'’ -]{2,45} Grand Prix)\b"
)


def read_url(url: str, accept: str = "*/*") -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": accept,
        },
    )
    with urlopen(request, timeout=35) as response:
        return response.read()


def load_previous() -> dict:
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"penalties": [], "documents": []}


def parse_published(value: str) -> str | None:
    match = PUBLISHED_DATE.search(value or "")
    if not match:
        return None
    try:
        parsed = datetime.strptime(match.group(1), "%d.%m.%y")
        return parsed.replace(tzinfo=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except ValueError:
        return None


def collect_documents() -> tuple[list[dict], list[str]]:
    collected: dict[str, dict] = {}
    successful_pages: list[str] = []
    for page_url in FIA_PAGES:
        try:
            html = read_url(page_url, "text/html,application/xhtml+xml")
            soup = BeautifulSoup(html, "html.parser")
            successful_pages.append(page_url)
            anchors = soup.find_all("a", href=True)
            pdf_links = [a for a in anchors if ".pdf" in urljoin(page_url, a.get("href", "")).lower()]
            print(f"FIA source loaded: {page_url} · {len(html)} bytes · {len(anchors)} anchors · {len(pdf_links)} PDF links")
            for anchor in pdf_links:
                href = urljoin(page_url, anchor["href"].strip())
                if "fia.com" not in urlparse(href).netloc.lower():
                    continue
                title = " ".join(anchor.stripped_strings) or str(anchor.get("title") or anchor.get("aria-label") or "").strip()
                parent = anchor.parent
                context_parts = [title]
                for _ in range(3):
                    if parent is None:
                        break
                    context_parts.extend(parent.stripped_strings)
                    parent = parent.parent
                context = " ".join(dict.fromkeys(x for x in context_parts if x))
                if not RELEVANT_TITLE.search(title):
                    continue

                published = parse_published(context)
                if published:
                    published_year = int(published[:4])
                    if published_year < CURRENT_YEAR - 1:
                        continue

                key = href.split("?")[0]
                document = {
                    "url": href,
                    "title": title or context[:240] or "FIA document",
                    "context": context[:1200],
                    "published": published,
                    "page": page_url,
                }
                if key not in collected or len(document["context"]) > len(collected[key]["context"]):
                    collected[key] = document
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            print(f"WARNING: FIA page unavailable: {page_url}: {error}", file=sys.stderr)

    if not collected:
        print("WARNING: FIA archive pages loaded but no PDF anchors were exposed; adding one verified official final-grid PDF as a bootstrap record.", file=sys.stderr)
        for document in KNOWN_FALLBACK_DOCUMENTS:
            collected[document["url"]] = {**document, "bootstrapFallback": True}
    documents = list(collected.values())
    documents.sort(key=lambda x: x.get("published") or "", reverse=True)
    return documents[:MAX_DOCUMENTS], successful_pages


def load_driver_maps(year: int) -> tuple[dict[str, dict], dict[str, str]]:
    path = ROOT / "data" / "f1" / f"{year}.json"
    if not path.exists():
        return {}, {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, {}

    by_number: dict[str, dict] = {}
    by_name: dict[str, str] = {}

    def add_driver(driver: dict, constructor: str = "") -> None:
        if not isinstance(driver, dict):
            return
        number = str(driver.get("permanentNumber") or "").strip()
        name = " ".join(
            x for x in [driver.get("givenName"), driver.get("familyName")] if x
        ).strip()
        if not name:
            name = driver.get("code") or driver.get("driverId") or ""
        record = {
            "name": name,
            "team": constructor,
            "driverId": driver.get("driverId", ""),
        }
        if number:
            by_number[number] = record
        if name:
            by_name[name.lower()] = number

    for standing in data.get("driverStandings", []) or []:
        constructors = standing.get("Constructors") or []
        constructor = constructors[0].get("name", "") if constructors else ""
        add_driver(standing.get("Driver") or {}, constructor)

    for race in data.get("races", []) or []:
        for result in race.get("Results", []) or []:
            constructor = (result.get("Constructor") or {}).get("name", "")
            add_driver(result.get("Driver") or {}, constructor)

    return by_number, by_name


def pdf_text(payload: bytes) -> str:
    reader = PdfReader(io.BytesIO(payload), strict=False)
    pages = []
    for page in reader.pages[:5]:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            continue
    return re.sub(r"\s+", " ", " ".join(pages)).strip()


def event_name(title: str, context: str, text: str) -> str:
    # The PDF normally begins with "2026 HUNGARIAN GRAND PRIX"; searching the
    # title first can incorrectly produce "Final Starting Grid - Hungarian GP".
    for candidate in (text[:1800], context, title):
        match = EVENT_PATTERN.search(candidate or "")
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip().title()
    known = [
        "Australian Grand Prix", "Chinese Grand Prix", "Japanese Grand Prix",
        "Bahrain Grand Prix", "Saudi Arabian Grand Prix", "Miami Grand Prix",
        "Monaco Grand Prix", "Spanish Grand Prix", "Canadian Grand Prix",
        "Austrian Grand Prix", "British Grand Prix", "Belgian Grand Prix",
        "Hungarian Grand Prix", "Dutch Grand Prix", "Italian Grand Prix",
        "Azerbaijan Grand Prix", "Singapore Grand Prix", "United States Grand Prix",
        "Mexico City Grand Prix", "São Paulo Grand Prix", "Brazilian Grand Prix",
        "Las Vegas Grand Prix", "Qatar Grand Prix", "Abu Dhabi Grand Prix",
    ]
    lower = f"{title} {context} {text[:3500]}".lower()
    return next((name for name in known if name.lower() in lower), "Event not identified")


def load_next_event() -> dict | None:
    """Read the next scheduled F1 event from the existing season snapshot."""
    path = ROOT / "data" / "f1" / f"{CURRENT_YEAR}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    entries = data.get("calendar") or data.get("races") or []
    today = datetime.now(timezone.utc).date()
    candidates = []
    for event in entries:
        raw_date = event.get("date")
        try:
            event_date = datetime.strptime(str(raw_date)[:10], "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        if event_date < today:
            continue
        circuit = event.get("Circuit") or {}
        candidates.append(
            {
                "name": event.get("raceName") or circuit.get("circuitName") or "Next Grand Prix",
                "date": event_date.isoformat(),
                "round": event.get("round"),
            }
        )
    candidates.sort(key=lambda item: item["date"])
    return candidates[0] if candidates else None


def normalise_event_name(value: str) -> str:
    import unicodedata
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def extract_penalties(document: dict, text: str, driver_maps: dict[int, dict[str, dict]]) -> list[dict]:
    """Return every explicit sanction line in a PDF, not just the first car."""
    source_text = f"{document.get('title', '')} {text}"
    published = document.get("published") or ""
    year = int(published[:4]) if published[:4].isdigit() else CURRENT_YEAR
    year_driver_map = driver_maps.get(year, {})
    event = event_name(document.get("title", ""), document.get("context", ""), text)

    car_markers = list(CAR_NUMBER.finditer(source_text))
    segments: list[tuple[str, str]] = []
    if car_markers:
        for index, marker in enumerate(car_markers):
            segment_end = car_markers[index + 1].start() if index + 1 < len(car_markers) else len(source_text)
            segments.append((marker.group(1), source_text[marker.start():segment_end]))
    else:
        segments.append(("", source_text))

    results = []
    for car_number, segment in segments:
        place_count = None
        for pattern in PENALTY_PATTERNS:
            match = pattern.search(segment)
            if match:
                raw_count = match.group(1).lower()
                place_count = NUMBER_WORDS.get(raw_count) if raw_count in NUMBER_WORDS else int(raw_count)
                break

        back_of_grid = bool(BACK_OF_GRID.search(segment))
        pit_lane_start = bool(PIT_LANE_START.search(segment))
        if place_count is None and not back_of_grid and not pit_lane_start:
            continue

        title = str(document.get("title") or "")
        status = "pending" if re.search(r"\b(summons|alleged|pending|provisional)\b", title, re.I) else "confirmed"

        reason_match = next((p.search(segment) for p in PENALTY_PATTERNS if p.search(segment)), None)
        if reason_match:
            reason = " ".join(segment[max(0, reason_match.start() - 180):min(len(segment), reason_match.end() + 260)].split())
        elif back_of_grid:
            back_match = BACK_OF_GRID.search(segment)
            reason = " ".join(segment[max(0, back_match.start() - 180):min(len(segment), back_match.end() + 260)].split())
        else:
            pit_match = PIT_LANE_START.search(segment)
            reason = " ".join(segment[max(0, pit_match.start() - 180):min(len(segment), pit_match.end() + 260)].split())

        if pit_lane_start and place_count is None and not back_of_grid:
            penalty = "Pit-lane start"
            sanction_type = "pit-lane-start"
        elif back_of_grid:
            penalty = "Back of the grid"
            sanction_type = "back-of-grid"
        else:
            penalty = f"{place_count}-place grid drop"
            sanction_type = "grid-drop"

        driver_info = year_driver_map.get(car_number, {}) if car_number else {}
        key = f"{year}|{event}|{car_number}|{penalty}|{document['url']}"
        results.append(
            {
                "id": key,
                "series": "f1",
                "season": year,
                "event": event,
                "published": published,
                "driver": driver_info.get("name", ""),
                "team": driver_info.get("team", ""),
                "carNumber": car_number,
                "penalty": penalty,
                "gridPlaces": place_count,
                "sanctionType": sanction_type,
                "status": status,
                "reason": reason[:520],
                "documentTitle": title or "FIA steward document",
                "sourceUrl": document["url"],
                "sourceTitle": "Official FIA document",
                "sourcePage": document.get("page", FIA_PAGES[0]),
            }
        )
    return results


def main() -> int:
    previous = load_previous()
    documents, successful_pages = collect_documents()
    if not successful_pages:
        print("ERROR: no official FIA document page could be read; keeping the previous snapshot.", file=sys.stderr)
        return 1

    live_documents = [doc for doc in documents if not doc.get("bootstrapFallback")]
    next_event = load_next_event()
    current_maps: dict[int, dict[str, dict]] = {}
    for year in range(CURRENT_YEAR - 1, CURRENT_YEAR + 1):
        current_maps[year] = load_driver_maps(year)[0]

    scanned = []
    penalties: dict[str, dict] = {}
    for index, document in enumerate(documents, start=1):
        try:
            payload = read_url(document["url"], "application/pdf,*/*;q=0.8")
            text = pdf_text(payload)
            scanned.append({
                "title": document["title"][:240],
                "url": document["url"],
                "published": document.get("published"),
                "event": event_name(document["title"], document.get("context", ""), text),
                "bootstrapFallback": bool(document.get("bootstrapFallback")),
            })
            extracted = extract_penalties(document, text, current_maps)
            for penalty in extracted:
                penalties[penalty["id"]] = penalty
                print(f"Grid penalty evidence: {penalty['event']} · Car {penalty['carNumber'] or 'unknown'} · {penalty['penalty']} · {penalty['documentTitle']}")
        except Exception as error:
            print(f"WARNING: could not parse FIA PDF {document['url']}: {error}", file=sys.stderr)

    previous_penalties = previous.get("penalties", [])
    previous_by_id = {
        str(item.get("id")): item
        for item in previous_penalties
        if item.get("id")
    }
    # If a temporary FIA outage or PDF parsing issue occurs, keep previously
    # imported records rather than replacing a populated file with an empty one.
    if documents and not scanned and previous_by_id:
        print("WARNING: no PDFs could be parsed; preserving the last known penalty snapshot.")
        penalties = previous_by_id

    ordered_penalties = sorted(
        penalties.values(),
        key=lambda x: (x.get("published") or "", x.get("event") or ""),
        reverse=True,
    )
    next_event_penalties = []
    next_event_final_grid_found = False
    if next_event:
        target_event = normalise_event_name(next_event["name"])
        next_event_penalties = [
            item for item in ordered_penalties
            if normalise_event_name(item.get("event", "")) == target_event
        ]
        next_event_final_grid_found = any(
            normalise_event_name(doc.get("event", "")) == target_event
            and "final starting grid" in str(doc.get("title", "")).lower()
            and not doc.get("bootstrapFallback")
            for doc in scanned
        )
    if not live_documents:
        next_event_status = "unknown"
    elif next_event_final_grid_found and next_event_penalties:
        next_event_status = "confirmed"
    elif next_event_final_grid_found:
        next_event_status = "no-sanction-listed"
    else:
        next_event_status = "pending-final-grid"

    snapshot = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "FIA official Formula One documents",
        "liveDocumentCount": len(live_documents),
        "liveDocumentsFound": bool(live_documents),
        "bootstrapDocumentsUsed": sum(1 for doc in scanned if doc.get("bootstrapFallback")),
        "nextEvent": next_event,
        "nextEventPenalties": next_event_penalties,
        "nextEventFinalGridFound": next_event_final_grid_found,
        "nextEventStatus": next_event_status,
        "sourcePages": successful_pages,
        "documentsScanned": len(scanned),
        "documents": scanned[:80],
        "penalties": ordered_penalties[:80],
        "coverageNote": (
            "Only explicit grid-drop wording found in FIA PDFs is listed. "
            "Summonses and allegations are marked pending; headlines and component usage are not treated as proof."
        ),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Saved {len(snapshot['penalties'])} explicit grid-penalty records from {len(scanned)} FIA PDFs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
