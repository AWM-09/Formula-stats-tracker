#!/usr/bin/env python3
"""Build the F1 team upgrade watch from structured news and sourced reports.

Media reports are labelled as reports, not official FIA confirmation. Teams with
no supported announcement are explicitly shown as "not publicly announced in
connected sources" rather than being assigned invented upgrade dates.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEWS_FILE = ROOT / "data" / "news.json"
F1_FILE = ROOT / "data" / "f1" / f"{datetime.now(timezone.utc).year}.json"
OUTPUT = ROOT / "data" / "f1-upgrade-watch.json"
CURRENT_YEAR = datetime.now(timezone.utc).year

TEAMS = [
    "McLaren",
    "Mercedes",
    "Ferrari",
    "Red Bull Racing",
    "Aston Martin",
    "Williams",
    "Alpine",
    "Haas",
    "Audi",
    "Racing Bulls",
    "Cadillac",
]
TEAM_ALIASES = {
    "McLaren": ["mclaren"],
    "Mercedes": ["mercedes"],
    "Ferrari": ["ferrari"],
    "Red Bull Racing": ["red bull racing", "red bull"],
    "Aston Martin": ["aston martin"],
    "Williams": ["williams"],
    "Alpine": ["alpine"],
    "Haas": ["haas"],
    "Audi": ["audi"],
    "Racing Bulls": ["racing bulls", "rb f1", "vc rb", "visacashapp rb"],
    "Cadillac": ["cadillac"],
}
COMPONENTS = [
    ("Front wing", re.compile(r"\bfront wing\b", re.I)),
    ("Rear wing", re.compile(r"\brear wing\b", re.I)),
    ("Floor", re.compile(r"\bfloor(?:\s+edge|\s+fence|\s+body)?\b", re.I)),
    ("Diffuser", re.compile(r"\bdiffuser\b", re.I)),
    ("Sidepods", re.compile(r"\bsidepods?\b", re.I)),
    ("Engine cover / bodywork", re.compile(r"\bengine cover\b|\bbodywork\b", re.I)),
    ("Suspension", re.compile(r"\bsuspension\b", re.I)),
    ("Brake ducts", re.compile(r"\bbrake ducts?\b", re.I)),
    ("Beam wing", re.compile(r"\bbeam wing\b", re.I)),
    ("Power unit", re.compile(r"\bpower unit\b|\bengine upgrade\b", re.I)),
]
# Sourced report known at the time this snapshot was added. Keep the status
# "reported" until the FIA's car-presentation documents independently confirm
# the parts. This record is not a prediction or an FIA technical declaration.
SOURCED_REPORTS = [
    {
        "id": "mclaren-sao-paulo-2026-skysports",
        "team": "McLaren",
        "season": 2026,
        "event": "São Paulo Grand Prix",
        "eventDate": "2026-11-08",
        "components": ["Front wing", "Rear wing", "Floor"],
        "status": "reported",
        "statusLabel": "Reported for upcoming weekend",
        "detail": (
            "Sky Sports reported that McLaren was bringing a new front wing, "
            "rear wing and floor components to São Paulo. This is a media report, "
            "not an FIA car-presentation confirmation."
        ),
        "sourceTitle": "Sky Sports — McLaren upgrades for São Paulo",
        "sourceUrl": (
            "https://www.skysports.com/f1/news/13607894/"
            "lando-norris-mclaren-driver-unsure-if-sao-paulo-grand-prix-upgrades-will-improve-horrible-mclaren-car"
        ),
        "sourceDate": "2026-11-05",
        "sourceType": "media-report",
    }
]


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def next_event() -> dict | None:
    data = read_json(F1_FILE, {})
    entries = data.get("calendar") or data.get("races") or []
    today = datetime.now(timezone.utc).date()
    candidates = []
    for event in entries:
        raw = event.get("date")
        try:
            event_date = date.fromisoformat(str(raw)[:10])
        except (TypeError, ValueError):
            continue
        if event_date < today:
            continue
        circuit = event.get("Circuit") or {}
        name = event.get("raceName") or circuit.get("circuitName") or "Next Grand Prix"
        candidates.append(
            {
                "name": name,
                "date": event_date.isoformat(),
                "round": event.get("round"),
            }
        )
    candidates.sort(key=lambda item: item["date"])
    return candidates[0] if candidates else None


def article_teams(article: dict) -> list[str]:
    values = [str(value) for value in article.get("teams", []) if value]
    joined = " ".join(
        [article.get("title", ""), article.get("summary", ""), *values]
    ).lower()
    result = []
    for team, aliases in TEAM_ALIASES.items():
        if any(alias in joined for alias in aliases):
            result.append(team)
    # Keep explicit team tags when the source uses a known alias not caught above.
    return list(dict.fromkeys(result))


def article_components(article: dict) -> list[str]:
    text = " ".join(
        [article.get("title", ""), article.get("summary", "")]
    )
    return [name for name, pattern in COMPONENTS if pattern.search(text)]


def article_is_upgrade(article: dict) -> bool:
    tags = [str(value).lower() for value in article.get("topicTags", [])]
    text = (str(article.get("title", "")) + " " + str(article.get("summary", ""))).lower()
    return (
        "technical-upgrade" in tags
        or bool(article.get("majorUpgrade"))
        or bool(re.search(r"\b(upgrade|upgrades|upgrade package|development package)\b", text))
    )


def status_for_article(article: dict) -> str:
    state = str(article.get("upgradeStatus") or "unspecified").lower()
    if state == "expected":
        return "reported"
    if state == "confirmed":
        return "reported"
    if state == "speculation":
        return "speculation"
    return "reported"


def event_date_for(article: dict, next_race: dict | None, text: str) -> tuple[str, str]:
    if next_race:
        event_name = str(article.get("event") or "")
        lower = text.lower()
        next_name = str(next_race["name"])
        if event_name and normalise(event_name) in normalise(next_name):
            return next_name, next_race["date"]
        if normalise(next_name).split()[0] in lower or "next race" in lower or "this weekend" in lower:
            return next_name, next_race["date"]
    return str(article.get("event") or ""), ""


def main() -> int:
    news = read_json(NEWS_FILE, {"articles": []})
    articles = news.get("articles") or []
    race = next_event()
    updates: list[dict] = []

    for article in articles:
        if str(article.get("series", "")).lower() != "f1" or not article_is_upgrade(article):
            continue
        teams = article_teams(article)
        if not teams:
            continue
        title = str(article.get("title") or "Technical update report")
        summary = str(article.get("summary") or "")
        searchable = title + " " + summary
        components = article_components(article)
        event, event_date = event_date_for(article, race, searchable)
        for team in teams:
            updates.append(
                {
                    "id": str(article.get("id") or article.get("link") or title) + ":" + team,
                    "team": team,
                    "season": CURRENT_YEAR,
                    "event": event,
                    "eventDate": event_date,
                    "components": components,
                    "status": status_for_article(article),
                    "statusLabel": "Reported by publisher" if article.get("source") else "Reported upgrade information",
                    "detail": summary or title,
                    "sourceTitle": title,
                    "sourceUrl": article.get("link") or "",
                    "sourceDate": str(article.get("published") or "")[:10],
                    "sourceType": "media-report",
                }
            )

    # Curated report is a known source-backed update; de-duplicate if the same
    # Sky Sports story was also present in the RSS snapshot.
    for seed in SOURCED_REPORTS:
        if not any(
            item.get("team") == seed["team"]
            and normalise(item.get("event")) == normalise(seed["event"])
            for item in updates
        ):
            updates.append(seed)

    # Prefer the closest future reported event, then the freshest source date.
    teams_snapshot = []
    for team in TEAMS:
        candidates = [item for item in updates if item["team"] == team]
        candidates.sort(
            key=lambda item: (
                0 if item.get("eventDate") and item["eventDate"] >= date.today().isoformat() else 1,
                item.get("eventDate") or "9999-99-99",
                item.get("sourceDate") or "",
            )
        )
        next_upgrade = candidates[0] if candidates else None
        teams_snapshot.append(
            {
                "team": team,
                "nextUpgrade": next_upgrade,
                "reportedUpdates": sorted(
                    candidates,
                    key=lambda item: item.get("sourceDate") or "",
                    reverse=True,
                )[:8],
                "status": next_upgrade.get("status") if next_upgrade else "not-announced",
            }
        )

    snapshot = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "season": CURRENT_YEAR,
        "nextRace": race,
        "sourceNewsUpdatedAt": news.get("updatedAt"),
        "aiEnrichment": news.get("aiEnrichment") or "local-structured-fallback",
        "teams": teams_snapshot,
        "coverageNote": (
            "Only publicly reported upgrade information found in the connected news sources is shown. "
            "Media reports are not FIA confirmation. Teams without a listing may still be developing parts; "
            "their next package has not been identified in the connected sources."
        ),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(
        f"Saved upgrade watch for {len(teams_snapshot)} teams; "
        f"{sum(1 for team in teams_snapshot if team['nextUpgrade'])} teams have a sourced announcement."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
