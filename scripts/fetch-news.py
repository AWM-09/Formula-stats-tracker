#!/usr/bin/env python3
"""Fetch small, attributed F1/F2/F3 RSS snapshots for the static website."""
from __future__ import annotations

import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "news.json"
FEEDS = {
    "f1": "https://www.crash.net/rss/f1",
    "f2": "https://www.crash.net/rss/f2",
    "f3": "https://www.crash.net/rss/f3",
}
SERIES_LABELS = {"f1": "F1", "f2": "F2", "f3": "F3"}
# Keep the feed focused on sporting news rather than commercial betting stories.
EXCLUDED = re.compile(
    r"\b(?:bet(?:ting|s|builder)?|odds|wager(?:ing)?|bookmaker|casino|gambling)\b",
    re.IGNORECASE,
)
TAG_RE = re.compile(r"<[^>]+>")
SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1].lower()


def child_value(item: ET.Element, names: set[str]) -> str:
    for child in list(item):
        name = local_name(str(child.tag))
        if name in names:
            if name == "link" and child.attrib.get("href"):
                return child.attrib["href"].strip()
            return "".join(child.itertext()).strip()
    return ""


def plain_text(value: str, limit: int = 240) -> str:
    value = SCRIPT_STYLE_RE.sub(" ", value or "")
    value = TAG_RE.sub(" ", value)
    value = html.unescape(value)
    value = " ".join(value.split())
    if len(value) > limit:
        return value[: limit - 1].rstrip() + "…"
    return value


def normalise_date(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return None


def parse_feed(payload: bytes, series: str) -> list[dict]:
    root = ET.fromstring(payload)
    entries = [node for node in root.iter() if local_name(str(node.tag)) in {"item", "entry"}]
    if not entries:
        raise ValueError("RSS response contained no story entries")

    articles = []
    for item in entries:
        title = plain_text(child_value(item, {"title"}), 200)
        link = child_value(item, {"link"}).strip()
        if not link:
            link = child_value(item, {"guid"}).strip()
        parsed_link = urlparse(link)
        if not title or parsed_link.scheme not in {"http", "https"} or not parsed_link.netloc:
            continue

        summary_raw = child_value(item, {"description", "summary"})
        summary = plain_text(summary_raw, 240)
        if EXCLUDED.search(title + " " + summary):
            continue

        published = normalise_date(
            child_value(item, {"pubdate", "published", "updated", "date"})
        )
        articles.append(
            {
                "series": series,
                "seriesLabel": SERIES_LABELS[series],
                "title": title,
                "summary": summary,
                "link": link,
                "published": published,
                "source": "Crash.net",
            }
        )

    if not articles:
        raise ValueError("RSS response contained no usable headlines")
    articles.sort(key=lambda article: article.get("published") or "", reverse=True)
    return articles[:40]


def fetch_feed(url: str, series: str) -> list[dict]:
    request = Request(
        url,
        headers={
            "User-Agent": "FormulaStatsTracker/1.0 (personal motorsport statistics project)",
            "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
    )
    with urlopen(request, timeout=25) as response:
        payload = response.read()
    return parse_feed(payload, series)


def load_previous() -> dict:
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"articles": [], "feedStatus": {}}


def main() -> int:
    previous = load_previous()
    previous_articles = previous.get("articles", [])
    previous_by_series = {
        series: [item for item in previous_articles if item.get("series") == series]
        for series in FEEDS
    }

    refreshed: dict[str, list[dict]] = {}
    feed_status: dict[str, str] = {}
    successful_feeds = 0

    for series, url in FEEDS.items():
        try:
            refreshed[series] = fetch_feed(url, series)
            feed_status[series] = "ok"
            successful_feeds += 1
            print(f"{series.upper()}: imported {len(refreshed[series])} headlines")
        except Exception as error:
            refreshed[series] = previous_by_series[series]
            feed_status[series] = "stale"
            print(f"WARNING: {series.upper()} feed failed; retained {len(refreshed[series])} previous headlines: {error}")

    if successful_feeds == 0:
        print("ERROR: all news feeds failed; existing news.json was left untouched.", file=sys.stderr)
        return 1

    combined = []
    seen_links = set()
    for series in FEEDS:
        for article in refreshed[series]:
            link = article.get("link")
            if not link or link in seen_links:
                continue
            seen_links.add(link)
            combined.append(article)

    combined.sort(key=lambda article: article.get("published") or "", reverse=True)
    snapshot = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Crash.net RSS",
        "feedStatus": feed_status,
        "articles": combined[:100],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"Saved {len(snapshot['articles'])} attributed headlines to {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
