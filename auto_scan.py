#!/usr/bin/env python3
"""Auto-scan for free events in Israel using Claude API with web search.

Designed to run daily via GitHub Actions. Uses Anthropic's web_search tool
so Claude can search the web directly (bypasses bot protection).

Usage:
    ANTHROPIC_API_KEY=sk-... python auto_scan.py
"""

import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path

import anthropic

EVENTS_FILE = Path(__file__).parent / "events.json"

# All 9 cities currently in events.json
CITIES = [
    ("Tel Aviv", "תל אביב"),
    ("Jerusalem", "ירושלים"),
    ("Haifa", "חיפה"),
    ("Beer Sheva", "באר שבע"),
    ("Eilat", "אילת"),
    ("Tiberias", "טבריה"),
    ("Nazareth", "נצרת"),
    ("Safed", "צפת"),
    ("Akko", "עכו"),
]

EVENT_TYPES = [
    "concert", "festival", "market", "exhibition", "tour", "workshop",
    "sport", "community", "culture", "food", "nature", "nightlife",
    "family", "museum", "lecture", "yoga", "art", "other",
]

SCAN_PROMPT = """You are a free-event discovery assistant for Israel.

Search the web for FREE events and activities across Israeli cities. Focus on events that
are genuinely free (חינם / כניסה חופשית / free admission / no charge).

Search for each of these cities, using BOTH Hebrew and English queries:
{cities_text}

For each city, search for:
- Free museums and galleries (כניסה חינם למוזיאונים)
- Free lectures, talks, and academic events (הרצאות חינם)
- Free yoga, pilates, and fitness in parks (יוגה חינם בפארק)
- Free art events, street art tours, exhibitions (אירועי אמנות חינם)
- Free guided tours and walking tours (סיורים מודרכים חינם)
- Free festivals and community events (פסטיבלים וארועי קהילה חינם)
- Free concerts and performances (הופעות חינם)
- Free family activities (פעילויות משפחה חינם)
- Free food events and markets (שווקים ואירועי אוכל חינם)
- Free nature and parks activities (פעילויות טבע חינם)

Today's date is {today}. Focus on upcoming and ongoing events.

IMPORTANT RULES:
1. ONLY include events that are GENUINELY FREE. Exclude "free with purchase", paid events,
   or events where "free" status is unclear.
2. Include both one-time events (with specific dates) and recurring/permanent events
   (museums always free, weekly yoga, etc.).
3. For recurring events, use the next upcoming occurrence date.
4. Use your knowledge of Israeli geography for accurate lat/lon coordinates.

Return a JSON array where each event has these exact fields:
- title: event title (Hebrew if available, keep original language)
- date: ISO date string YYYY-MM-DD (next upcoming date for recurring events)
- date_display: human-friendly display (e.g. "כל שבת 10:00-14:00" or "15 בפברואר 2026")
- location: location name with address details
- city: one of {cities_list}
- latitude: float
- longitude: float
- event_type: one of {types_list}
- description: brief description in Hebrew (1-2 sentences)
- is_free: true
- source: website where you found the event

Return ONLY a valid JSON array. No markdown fences, no extra text."""


def load_existing_events():
    """Load existing events from events.json."""
    if not EVENTS_FILE.exists():
        return []
    try:
        data = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except (json.JSONDecodeError, OSError) as e:
        print(f"[auto_scan] Warning: could not load {EVENTS_FILE}: {e}")
    return []


def is_duplicate(new_event, existing_events, threshold=0.75):
    """Check if an event is a duplicate of any existing event.

    Uses fuzzy string matching on title and location.
    """
    new_title = new_event.get("title", "").strip()
    new_location = new_event.get("location", "").strip()
    new_city = new_event.get("city", "")

    for existing in existing_events:
        # Must be same city
        if existing.get("city", "") != new_city:
            continue

        existing_title = existing.get("title", "").strip()
        existing_location = existing.get("location", "").strip()

        # Compare titles
        title_ratio = SequenceMatcher(None, new_title, existing_title).ratio()
        if title_ratio >= threshold:
            return True

        # Compare location + title combo (catches renamed duplicates)
        if new_location and existing_location:
            loc_ratio = SequenceMatcher(None, new_location, existing_location).ratio()
            if loc_ratio >= threshold and title_ratio >= 0.5:
                return True

    return False


def cleanup_expired_events(events):
    """Remove one-time events that are more than 30 days past.

    Keeps recurring/permanent events (date_display contains recurring keywords).
    """
    cutoff = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    recurring_keywords = [
        "יומי", "כל יום", "כל שבת", "כל שישי", "every", "daily", "weekly",
        "פתוח", "קבוע", "שעות פתיחה", "כל ה", "recurring",
    ]

    kept = []
    removed = 0
    for event in events:
        date_display = event.get("date_display", "").lower()
        is_recurring = any(kw in date_display for kw in recurring_keywords)

        if is_recurring:
            kept.append(event)
            continue

        event_date = event.get("date", "")
        if event_date and event_date < cutoff:
            removed += 1
            continue

        kept.append(event)

    if removed:
        print(f"[auto_scan] Cleaned up {removed} expired events")
    return kept


