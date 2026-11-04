#!/usr/bin/env python3
"""Builds normalized F2/F3 season archives from FIA standings and documented historical sources."""
from __future__ import annotations
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
YEAR_NOW = datetime.now(timezone.utc).year
USER_AGENT = "AWM-09-Formula-Stats-Tracker/1.0 (historical championship statistics; contact: repository owner)"
WAIT_SECONDS = 0.7

def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def fetch_text(url: str, attempts: int = 5) -> tuple[str, str]:
    last_error = None
    for attempt in range(attempts):
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/json,text/csv,*/*",
        })
        try:
            with urllib.request.urlopen(req, timeout=35) as response:
                content = response.read().decode("utf-8-sig", errors="replace")
                final_url = response.geturl()
                time.sleep(WAIT_SECONDS)
                return content, final_url
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504):
                break
        except Exception as exc:
            last_error = exc
        delay = min(45, 3 * (2 ** attempt))
        print(f"  retry {attempt + 1}/{attempts} for {url}: {last_error}; waiting {delay}s", flush=True)
        time.sleep(delay)
    raise RuntimeError(f"Could not fetch {url}: {last_error}")

def normalize(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", text.lower())

def slug(value: str) -> str:
    return normalize(value) or "unknown"

def number_from_text(value: str | None):
    if value is None:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not match:
        return None
    number = float(match.group(0))
    return int(number) if number.is_integer() else number

def position_text(value: str | None) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text or text in ("—", "-", "–"):
        return None
    return text

def person_from_standings(name: str, nationality: str | None = None) -> dict:
    return {
        "driverId": slug(name),
        "givenName": "",
        "familyName": name.strip(),
        "nationality": nationality or "",
    }

def get_fia_urls(series: str, year: int) -> list[str]:
    if series == "f2":
        return [
            f"https://www.fia.com/events/formula-2-championship/season-{year}/standings",
            f"https://admin.fia.com/events/formula-2-championship/season-{year}/standings",
        ]
    return [
        f"https://www.fia.com/events/f3-championship/season-{year}/{year}-standings",
        f"https://www.fia.com/events/fia-formula-3-championship/season-{year}/{year}-standings",
        f"https://www.fia.com/events/fia-formula-3-championship/season-{year}/standings",
        f"https://admin.fia.com/events/f3-championship/season-{year}/{year}-standings",
        f"https://admin.fia.com/events/fia-formula-3-championship/season-{year}/{year}-standings",
    ]

def extract_table_title(table) -> str:
    title = table.find("th", class_="table-head")
    return title.get_text(" ", strip=True) if title else ""

def parse_fia_table(table, kind: str, year: int) -> tuple[list[dict], list[dict]]:
    """Return season standings and per-session results when FIA exposes them."""
    rows = table.find_all("tr")
    competition_rows = [row for row in rows if "competitor" in (row.get("class") or [])]
    if not competition_rows:
        return [], []

    header_rows = [row for row in rows if row.find_all("th", recursive=False)]
    main_header = None
    for row in header_rows:
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all("th", recursive=False)]
        if len(cells) >= 3 and cells[0].lower().startswith("pos") and (
            "driver" in cells[1].lower() or "team" in cells[1].lower()
        ):
            main_header = row
            break

    sub_header = None
    for row in header_rows:
        values = [cell.get_text(" ", strip=True).upper() for cell in row.find_all("th", recursive=False)]
        if "R1" in values and "R2" in values:
            sub_header = row
            break

    event_headers = []
    if main_header:
        header_cells = main_header.find_all("th", recursive=False)
        for cell in header_cells[2:]:
            label = cell.get_text(" ", strip=True)
            if label.lower() in ("pts", "points"):
                continue
            colspan = int(cell.get("colspan", 1) or 1)
            event_headers.extend([label] * max(1, colspan))

    session_headers = []
    if sub_header:
        session_headers = [
            cell.get_text(" ", strip=True).upper()
            for cell in sub_header.find_all("th", recursive=False)
            if cell.get_text(" ", strip=True).upper() in ("R1", "R2")
        ]

    standings = []
    raw_rows = []
    result_candidates = []
    for row in competition_rows:
        cells = row.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        rank = position_text(cells[0].get_text(" ", strip=True))
        if kind == "drivers":
            identity_cell = row.find("td", class_="driver") or cells[1]
            name_node = identity_cell.find(class_="name")
            display_name = name_node.get_text(" ", strip=True) if name_node else identity_cell.get_text(" ", strip=True)
            country_node = identity_cell.find(class_="country")
            image = country_node.find("img") if country_node else identity_cell.find("img")
            nationality = ""
            if country_node:
                country_text = country_node.get_text(" ", strip=True)
                nationality = country_text.split()[-1] if country_text else ""
            if image and image.get("alt"):
                nationality = nationality or image.get("alt", "")
            display_name = re.sub(r"\s+", " ", display_name).strip()
            driver = person_from_standings(display_name, nationality)
            points_cell = row.find("td", class_="points")
            points = number_from_text(points_cell.get_text(" ", strip=True) if points_cell else cells[-1].get_text(" ", strip=True))
            standing = {
                "position": rank,
                "Driver": driver,
                "Constructors": [],
                "wins": None,
                "podiums": None,
                "points": points,
            }
            raw_rows.append((driver, row))
        else:
            team_cell = row.find("td", class_="team") or cells[1]
            team_name = team_cell.get_text(" ", strip=True)
            team_name = re.sub(r"\s+", " ", team_name).strip()
            points_cell = row.find("td", class_="points")
            points = number_from_text(points_cell.get_text(" ", strip=True) if points_cell else cells[-1].get_text(" ", strip=True))
            standing = {
                "position": rank,
                "Constructor": {"name": team_name, "nationality": ""},
                "wins": None,
                "points": points,
            }
        standings.append(standing)

    results_by_round: dict[int, dict] = {}
    if kind == "drivers":
        # Newer FIA archive tables encode each event session as a cell with points (pt_base)
        # and finishing place/status (blue). Older tables only provide one aggregate points cell per event.
        session_count = len(session_headers) if session_headers else 1
        for driver, row in raw_rows:
            points_cells = [
                cell for cell in row.find_all("td", recursive=False)
                if "pts" in (cell.get("class") or [])
            ]
            for cell_index, cell in enumerate(points_cells):
                place_node = cell.find(class_="blue")
                place = position_text(place_node.get_text(" ", strip=True) if place_node else "")
                if not place:
                    continue
                if session_headers:
                    event_index = cell_index // session_count
                    session_code = session_headers[cell_index % session_count]
                else:
                    event_index = cell_index
                    session_code = "RACE"
                if event_headers and event_index < len(event_headers):
                    event_code = event_headers[event_index]
                else:
                    event_code = f"Round {event_index + 1}"
                round_number = event_index + 1
                if round_number not in results_by_round:
                    results_by_round[round_number] = {
                        "round": str(round_number),
                        "raceName": f"Round {round_number} · {event_code}",
                        "date": None,
                        "Circuit": {"circuitName": event_code},
                        "Results": [],
                    }
                result = {
                    "Driver": driver,
                    "Constructor": {"name": ""},
                    "position": place,
                    "points": number_from_text((cell.find(class_="pt_base") or cell).get_text(" ", strip=True)),
                    "session": ("Race 1" if session_code == "R1" else "Race 2") if session_code in ("R1", "R2") else "Race",
                }
                results_by_round[round_number]["Results"].append(result)

    return standings, list(results_by_round.values())

def fetch_fia_season(series: str, year: int) -> tuple[list[dict], list[dict], list[dict], str]:
    last_problem = None
    for url in get_fia_urls(series, year):
        try:
            html, final_url = fetch_text(url, attempts=3)
            soup = BeautifulSoup(html, "html.parser")
            season_marker = soup.get_text(" ", strip=True)
            if str(year) not in season_marker:
                raise RuntimeError("The page did not contain the requested season year")
            driver_table = None
            team_table = None
            for table in soup.find_all("table"):
                title = extract_table_title(table).lower()
                if not table.select("tr.competitor"):
                    continue
                if "driver" in title or table.find("td", class_="driver"):
                    driver_table = table
                elif "team" in title or table.find("td", class_="team"):
                    team_table = table
            if not driver_table:
                raise RuntimeError("No driver standings table found")
            drivers, session_races = parse_fia_table(driver_table, "drivers", year)
            teams = parse_fia_table(team_table, "teams", year)[0] if team_table else []
            if not drivers:
                raise RuntimeError("Driver standings table was empty")
            return drivers, teams, session_races, final_url
        except Exception as exc:
            last_problem = exc
            print(f"  FIA archive attempt failed ({url}): {exc}", flush=True)
    raise RuntimeError(f"Could not find FIA {series.upper()} {year} standings: {last_problem}")

def parse_time_seconds(value: str | None) -> float | None:
    text = str(value or "").strip()
    if not text or text in ("-", "—"):
        return None
    try:
        parts = [float(part) for part in text.split(":")]
        if len(parts) == 2:
            return parts[0] * 60 + parts[1]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        return float(text)
    except (ValueError, TypeError):
        return None

def fetch_f2_csv(year: int, standings: list[dict]) -> tuple[list[dict], dict]:
    url = f"https://raw.githubusercontent.com/Alarchemn/F2-Data-Pipeline/main/DATA/season/season_{year}.csv"
    text, _ = fetch_text(url, attempts=4)
    reader = csv.DictReader(io.StringIO(text))
    required = {"POS", "PILOT NAME", "TEAM", "CIRCUIT", "TYPE", "ROUND"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise RuntimeError(f"F2 CSV {year} did not include expected columns")
    grouped: dict[int, dict] = {}
    session_times: dict[tuple[int, str], list[tuple[float, dict]]] = defaultdict(list)
    team_counts = Counter()
    driver_teams = defaultdict(Counter)
    for raw in reader:
        session = (raw.get("TYPE") or "").strip()
        if session not in ("Sprint Race", "Feature Race"):
            continue
        round_match = re.search(r"\d+", raw.get("ROUND", ""))
        if not round_match:
            continue
        round_number = int(round_match.group(0))
        circuit = (raw.get("CIRCUIT") or "").strip()
        date = (raw.get("DATE") or "").strip() or None
        event = grouped.setdefault(round_number, {
            "round": str(round_number),
            "raceName": f"{circuit} · Round {round_number}",
            "date": date,
            "Circuit": {"circuitName": circuit},
            "Results": [],
        })
        display_name = (raw.get("PILOT NAME") or "").strip()
        driver = match_person(display_name, standings)
        team_name = (raw.get("TEAM") or "").strip()
        driver_teams[normalize(display_name.split()[-1])][team_name] += 1
        position_number = number_from_text(raw.get("POS"))
        position = str(int(position_number)) if isinstance(position_number, (int, float)) and float(position_number).is_integer() else position_text(raw.get("POS"))
        best = (raw.get("BEST") or "").strip()
        best_seconds = parse_time_seconds(best)
        result = {
            "Driver": driver,
            "Constructor": {"name": team_name},
            "position": position or "—",
            "points": None,
            "session": session,
            "laps": number_from_text(raw.get("LAPS")),
            "Time": {"time": (raw.get("TIME") or "").strip()},
            "gap": (raw.get("GAP") or "").strip(),
            "status": (raw.get("TIME") or "").strip() if not position or not position.isdigit() else "Finished",
            "FastestLap": {"lap": (raw.get("LAP") or "").strip(), "Time": {"time": best}},
        }
        event["Results"].append(result)
        if best_seconds is not None:
            session_times[(round_number, session)].append((best_seconds, result))
    # A best-lap rank is only assigned when the imported session has a best-lap time.
    for _, entries in session_times.items():
        fastest = min(entries, key=lambda item: item[0])[1]
        fastest["FastestLap"]["rank"] = "1"
    # Use a stable driver-team association for the standings card (the most frequent team in the season).
    team_by_driver = {driver: counts.most_common(1)[0][0] for driver, counts in driver_teams.items() if counts}
    return [grouped[key] for key in sorted(grouped)], team_by_driver


def wiki_page_url(series: str, year: int) -> str:
    if series == "f2":
        return f"https://en.wikipedia.org/wiki/{year}_Formula_2_Championship"
    return f"https://en.wikipedia.org/wiki/{year}_FIA_Formula_3_Championship"


def section_table(soup, phrase: str):
    target = normalize(phrase)
    for heading in soup.find_all(re.compile(r"^h[2-6]$")):
        if target in normalize(heading.get_text(" ", strip=True)):
            table = heading.find_next("table", class_="wikitable")
            if table:
                return table
    return None


def anchor_or_cell_text(cell) -> str:
    """Extract a real entity label, ignoring superscript citation/footnote links."""
    labels = []
    for anchor in cell.find_all("a"):
        href = str(anchor.get("href") or "")
        label = anchor.get_text(" ", strip=True)
        if not label or not href or href.startswith("#"):
            continue
        if "cite_note" in href.lower() or "citation" in href.lower():
            continue
        if anchor.find_parent("sup"):
            continue
        if re.fullmatch(r"\[\s*[a-z0-9]+\s*\]", label, re.I):
            continue
        labels.append(label)
    value = labels[-1] if labels else cell.get_text(" ", strip=True)
    value = re.sub(r"\[\s*(?:\d+|[a-z])\s*\]", "", value, flags=re.I)
    value = re.sub(r"\s+", " ", value).strip(" ,·")
    if len(normalize(value)) <= 1:
        return ""
    return value



def parse_wiki_standings(table, kind: str) -> list[dict]:
    standings = []
    for row in table.find_all("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if len(cells) < 3:
            continue
        rank_text = cells[0].get_text(" ", strip=True)
        rank_match = re.match(r"^\s*(\d+)", rank_text)
        if not rank_match:
            continue
        rank = rank_match.group(1)
        identity = anchor_or_cell_text(cells[1])
        points = number_from_text(cells[-1].get_text(" ", strip=True))
        if not identity or points is None:
            continue
        if kind == "teams":
            invalid_team_labels = {"ret", "nc", "dnf", "dns", "dsq", "wd", "c", "na"}
            if normalize(identity) in invalid_team_labels or not re.search(r"[A-Za-z]", identity):
                continue
        if kind == "drivers":
            standings.append({
                "position": rank,
                "Driver": person_from_standings(identity),
                "Constructors": [],
                "wins": None,
                "podiums": None,
                "points": points,
            })
        else:
            standings.append({
                "position": rank,
                "Constructor": {"name": identity, "nationality": ""},
                "wins": None,
                "podiums": None,
                "points": points,
            })
    return standings


def session_name(code: str) -> str:
    code = re.sub(r"\s+", " ", str(code or "")).strip().upper()
    if code in ("F", "FR", "FEATURE", "FEATURE RACE", "R2"):
        return "Feature Race" if code != "R2" else "Race 2"
    if code in ("S", "SR", "SPRINT", "SPRINT RACE", "R1"):
        return "Sprint Race" if code != "R1" else "Race 1"
    if code == "RACE":
        return "Race"
    return code.title() if code else "Race"


def wiki_season_summary(soup, series: str, year: int) -> list[dict]:
    summary_table = section_table(soup, "Season summary")
    if not summary_table:
        print(f"  No season-summary table found for {series.upper()} {year}", flush=True)
        return []

    events: dict[int, dict] = {}
    current_round = None
    current_circuit = ""

    def value(cells, index):
        return anchor_or_cell_text(cells[index]) if len(cells) > index else ""

    for row in summary_table.find_all("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if not cells:
            continue
        text_cells = [cell.get_text(" ", strip=True) for cell in cells]
        first = re.sub(r"\[\s*\d+\s*\]", "", text_cells[0]).strip()
        if first.lower() in ("round", "key", "colour", "color", "source"):
            continue

        if first.isdigit():
            current_round = int(first)
            if len(cells) >= 8:
                # Common F2/F3 table: Round, session code, circuit, pole, fastest, winner, team, report.
                code = text_cells[1].strip()
                current_circuit = value(cells, 2)
                pole = value(cells, 3)
                fastest = value(cells, 4)
                winner = value(cells, 5)
                team = value(cells, 6)
            elif len(cells) >= 7:
                # Single-session summary table: Round, circuit, pole, fastest, winner, team, report.
                code = "RACE"
                current_circuit = value(cells, 1)
                pole = value(cells, 2)
                fastest = value(cells, 3)
                winner = value(cells, 4)
                team = value(cells, 5)
            else:
                continue
        elif first.upper() in ("F", "S", "FR", "SR", "R1", "R2", "FEATURE", "SPRINT", "FEATURE RACE", "SPRINT RACE"):
            if current_round is None:
                continue
            code = first
            if len(cells) >= 6:
                # Sub-row: session code, inherited circuit, pole, fastest, winner, team.
                pole = value(cells, 2)
                fastest = value(cells, 3)
                winner = value(cells, 4)
                team = value(cells, 5)
            elif len(cells) >= 5:
                # Sub-row with no explicit inherited-circuit cell.
                pole = value(cells, 1)
                fastest = value(cells, 2)
                winner = value(cells, 3)
                team = value(cells, 4)
            else:
                continue
        else:
            continue

        if not winner or winner.lower() in ("tbd", "cancelled", "—", "-", "not held"):
            continue
        if current_round not in events:
            events[current_round] = {
                "round": str(current_round),
                "raceName": current_circuit or f"Round {current_round}",
                "date": None,
                "Circuit": {"circuitName": current_circuit or f"Round {current_round}"},
                "Results": [],
            }
        events[current_round]["Results"].append({
            "wikiWinnerName": winner,
            "wikiTeamName": team,
            "position": "1",
            "points": None,
            "session": session_name(code),
            "poleDriverName": pole or None,
            "fastestLapDriverName": fastest or None,
        })
    return [events[key] for key in sorted(events)]


def fetch_wikipedia_season(series: str, year: int) -> tuple[list[dict], list[dict], list[dict], str]:
    url = wiki_page_url(series, year)
    html, final_url = fetch_text(url, attempts=4)
    soup = BeautifulSoup(html, "html.parser")
    page_text = soup.get_text(" ", strip=True)
    if str(year) not in page_text:
        raise RuntimeError(f"Wikipedia page did not contain requested season {year}")

    driver_table = section_table(soup, "Drivers' championship")
    if not driver_table:
        driver_table = section_table(soup, "Drivers' Championship standings")
    team_table = section_table(soup, "Teams' championship")
    if not team_table:
        team_table = section_table(soup, "Teams' Championship standings")

    drivers = parse_wiki_standings(driver_table, "drivers") if driver_table else []
    teams = parse_wiki_standings(team_table, "teams") if team_table else []
    if not drivers:
        raise RuntimeError(f"No driver championship table found on {final_url}")
    races = wiki_season_summary(soup, series, year)
    return drivers, teams, races, final_url


def match_person(display: str, standings: list[dict]) -> dict:
    key = normalize(display)
    surname = normalize(display.split()[-1]) if display.split() else ""
    exact = []
    surname_matches = []
    for entry in standings:
        person = entry.get("Driver", {})
        full = normalize(person.get("familyName", ""))
        if full == key:
            exact.append(person)
        elif surname and full.endswith(surname):
            surname_matches.append(person)
    if len(exact) == 1:
        return exact[0]
    if len(surname_matches) == 1:
        return surname_matches[0]
    return person_from_standings(display)

def add_wikipedia_summary_records(races: list[dict], wiki_races: list[dict], drivers: list[dict]) -> None:
    by_round = {int(r["round"]): r for r in races}
    for wiki_event in wiki_races:
        round_number = int(wiki_event["round"])
        event = by_round.get(round_number)
        if not event:
            event = {
                "round": str(round_number),
                "raceName": wiki_event["raceName"],
                "date": None,
                "Circuit": wiki_event["Circuit"],
                "Results": [],
            }
            races.append(event)
            by_round[round_number] = event
        for summary in wiki_event["Results"]:
            winner_name = summary.pop("wikiWinnerName", "")
            winner = match_person(winner_name, drivers) if winner_name else None
            team_name = summary.pop("wikiTeamName", "")
            pole_name = summary.pop("poleDriverName", None)
            fastest_name = summary.pop("fastestLapDriverName", None)
            session = summary.get("session")
            has_fia_race_numbers = any(x.get("session") in ("Race 1", "Race 2") for x in event.get("Results", []))
            if has_fia_race_numbers:
                session = "Race 1" if session == "Sprint Race" else "Race 2" if session == "Feature Race" else session
            existing = next((x for x in event["Results"] if x.get("session") == session and x.get("position") == "1"), None)
            if winner:
                if not existing:
                    existing = {
                        "Driver": winner,
                        "Constructor": {"name": team_name or ""},
                        "position": "1",
                        "points": None,
                        "session": session,
                        "source": "Wikipedia season summary",
                    }
                    event["Results"].append(existing)
                else:
                    # wiki_season_summary is passed as both the source and destination in recent seasons.
                    # The matching row is therefore already in the event; enrich it instead of leaving
                    # the championship winner without a Driver object.
                    if not existing.get("Driver"):
                        existing["Driver"] = winner
                    if not existing.get("Constructor", {}).get("name") and team_name:
                        existing["Constructor"] = {"name": team_name}
                    existing["source"] = "Wikipedia season summary"
            if pole_name and session not in ("Sprint Race", "Race 2"):
                pole_driver = match_person(pole_name, drivers)
                event["Results"].append({
                    "Driver": pole_driver, "position": "—", "points": None,
                    "session": session, "PolePosition": True, "isRecordOnly": True,
                })
            if fastest_name:
                fastest_driver = match_person(fastest_name, drivers)
                event["Results"].append({
                    "Driver": fastest_driver, "position": "—", "points": None,
                    "session": session, "FastestLap": {"rank": "1"}, "isRecordOnly": True,
                })
    races.sort(key=lambda item: int(item["round"]))


def compute_standings_stats(drivers: list[dict], teams: list[dict], races: list[dict], coverage: dict) -> None:
    full = coverage.get("classification") == "full"
    wins_available = bool(coverage.get("wins", full))
    podiums_available = bool(coverage.get("podiums", full))
    fastest_available = bool(coverage.get("fastestLap"))
    poles_available = bool(coverage.get("polePosition"))
    driver_map = {}
    team_map = {}
    team_wins_available = bool(coverage.get("teamWins", coverage.get("wins", wins_available)))
    team_podiums_available = bool(coverage.get("teamPodiums", coverage.get("podiums", podiums_available)))
    for item in drivers:
        d = item.get("Driver", {})
        item["wins"] = 0 if wins_available else None
        item["podiums"] = 0 if podiums_available else None
        item["fastestLaps"] = 0 if fastest_available else None
        item["poles"] = 0 if poles_available else None
        driver_map[d.get("driverId")] = item
    for item in teams:
        c = item.get("Constructor", {})
        item["wins"] = 0 if team_wins_available else None
        item["podiums"] = 0 if team_podiums_available else None
        team_map[normalize(c.get("name"))] = item

    for event in races:
        for result in event.get("Results", []):
            d = result.get("Driver", {})
            driver = driver_map.get(d.get("driverId"))
            constructor = result.get("Constructor", {}).get("name", "")
            team = team_map.get(normalize(constructor))
            if result.get("PolePosition") and driver and driver.get("poles") is not None:
                driver["poles"] += 1
            if result.get("FastestLap") and result["FastestLap"].get("rank") == "1" and driver and driver.get("fastestLaps") is not None:
                driver["fastestLaps"] += 1
            if result.get("isRecordOnly"):
                continue
            position = str(result.get("position", "")).strip()
            try:
                p = int(position)
            except (ValueError, TypeError):
                continue
            if p == 1:
                if driver and driver.get("wins") is not None:
                    driver["wins"] += 1
                if team and team.get("wins") is not None:
                    team["wins"] += 1
            if 1 <= p <= 3:
                if driver and driver.get("podiums") is not None:
                    driver["podiums"] += 1
                if team and team.get("podiums") is not None:
                    team["podiums"] += 1

def attach_f2_teams(drivers: list[dict], team_by_surname: dict) -> None:
    for item in drivers:
        driver = item.get("Driver", {})
        full_name = driver.get("familyName", "")
        surname = normalize(full_name.split()[-1]) if full_name.split() else ""
        team = team_by_surname.get(surname)
        if team:
            item["Constructors"] = [{"name": team}]



def archive_has_bad_team_rows(output: Path) -> bool:
    if not output.exists():
        return False
    try:
        data = json.loads(output.read_text(encoding="utf-8"))
        teams = data.get("constructorStandings", [])
        invalid = {"ret", "nc", "dnf", "dns", "dsq", "wd", "c", "na"}
        for entry in teams:
            name = str(entry.get("Constructor", {}).get("name", "")).strip()
            if not name or normalize(name) in invalid or not re.search(r"[A-Za-z]", name):
                return True
        return False
    except Exception:
        return True


def import_season(series: str, year: int, force: bool = False) -> bool:
    output = DATA / series / f"{year}.json"
    if output.exists() and year != YEAR_NOW and not force and not archive_has_bad_team_rows(output):
        print(f"Keeping existing {series.upper()} {year} archive")
        return True
    if output.exists() and year != YEAR_NOW and archive_has_bad_team_rows(output):
        print(f"Refreshing {series.upper()} {year}: invalid team rows found in prior snapshot")

    print(f"Importing {series.upper()} {year}", flush=True)
    drivers, teams, summary_races, page_url = fetch_wikipedia_season(series, year)
    sources = [{
        "name": "Wikipedia season article (CC BY-SA 4.0; source references in article)",
        "url": page_url,
    }]
    races = summary_races
    summary_available = bool(summary_races)

    if series == "f2" and year <= 2023:
        races, team_by_surname = fetch_f2_csv(year, drivers)
        attach_f2_teams(drivers, team_by_surname)
        sources.append({
            "name": "Alarchemn F2 historical race classifications (MIT)",
            "url": f"https://github.com/Alarchemn/F2-Data-Pipeline/tree/main/DATA/season/season_{year}.csv",
        })
        coverage = {
            "classification": "full",
            "wins": True,
            "podiums": True,
            "fastestLap": True,
            "polePosition": summary_available,
            "teamWins": True,
            "teamPodiums": True,
            "message": "Final championship points and standings come from the season article. Full Sprint/Feature classifications with laps, race time, gaps and best laps are imported from the cited MIT-licensed historical F2 archive. The CSV does not publish race-session points.",
        }
        # Add qualifying pole records from the season summary, but keep its winner rows out:
        # the CSV already contains the classified finishers and race winners.
        summary_for_records = []
        for event in summary_races:
            cloned = {**event, "Results": []}
            for row in event.get("Results", []):
                if row.get("poleDriverName") or row.get("fastestLapDriverName"):
                    cloned["Results"].append({
                        **row,
                        "wikiWinnerName": "",
                        "position": "—",
                    })
            if cloned["Results"]:
                summary_for_records.append(cloned)
        add_wikipedia_summary_records(races, summary_for_records, drivers)
    elif series == "f2":
        # Recent F2 seasons have a season-summary archive, but not a complete timing feed.
        add_wikipedia_summary_records(races, summary_races, drivers)
        coverage = {
            "classification": "winners-only" if summary_available else "standings-only",
            "wins": summary_available,
            "podiums": False,
            "fastestLap": summary_available,
            "polePosition": summary_available,
            "teamWins": summary_available,
            "teamPodiums": False,
            "message": "Final season standings and championship points are archived. Event summaries provide Sprint/Feature winners, poles and fastest-lap drivers where published; full finishing orders and podium totals are not supplied by this source.",
        }
    else:
        add_wikipedia_summary_records(races, summary_races, drivers)
        coverage = {
            "classification": "winners-only" if summary_available else "standings-only",
            "wins": summary_available,
            "podiums": False,
            "fastestLap": summary_available,
            "polePosition": summary_available,
            "teamWins": summary_available,
            "teamPodiums": False,
            "message": "Final season standings and championship points are archived. Event summaries provide Sprint/Feature winners, poles and fastest-lap drivers where published; full finishing orders and podium totals are not supplied by this source.",
        }

    if not drivers:
        raise RuntimeError(f"{series.upper()} {year}: empty driver standings; refusing to save an empty season file")
    if not teams:
        print(f"  Warning: team championship table not found for {series.upper()} {year}", flush=True)

    compute_standings_stats(drivers, teams, races, coverage)
    calendar = [{
        "round": r.get("round"), "raceName": r.get("raceName"),
        "date": r.get("date"), "dateEnd": r.get("date"),
        "Circuit": r.get("Circuit") or {},
        "sessionTypes": ["Practice", "Qualifying", "Sprint Race", "Feature Race"],
        "scheduleSource": "Season race archive",
    } for r in races]
    if year == 2026:
        if series == "f2":
            schedule_2026 = [
                (1,"Melbourne","2026-03-06","2026-03-08","Melbourne","Australia"),
                (2,"Miami","2026-05-01","2026-05-03","Miami Gardens","USA"),
                (3,"Montréal","2026-05-22","2026-05-24","Montréal","Canada"),
                (4,"Monte Carlo","2026-06-04","2026-06-07","Monte Carlo","Monaco"),
                (5,"Barcelona-Catalunya","2026-06-12","2026-06-14","Barcelona","Spain"),
                (6,"Spielberg","2026-06-26","2026-06-28","Spielberg","Austria"),
                (7,"Silverstone","2026-07-03","2026-07-05","Silverstone","United Kingdom"),
                (8,"Spa-Francorchamps","2026-07-17","2026-07-19","Stavelot","Belgium"),
                (9,"Budapest","2026-07-24","2026-07-26","Budapest","Hungary"),
                (10,"Monza","2026-09-04","2026-09-06","Monza","Italy"),
                (11,"Madrid","2026-09-11","2026-09-13","Madrid","Spain"),
                (12,"Baku","2026-09-24","2026-09-26","Baku","Azerbaijan"),
                (13,"Lusail","2026-11-27","2026-11-29","Lusail","Qatar"),
                (14,"Yas Marina","2026-12-04","2026-12-06","Abu Dhabi","UAE"),
            ]
            calendar_source = "Official FIA Formula 2 2026 calendar"
            calendar_url = "https://www.fiaformula2.com/en/latest/article/fia-formula-2-championship-2026-season-calendar-revealed.28OvYB98ektUm0D8vrUgYS"
        else:
            schedule_2026 = [
                (1,"Melbourne","2026-03-06","2026-03-08","Melbourne","Australia"),
                (2,"Monte Carlo","2026-06-04","2026-06-07","Monte Carlo","Monaco"),
                (3,"Barcelona-Catalunya","2026-06-12","2026-06-14","Barcelona","Spain"),
                (4,"Spielberg","2026-06-26","2026-06-28","Spielberg","Austria"),
                (5,"Silverstone","2026-07-03","2026-07-05","Silverstone","United Kingdom"),
                (6,"Spa-Francorchamps","2026-07-17","2026-07-19","Stavelot","Belgium"),
                (7,"Budapest","2026-07-24","2026-07-26","Budapest","Hungary"),
                (8,"Monza","2026-09-04","2026-09-06","Monza","Italy"),
                (9,"Madrid","2026-09-11","2026-09-13","Madrid","Spain"),
            ]
            calendar_source = "Official FIA Formula 3 2026 calendar"
            calendar_url = "https://www.fiaformula3.com/en/racing/2026"
        actual_by_round = {str(item.get("round")): item for item in calendar}
        calendar = []
        for round_no, venue, date_start, date_end, locality, country in schedule_2026:
            actual = actual_by_round.get(str(round_no), {})
            circuit = dict(actual.get("Circuit") or {})
            circuit.setdefault("circuitName", venue)
            circuit.setdefault("Location", {"locality": locality, "country": country})
            session_types = ["Practice", "Qualifying", "Sprint Race", "Feature Race"]
            if series == "f2" and round_no == 12:
                session_types = ["Practice", "Qualifying 1", "Qualifying 2", "Sprint Race", "Feature Race 1", "Feature Race 2"]
            if series == "f3" and round_no == 9:
                session_types = ["Practice", "Qualifying 1", "Qualifying 2", "Sprint Race", "Feature Race 1", "Feature Race 2"]
            calendar.append({
                **actual,
                "round": str(round_no),
                "raceName": actual.get("raceName") or venue,
                "date": date_start,
                "dateEnd": date_end,
                "Circuit": circuit,
                "sessionTypes": session_types,
                "scheduleSource": calendar_source
            })
        sources.append({"name": calendar_source, "url": calendar_url})
    data = {
        "series": series,
        "season": year,
        "updatedAt": utc_now(),
        "source": "Wikipedia season article and cited source material",
        "sources": sources,
        "coverage": coverage,
        "calendar": calendar,
        "driverStandings": drivers,
        "constructorStandings": teams,
        "races": races,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(output)
    race_sessions = sum(len({x.get("session") for x in r.get("Results", []) if not x.get("isRecordOnly")}) for r in races)
    print(f"  saved {output.relative_to(ROOT)}: {len(drivers)} drivers, {len(teams)} teams, {len(races)} rounds, {race_sessions} sessions; coverage={coverage['classification']}", flush=True)
    return True



def main() -> int:
    failures = []
    DATA.joinpath("f2").mkdir(parents=True, exist_ok=True)
    DATA.joinpath("f3").mkdir(parents=True, exist_ok=True)
    for series, first_year in (("f2", 2017), ("f3", 2019)):
        for year in range(first_year, YEAR_NOW + 1):
            try:
                import_season(series, year)
            except Exception as exc:
                print(f"ERROR importing {series.upper()} {year}: {exc}", flush=True)
                failures.append(f"{series.upper()} {year}: {exc}")
                # Continue so one unavailable article does not prevent all later seasons importing.
                continue

    required = (("f2", 2017), ("f2", YEAR_NOW), ("f3", 2019), ("f3", YEAR_NOW))
    for series, year in required:
        path = DATA / series / f"{year}.json"
        if not path.exists():
            failures.append(f"Missing required archive {path.relative_to(ROOT)}")

    if failures:
        print("F2/F3 import warnings:", file=sys.stderr)
        for failure in failures:
            print(" - " + failure, file=sys.stderr)
        # Return failure only if one of the required boundary years is missing.
        missing_required = [
            f"{series.upper()} {year}"
            for series, year in required
            if not (DATA / series / f"{year}.json").exists()
        ]
        return 1 if missing_required else 0
    return 0



if __name__ == "__main__":
    raise SystemExit(main())
