#!/usr/bin/env python3
"""Import historical F1 grid sanctions from a MIT-licensed FIA-derived dataset.

The upstream workbook contains separate season sheets (2020 onward) and fields
for grid-place penalties, pit-lane starts, outcomes, sessions and source PDFs.
This importer keeps sanction types separate and merges records with the live
official FIA document snapshot without replacing stronger FIA-PDF evidence.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "grid-penalties.json"
WORKBOOK_URL = (
    "https://raw.githubusercontent.com/j5t3313/F1_Penalties_Dashboard/"
    "main/data/F1Penalties.xlsx"
)
DATASET_URL = "https://github.com/j5t3313/F1_Penalties_Dashboard"
LICENSE_URL = DATASET_URL + "/blob/main/LICENSE"
SOURCE_TITLE = "Historical FIA penalty compilation (MIT-licensed)"
SOURCE_TYPE = "historical-dataset"
USER_AGENT = "FormulaStatsTracker/1.0 (personal motorsport statistics project)"
YEARS = set(range(2020, datetime.now(timezone.utc).year + 1))
INVALID_DRIVERS = {
    "mclaren formula 1 team",
    "mclaren formula one team",
    "scuderia ferrari",
    "red bull racing",
}


def text(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def key_text(value) -> str:
    value = unicodedata.normalize("NFKD", text(value))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def header_key(value) -> str:
    return key_text(value)


def number_value(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else float(value)
    value_text = text(value)
    if not value_text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value_text.replace(",", ""))
    if not match:
        return None
    numeric = float(match.group(0))
    return int(numeric) if numeric.is_integer() else numeric


def date_value(value) -> str:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None).isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    value_text = text(value)
    if not value_text:
        return ""
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(value_text, fmt).date().isoformat()
        except ValueError:
            continue
    return value_text


def load_workbook_bytes() -> bytes:
    request = Request(
        WORKBOOK_URL,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.8",
        },
    )
    with urlopen(request, timeout=60) as response:
        payload = response.read()
    if not payload.startswith(b"PK"):
        raise ValueError("Historical workbook download was not a valid XLSX file.")
    return payload


def find_column(headers: dict[str, int], *candidates: str) -> int | None:
    for candidate in candidates:
        found = headers.get(header_key(candidate))
        if found is not None:
            return found
    return None


def read_sheet(ws) -> tuple[list[dict], int]:
    values = ws.iter_rows(values_only=True)
    try:
        raw_headers = next(values)
    except StopIteration:
        return [], 0

    headers = {
        header_key(value): index
        for index, value in enumerate(raw_headers)
        if value is not None and text(value)
    }
    columns = {
        "year": find_column(headers, "Year", "Season"),
        "round": find_column(headers, "Round"),
        "event": find_column(headers, "Grand Prix", "Race", "Event"),
        "date": find_column(headers, "Date"),
        "driver": find_column(headers, "Driver"),
        "team": find_column(headers, "Team", "Constructor"),
        "session": find_column(headers, "Session"),
        "lap": find_column(headers, "Lap"),
        "allegation": find_column(headers, "Allegation", "Incident"),
        "outcome": find_column(headers, "Outcome", "Decision"),
        "grid": find_column(headers, "Grid Penalty", "Grid Penalties"),
        "time": find_column(headers, "Time"),
        "time_penalty": find_column(headers, "Time Penalty (in seconds)", "Time Penalty"),
        "penalty_points": find_column(headers, "Penalty Points"),
        "fine": find_column(headers, "Fine"),
        "stewards": find_column(headers, "Stewards"),
        "doc_url": find_column(headers, "Doc_URL", "Doc URL", "Document URL", "PDF"),
    }
    if columns["driver"] is None or columns["grid"] is None:
        raise ValueError(
            f"{ws.title}: required Driver/Grid Penalty columns were not found. "
            f"Headers: {[text(x) for x in raw_headers if x is not None]}"
        )

    def get(row, field):
        column = columns[field]
        return row[column] if column is not None and column < len(row) else None

    records = []
    rows_read = 0
    sheet_year = number_value(ws.title)
    for excel_row, row in enumerate(values, start=2):
        if not row or all(value is None or text(value) == "" for value in row):
            continue
        rows_read += 1
        year = number_value(get(row, "year")) or sheet_year
        if year is None or int(year) not in YEARS:
            continue
        year = int(year)

        driver = text(get(row, "driver"))
        if not driver or key_text(driver) in INVALID_DRIVERS:
            continue
        team = text(get(row, "team"))
        event = text(get(row, "event")) or "Event not supplied"
        outcome = text(get(row, "outcome"))
        allegation = text(get(row, "allegation"))
        raw_grid = get(row, "grid")
        grid_text = text(raw_grid)
        outcome_lower = outcome.lower()
        grid_lower = grid_text.lower()
        combined = (outcome + " " + grid_text).lower()

        pit_lane = (
            "pit lane" in combined
            or "pitlane" in combined
            or grid_lower in {"pit", "pit lane", "pit-lane"}
        )
        back_of_grid = (
            "back of grid" in combined
            or "back of the grid" in combined
            or grid_lower in {"back of grid", "back of the grid", "back"}
        )
        grid_places = number_value(raw_grid)
        if grid_places is None:
            place_words = {
                "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
            }
            word_number = "|".join(place_words)
            match = re.search(
                r"\b(\d{1,2}|" + word_number + r")\s*[- ]?(?:place|position)"
                r"(?:s)?\s+(?:grid\s+)?penalt",
                outcome,
                re.I,
            )
            if match:
                captured = match.group(1).lower()
                grid_places = place_words.get(captured, int(captured) if captured.isdigit() else None)

        has_grid_wording = bool(re.search(
            r"\bgrid\s+penalt(?:y|ies)\b|\bstart(?:ing)?\s+from\s+the\s+back\s+of\s+(?:the\s+)?grid\b",
            combined,
            re.I,
        ))
        if pit_lane:
            sanction_type = "pit-lane-start"
            penalty = "Pit-lane start"
            grid_places = None
        elif back_of_grid:
            sanction_type = "back-of-grid"
            penalty = "Back of the grid"
            grid_places = None
        elif grid_places is not None and grid_places > 0:
            sanction_type = "grid-drop"
            penalty = f"{grid_places}-place grid drop"
        elif has_grid_wording:
            sanction_type = "grid-drop"
            penalty = "Grid penalty · places not specified"
            grid_places = None
        else:
            continue

        if re.search(r"\b(overturned|overturned on review|rescinded|deleted)\b", outcome_lower):
            status = "overturned"
        elif re.search(r"\b(no further action|no penalty applied|not guilty)\b", outcome_lower):
            status = "no-action"
        elif re.search(r"\b(summons|alleged|pending|awaiting decision)\b", outcome_lower):
            status = "pending"
        else:
            status = "confirmed"

        round_number = number_value(get(row, "round"))
        published = date_value(get(row, "date"))
        session = text(get(row, "session"))
        lap = number_value(get(row, "lap"))
        source_url = text(get(row, "doc_url"))
        if not source_url.startswith("https://"):
            source_url = ""
        reason_parts = [part for part in [allegation, outcome] if part]
        reason = " · ".join(dict.fromkeys(reason_parts)) or "Grid sanction recorded in the historical dataset."

        stable_source = "|".join([
            str(year),
            str(round_number or ""),
            key_text(event),
            key_text(driver),
            key_text(session),
            str(lap or ""),
            sanction_type,
            str(grid_places or ""),
            key_text(reason),
            source_url,
        ])
        record_id = "historical-" + hashlib.sha256(stable_source.encode("utf-8")).hexdigest()[:20]
        records.append({
            "id": record_id,
            "series": "f1",
            "season": year,
            "round": round_number,
            "event": event,
            "date": published,
            "published": published,
            "driver": driver,
            "team": team,
            "carNumber": "",
            "session": session,
            "lap": lap,
            "penalty": penalty,
            "gridPlaces": grid_places,
            "sanctionType": sanction_type,
            "status": status,
            "reason": reason[:700],
            "allegation": allegation,
            "outcome": outcome,
            "penaltyPoints": number_value(get(row, "penalty_points")),
            "timePenaltySeconds": number_value(get(row, "time_penalty")),
            "fine": number_value(get(row, "fine")),
            "stewards": text(get(row, "stewards")),
            "sourceUrl": source_url or DATASET_URL,
            "sourceTitle": SOURCE_TITLE,
            "sourceType": SOURCE_TYPE,
            "sourcePage": DATASET_URL,
            "sourceExcelRow": excel_row,
        })
    return records, rows_read


def dedupe_key(item: dict) -> tuple:
    return (
        int(item.get("season") or 0),
        key_text(item.get("event")),
        key_text(item.get("driver")),
        key_text(item.get("carNumber")) if not item.get("driver") else "",
        str(item.get("sanctionType") or ""),
        str(item.get("gridPlaces") or ""),
    )


def source_priority(item: dict) -> int:
    source_type = item.get("sourceType")
    if source_type == "official-fia":
        return 3
    if item.get("sourceUrl") and "fia.com/system/files/" in str(item.get("sourceUrl")):
        return 3
    if source_type == SOURCE_TYPE:
        return 2
    return 1


def main() -> int:
    previous = {}
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        previous = {}

    try:
        payload = load_workbook_bytes()
        workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
    except Exception as error:
        print(f"WARNING: historical workbook unavailable; existing records retained: {error}", file=sys.stderr)
        return 0

    historical: list[dict] = []
    coverage: dict[str, dict] = {}
    for sheet in workbook.worksheets:
        sheet_year = number_value(sheet.title)
        if sheet_year is None or int(sheet_year) not in YEARS:
            continue
        try:
            rows, rows_read = read_sheet(sheet)
        except Exception as error:
            print(f"WARNING: could not import season sheet {sheet.title}: {error}", file=sys.stderr)
            continue
        coverage[str(int(sheet_year))] = {
            "rowsRead": rows_read,
            "gridSanctionsImported": len(rows),
        }
        historical.extend(rows)
        print(f"{sheet.title}: {rows_read} source rows · {len(rows)} grid/pit-lane sanctions")

    workbook.close()
    if not coverage:
        print("WARNING: no supported historical season sheets found; existing records retained.", file=sys.stderr)
        return 0

    existing_records = previous.get("penalties", []) or []
    combined_by_key: dict[tuple, dict] = {}
    for item in [*historical, *existing_records]:
        key = dedupe_key(item)
        current = combined_by_key.get(key)
        if current is None or source_priority(item) > source_priority(current):
            combined_by_key[key] = item
        elif current is not None and source_priority(item) == source_priority(current):
            if sum(value not in (None, "", [], {}) for value in item.values()) > sum(value not in (None, "", [], {}) for value in current.values()):
                combined_by_key[key] = item

    combined = sorted(
        combined_by_key.values(),
        key=lambda item: (
            int(item.get("season") or 0),
            str(item.get("date") or item.get("published") or ""),
            int(item.get("round") or 0),
            key_text(item.get("driver")),
        ),
        reverse=True,
    )

    previous_documents = previous.get("documents", []) or []
    document_map = {str(doc.get("url")): doc for doc in previous_documents if doc.get("url")}
    historical_docs: dict[str, dict] = {}
    for record in historical:
        url = record.get("sourceUrl")
        if not url or url == DATASET_URL:
            continue
        historical_docs[url] = {
            "title": record.get("sourceTitle") or "FIA steward decision",
            "url": url,
            "event": record.get("event"),
            "published": record.get("published"),
            "season": record.get("season"),
            "sourceType": SOURCE_TYPE,
        }
    document_map.update(historical_docs)

    snapshot = {
        **previous,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Official FIA documents + MIT-licensed historical F1 penalty compilation",
        "historicalDataset": {
            "name": "F1 Penalties Dashboard",
            "url": DATASET_URL,
            "license": "MIT",
            "licenseUrl": LICENSE_URL,
            "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "coverage": coverage,
            "recordCount": len(historical),
        },
        "coverageYears": sorted({int(item["season"]) for item in combined if item.get("season") is not None}, reverse=True),
        "documents": sorted(
            document_map.values(),
            key=lambda doc: str(doc.get("published") or ""),
            reverse=True,
        )[:300],
        "penalties": combined,
        "coverageNote": (
            "Historical 2020+ sanctions are compiled from the cited MIT-licensed dataset and retain FIA source PDF links where provided. "
            "The live document importer supplements the current season. Grid drops, back-of-grid sanctions and pit-lane starts are separate types. "
            "A news story or component allocation is never treated as an official penalty."
        ),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Saved {len(combined)} combined sanctions. Historical import: {len(historical)} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