def validate_event(event):
    """Check that an event has all required fields with valid values."""
    required = ["title", "city", "latitude", "longitude"]
    for field in required:
        if not event.get(field):
            return False

    # Validate lat/lon are in Israel's approximate bounding box
    lat = event.get("latitude", 0)
    lon = event.get("longitude", 0)
    if not (29.0 <= lat <= 34.0 and 34.0 <= lon <= 36.5):
        return False

    # Validate city is known
    valid_cities = [c[0] for c in CITIES]
    if event.get("city") not in valid_cities:
        return False

    return True


def scan_with_claude():
    """Use Claude API with web_search tool to find free events."""
    client = anthropic.Anthropic()

    cities_text = "\n".join(f"- {en} ({he})" for en, he in CITIES)
    cities_list = json.dumps([c[0] for c in CITIES])
    types_list = json.dumps(EVENT_TYPES)
    today = datetime.now().strftime("%Y-%m-%d")

    prompt = SCAN_PROMPT.format(
        cities_text=cities_text,
        cities_list=cities_list,
        types_list=types_list,
        today=today,
    )

    print("[auto_scan] Calling Claude API with web_search tool...")
    print(f"[auto_scan] Searching across {len(CITIES)} cities")

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=16000,
            tools=[{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 20,
            }],
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.BadRequestError as e:
        print(f"[auto_scan] API error: {e}")
        return []
    except anthropic.APIError as e:
        print(f"[auto_scan] API error: {e}")
        return []

    # Extract text from response (may contain multiple content blocks)
    text_parts = []
    for block in response.content:
        if hasattr(block, "text"):
            text_parts.append(block.text)

    response_text = "\n".join(text_parts).strip()

    # Try to extract JSON array from the response
    events = _extract_json_array(response_text)

    if events is None:
        print("[auto_scan] Failed to parse events from Claude response")
        print(f"[auto_scan] Response preview: {response_text[:500]}")
        return []

    print(f"[auto_scan] Claude found {len(events)} events")
    return events


def _extract_json_array(text):
    """Extract a JSON array from text that may contain surrounding content."""
    # Strip markdown fences
    if "```" in text:
        lines = text.split("\n")
        in_fence = False
        fenced_lines = []
        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                fenced_lines.append(line)
        if fenced_lines:
            text = "\n".join(fenced_lines)

    # Try direct parse
    text = text.strip()
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass

    # Try to find JSON array in the text
    start = text.find("[")
    if start == -1:
        return None

    # Find matching closing bracket
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def try_scraper_fallback():
    """Try to get supplementary events from scraper.py parks source."""
    try:
        from scraper import _scrape_parks_events
        raw = _scrape_parks_events(max_events=10)
        if raw:
            print(f"[auto_scan] Scraper fallback: got {len(raw)} raw park events")
        return raw
    except Exception as e:
        print(f"[auto_scan] Scraper fallback failed: {e}")
        return []


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[auto_scan] ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    # Load existing events
    existing = load_existing_events()
    print(f"[auto_scan] Loaded {len(existing)} existing events")

    # Clean up expired events
    existing = cleanup_expired_events(existing)

    # Scan for new events with Claude
    new_events = scan_with_claude()

    # Try scraper fallback for supplementary data
    scraper_raw = try_scraper_fallback()
    if scraper_raw:
        # These are raw events, not structured — we just note them
        print(f"[auto_scan] (Scraper found {len(scraper_raw)} raw events for reference)")

    # Validate and deduplicate
    added = 0
    skipped_invalid = 0
    skipped_duplicate = 0

    for event in new_events:
        # Ensure is_free is set
        event["is_free"] = True

        if not validate_event(event):
            skipped_invalid += 1
            continue

        if is_duplicate(event, existing):
            skipped_duplicate += 1
            continue

        # Fill in missing optional fields
        event.setdefault("date", datetime.now().strftime("%Y-%m-%d"))
        event.setdefault("date_display", "")
        event.setdefault("description", "")
        event.setdefault("source", "web_search")
        event.setdefault("event_type", "other")

        existing.append(event)
        added += 1

    print(f"\n[auto_scan] === Results ===")
    print(f"  New events added: {added}")
    print(f"  Skipped (invalid): {skipped_invalid}")
    print(f"  Skipped (duplicate): {skipped_duplicate}")
    print(f"  Total events: {len(existing)}")

    # Save
    EVENTS_FILE.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[auto_scan] Saved to {EVENTS_FILE}")

    # Summary
    city_counts = Counter(ev.get("city", "?") for ev in existing)
    print("\n[auto_scan] === Events by City ===")
    for city, count in city_counts.most_common():
        print(f"  {city}: {count}")

    # Output for GitHub Actions commit message
    if added > 0:
        print(f"\n::set-output name=added::{added}")
        print(f"::set-output name=total::{len(existing)}")

    return added


if __name__ == "__main__":
    added = main()
    sys.exit(0)
