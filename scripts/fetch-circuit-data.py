#!/usr/bin/env python3
"""Fetch F1 historic circuit layouts and configuration-specific track data."""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import yaml

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "circuit-track-data.json"
LAYOUT_SOURCE = (
    "https://raw.githubusercontent.com/MisterSix2295/"
    "f1-circuits-svg/main/circuits.json"
)
SPEC_LIST = (
    "https://api.github.com/repos/f1db/f1db/contents/"
    "src/data/circuits?ref=main&per_page=100"
)
SVG_BASE = (
    "https://raw.githubusercontent.com/MisterSix2295/"
    "f1-circuits-svg/main/circuits/white-outline/"
)
USER_AGENT = "FormulaStatsTracker/1.0 (independent motorsport statistics project)"


def read_url(url: str, accept: str = "*/*") -> bytes:
    request = Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )
    with urlopen(request, timeout=25) as response:
        return response.read()


def fetch_spec(entry: dict) -> tuple[str, dict | None]:
    name = entry.get("name", "")
    if not name.endswith(".yml"):
        return name, None
    try:
        value = yaml.safe_load(read_url(entry["download_url"]).decode("utf-8"))
        return name, value if isinstance(value, dict) else None
    except Exception as error:
        print(f"WARNING: could not read {name}: {error}")
        return name, None


def previous_snapshot() -> dict:
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"circuits": []}


def main() -> int:
    try:
        layout_data = json.loads(read_url(LAYOUT_SOURCE).decode("utf-8"))
        file_entries = json.loads(
            read_url(SPEC_LIST, "application/vnd.github+json").decode("utf-8")
        )
    except Exception as error:
        print(f"ERROR: circuit source index could not be fetched: {error}", file=sys.stderr)
        if previous_snapshot().get("circuits"):
            print("Keeping the previous circuit track data.")
        return 1

    if not isinstance(layout_data, list) or not layout_data:
        print("ERROR: circuit layout source returned no records.", file=sys.stderr)
        return 1
    if not isinstance(file_entries, list):
        print("ERROR: F1DB circuit list returned an unexpected payload.", file=sys.stderr)
        return 1

    spec_files = [item for item in file_entries if item.get("name", "").endswith(".yml")]
    specs: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(fetch_spec, item) for item in spec_files]
        for future in as_completed(futures):
            filename, spec = future.result()
            if spec and spec.get("id"):
                specs[str(spec["id"])] = spec

    records = []
    missing_specs = []
    missing_layout_details = 0
    for source in layout_data:
        circuit_id = str(source.get("id", ""))
        spec = specs.get(circuit_id, {})
        spec_layouts = {
            str(layout.get("id")): layout
            for layout in (spec.get("layouts") or [])
            if isinstance(layout, dict) and layout.get("id")
        }
        layouts = []
        for source_layout in source.get("layouts") or []:
            layout_id = str(source_layout.get("layoutId", ""))
            layout_spec = spec_layouts.get(layout_id, {})
            if not layout_spec.get("length") or layout_spec.get("turns") is None:
                missing_layout_details += 1
            layouts.append(
                {
                    "id": layout_id,
                    "seasons": source_layout.get("seasons") or "",
                    "lengthKm": layout_spec.get("length"),
                    "turns": layout_spec.get("turns"),
                    "effective": bool(layout_spec.get("effective", False)),
                    "svgUrl": SVG_BASE + layout_id + ".svg",
                    "layoutSource": "MisterSix2295/f1-circuits-svg",
                }
            )

        if not spec:
            missing_specs.append(circuit_id)
        records.append(
            {
                "id": circuit_id,
                "name": source.get("name") or spec.get("fullName") or spec.get("name"),
                "countryId": source.get("countryId"),
                "latitude": source.get("latitude"),
                "longitude": source.get("longitude"),
                "type": spec.get("type"),
                "direction": spec.get("direction"),
                "lengthKm": spec.get("length"),
                "turns": spec.get("turns"),
                "totalRacesHeld": spec.get("totalRacesHeld"),
                "layouts": layouts,
                "specSource": "f1db/f1db",
                "layoutSource": "MisterSix2295/f1-circuits-svg",
            }
        )

    # Keep F1DB circuits that are newer than, or absent from, the layout-artwork catalogue.
    # They can still supply verified track dimensions even when no SVG exists yet.
    layout_source_ids = {str(item.get("id", "")) for item in layout_data}
    for circuit_id, spec in specs.items():
        if circuit_id in layout_source_ids:
            continue
        records.append(
            {
                "id": circuit_id,
                "name": spec.get("fullName") or spec.get("name") or circuit_id,
                "countryId": spec.get("countryId"),
                "latitude": spec.get("latitude"),
                "longitude": spec.get("longitude"),
                "type": spec.get("type"),
                "direction": spec.get("direction"),
                "lengthKm": spec.get("length"),
                "turns": spec.get("turns"),
                "totalRacesHeld": spec.get("totalRacesHeld"),
                "layouts": [],
                "specSource": "f1db/f1db",
                "layoutSource": None,
            }
        )
        print(f"Added specifications without a layout SVG: {circuit_id}")

    snapshot = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": {
            "specifications": "F1DB",
            "layouts": "MisterSix2295/f1-circuits-svg",
        },
        "circuits": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)
    print(
        f"Saved {len(records)} circuit specifications and "
        f"{sum(len(x['layouts']) for x in records)} layout variants."
    )
    if missing_specs:
        print("Circuits without an F1DB spec: " + ", ".join(missing_specs))
    if missing_layout_details:
        print(f"{missing_layout_details} layout variants lack configuration-specific length/turn data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
