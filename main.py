#!/usr/bin/env python3
"""FreeIL — Find free events in Israel (Tel Aviv, Rishon LeZion, Jerusalem)."""

import json
import os
import sys
from collections import Counter
from pathlib import Path

from scraper import search_free_events, get_sample_events
from analyzer import analyze_events

OUTPUT_FILE = Path(__file__).parent / "events.json"


def main():
    demo_mode = "--demo" in sys.argv

    # Step 1: Collect raw events
    if demo_mode:
        print("[main] Running in demo mode with sample events")
        raw_events = get_sample_events()
    else:
        print("[main] Searching for free events across multiple sources ...")
        raw_events = search_free_events()
        if not raw_events:
            print("[main] Search returned no events, falling back to sample data")
            raw_events = get_sample_events()

    print(f"[main] Collected {len(raw_events)} raw events")

    # Step 2: Analyze with Claude API
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[main] WARNING: ANTHROPIC_API_KEY not set. Skipping Claude analysis.")
        print("[main] Set the env var and re-run, or use --demo with pre-generated events.json.")
        OUTPUT_FILE.write_text(json.dumps(raw_events, ensure_ascii=False, indent=2))
        print(f"[main] Wrote raw events to {OUTPUT_FILE}")
        return

    print("[main] Sending to Claude API for analysis (filtering for free events) ...")
    structured_events = analyze_events(raw_events)

    if not structured_events:
        print("[main] Analysis returned no free events")
        return

    # Step 3: Save to JSON
    OUTPUT_FILE.write_text(json.dumps(structured_events, ensure_ascii=False, indent=2))
    print(f"\n[main] Saved {len(structured_events)} free events to {OUTPUT_FILE}")

    # Print summary by city
    city_counts = Counter(ev.get("city", "Other") for ev in structured_events)
    print("\n[main] === Free Events Summary ===")
    for city, count in city_counts.most_common():
        print(f"  {city}: {count} events")

    # Print summary by type
    type_counts = Counter(ev.get("event_type", "other") for ev in structured_events)
    print("\n[main] === By Event Type ===")
    for etype, count in type_counts.most_common():
        print(f"  {etype}: {count}")

    print(f"\n[main] Open index.html in a browser to view the map.")


if __name__ == "__main__":
    main()
