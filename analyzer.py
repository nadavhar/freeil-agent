"""Analyze raw events using Claude API to extract structured free event data."""

import json
import anthropic


SYSTEM_PROMPT = """You are a free-event extraction assistant for Israel.

You receive raw event data scraped from multiple sources (GoOut.co.il, parks.org.il,
Google search results, Facebook Events). Your job is to extract ONLY genuinely free
events and return structured JSON.

IMPORTANT RULES:
1. ONLY include events that are clearly FREE (חינם / כניסה חופשית / free / no charge).
   If the event has a ticket price or is not clearly free, EXCLUDE it.
2. Focus on events in these cities: Tel Aviv (תל אביב), Jerusalem (ירושלים),
   Rishon LeZion (ראשון לציון), Haifa (חיפה), Beer Sheva (באר שבע).
   Include events from other Israeli cities only if clearly free.
3. Deduplicate: if the same event appears from multiple sources, keep only one entry.

For each event, return a JSON object with these fields:
- title: event title (keep original Hebrew if present, add English translation in parentheses)
- date: ISO 8601 date string (YYYY-MM-DD). Infer year as 2026 if not specified. For recurring
  events use the next upcoming date. For date ranges use the start date.
- date_display: human-friendly date string (e.g. "February 15, 2026" or "Every Saturday")
- location: human-readable location name (in English, include neighborhood/area)
- city: one of ["Tel Aviv", "Jerusalem", "Rishon LeZion", "Haifa", "Beer Sheva", "Other"]
- latitude: approximate latitude (float) — use your knowledge of Israeli geography
- longitude: approximate longitude (float)
- event_type: one of ["concert", "festival", "market", "exhibition", "tour", "workshop",
  "sport", "community", "culture", "food", "nature", "nightlife", "family", "museum",
  "lecture", "yoga", "art", "other"]
  Use "museum" for museum visits and gallery exhibitions with free entry.
  Use "lecture" for free lectures, talks, TED events, and academic presentations.
  Use "yoga" for yoga sessions, pilates, meditation, and wellness activities in parks.
  Use "art" for street art, art walks, art festivals, and creative events.
- description: one-sentence English summary of the event
- is_free: true (should always be true — exclude non-free events entirely)
- source: the source website or platform where the event was found

Return ONLY a valid JSON array, no markdown fences or other text."""


def analyze_events(raw_events):
    """Send raw events to Claude for structured extraction of free events."""
    if not raw_events:
        return []

    client = anthropic.Anthropic()  # uses ANTHROPIC_API_KEY env var

    user_content = (
        "Extract structured FREE event data from the following raw events.\n"
        "Remember: only include events that are genuinely free (חינם / כניסה חופשית / free).\n"
        "Focus on Tel Aviv, Jerusalem, Rishon LeZion, Haifa, and Beer Sheva.\n"
        "Pay special attention to: museums with free entry, free lectures/talks, "
        "yoga in parks, art events, and guided tours.\n\n"
    )
    for i, ev in enumerate(raw_events, 1):
        user_content += f"Event {i}:\n"
        for k, v in ev.items():
            if v:
                user_content += f"  {k}: {v}\n"
        user_content += "\n"

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8192,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    response_text = message.content[0].text.strip()

    # Strip markdown fences if present
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        response_text = "\n".join(lines[1:-1])

    try:
        events = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"[analyzer] Failed to parse Claude response: {e}")
        print(f"[analyzer] Raw response:\n{response_text[:500]}")
        return []

    # Post-filter: only keep events marked as free
    free_events = [ev for ev in events if ev.get("is_free", False)]

    print(f"[analyzer] Extracted {len(events)} events, {len(free_events)} confirmed free")
    return free_events
