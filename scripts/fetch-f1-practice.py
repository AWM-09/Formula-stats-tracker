#!/usr/bin/env python3
"""Import current-season Formula 1 practice classifications through FastF1."""
from __future__ import annotations
import json
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path

import fastf1
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "f1"
YEAR = datetime.now(timezone.utc).year
SESSIONS = (
    ("FirstPractice", "FP1", "Practice 1"),
    ("SecondPractice", "FP2", "Practice 2"),
    ("ThirdPractice", "FP3", "Practice 3"),
    ("Qualifying", "Q", "Qualifying"),
    ("SprintQualifying", "SQ", "Sprint Qualifying"),
    ("SprintShootout", "SQ", "Sprint Qualifying"),
    ("Sprint", "S", "Sprint"),
)

def norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())

def is_missing(value: object) -> bool:
    try:
        return value is None or bool(pd.isna(value))
    except (TypeError, ValueError):
        return value is None

def text(value: object) -> str:
    return "" if is_missing(value) else str(value).strip()

def number_text(value: object) -> str | None:
    if is_missing(value):
        return None
    try:
        parsed = float(value)
        return str(int(parsed)) if parsed.is_integer() else str(parsed)
    except (TypeError, ValueError):
        return None

def format_time(value: object) -> str:
    if is_missing(value):
        return ""
    if hasattr(value, "total_seconds"):
        seconds = float(value.total_seconds())
        if not math.isfinite(seconds):
            return ""
        minutes = int(seconds // 60)
        return f"{minutes}:{seconds - minutes * 60:06.3f}"
    return str(value)

def write_data(path: Path, data: dict) -> None:
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)

def build_lookups(data: dict):
    by_code, by_number, by_name, teams = {}, {}, {}, {}
    drivers = {}
    for entry in data.get("driverStandings", []):
        driver = entry.get("Driver") or {}
        if driver.get("driverId"):
            drivers[driver["driverId"]] = driver
    for event in data.get("races", []):
        for result in event.get("Results", []):
            driver = result.get("Driver") or {}
            if driver.get("driverId"):
                drivers[driver["driverId"]] = driver
            team = result.get("Constructor") or {}
            if team.get("name"):
                teams[norm(team["name"])] = team
    for driver in drivers.values():
        if driver.get("code"):
            by_code[str(driver["code"]).upper()] = driver
        if driver.get("permanentNumber"):
            by_number[str(driver["permanentNumber"])] = driver
        full_name = " ".join(part for part in (driver.get("givenName"), driver.get("familyName")) if part)
        if full_name:
            by_name[norm(full_name)] = driver
    for entry in data.get("constructorStandings", []):
        team = entry.get("Constructor") or {}
        if team.get("name"):
            teams[norm(team["name"])] = team
    return by_code, by_number, by_name, teams

def convert_result(row, session_name, by_code, by_number, by_name, teams):
    code = text(row.get("Abbreviation")).upper()
    number = text(row.get("DriverNumber"))
    full_name = text(row.get("FullName"))
    driver = by_code.get(code) or by_number.get(number) or by_name.get(norm(full_name))
    if driver is None:
        first_name = text(row.get("FirstName"))
        last_name = text(row.get("LastName"))
        driver = {
            "driverId": norm(full_name or (first_name + " " + last_name)),
            "givenName": first_name,
            "familyName": last_name,
            "code": code,
            "permanentNumber": number,
            "nationality": text(row.get("CountryCode"))
        }
    team_name = text(row.get("TeamName"))
    team = teams.get(norm(team_name)) or {"name": team_name, "nationality": ""}
    position = number_text(row.get("Position"))
    laps_value = number_text(row.get("Laps"))
    return {
        "Driver": driver,
        "Constructor": team,
        "position": position or "—",
        "grid": None,
        "laps": int(float(laps_value)) if laps_value else None,
        "points": None,
        "status": text(row.get("Status")),
        "session": session_name,
        "Time": {"time": format_time(row.get("Time"))},
        "gap": "",
        "source": "FastF1 session classification"
    }

def main() -> int:
    path = DATA / f"{YEAR}.json"
    if not path.exists():
        print(f"No F1 {YEAR} data file found; practice importer skipped.")
        return 0

    cache_directory = ROOT / ".fastf1-cache"
    cache_directory.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_directory))
    data = json.loads(path.read_text(encoding="utf-8"))
    by_code, by_number, by_name, teams = build_lookups(data)
    races = data.setdefault("races", [])
    by_round = {str(event.get("round")): event for event in races}
    calendar = data.get("calendar") or races
    now_utc = datetime.now(timezone.utc)
    imported = 0
    checked = 0

    for scheduled in calendar:
        round_number = str(scheduled.get("round") or "")
        if not round_number.isdigit():
            continue
        event = by_round.get(round_number)
        if event is None:
            event = {
                "round": round_number,
                "raceName": scheduled.get("raceName") or f"Round {round_number}",
                "date": scheduled.get("date"),
                "Circuit": scheduled.get("Circuit") or {},
                "Results": []
            }
            races.append(event)
            by_round[round_number] = event
        event.setdefault("Results", [])

        for field, code, label in SESSIONS:
            session_info = scheduled.get(field) or event.get(field)
            if not session_info:
                continue
            already_imported = any(
                row.get("session") == label and not row.get("isRecordOnly")
                for row in event["Results"]
            )
            if already_imported:
                continue

            session_date = text(session_info.get("date"))
            session_time = text(session_info.get("time"))
            if session_date:
                try:
                    date_time_text = session_date + ("T" + session_time if session_time else "T23:59:59")
                    scheduled_at = datetime.fromisoformat(date_time_text.replace("Z", "+00:00"))
                    if scheduled_at.tzinfo is None:
                        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
                    if scheduled_at > now_utc:
                        continue
                except ValueError:
                    print(f"{YEAR} round {round_number} {label}: invalid schedule timestamp; skipped.")
                    continue

            checked += 1
            try:
                session = fastf1.get_session(YEAR, int(round_number), code)
                session.load(laps=False, telemetry=False, weather=False, messages=False)
                frame = session.results
                if frame is None or frame.empty:
                    print(f"{YEAR} round {round_number} {label}: no classification returned.")
                    continue
                converted = []
                for _, row in frame.iterrows():
                    result = convert_result(row, label, by_code, by_number, by_name, teams)
                    if result["Driver"].get("driverId"):
                        converted.append(result)
                converted.sort(key=lambda row: int(row["position"]) if str(row["position"]).isdigit() else 999)
                if converted:
                    event["Results"].extend(converted)
                    write_data(path, data)
                    imported += 1
                    print(f"{YEAR} round {round_number} {label}: saved {len(converted)} drivers.", flush=True)
            except Exception as exc:
                print(f"{YEAR} round {round_number} {label}: unavailable ({exc})", flush=True)
                continue

    data["sessionCoverage"] = {
        **(data.get("sessionCoverage") or {}),
        "practice": "FastF1 current-season practice classifications where the session feed is published"
    }
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    write_data(path, data)
    print(f"Practice import finished: {imported} session classifications imported; {checked} sessions checked.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
