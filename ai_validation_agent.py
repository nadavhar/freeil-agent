#!/usr/bin/env python3
"""AI-powered validation agent for FreeIL scraped events.

Uses Claude + web_search to verify each event is real and publicly confirmed:
  Step 1 — URL check: does the URL lead to THIS specific event?
  Step 2 — Cross-reference: is the event confirmed on an external source?
  Step 3 — Sanity check: real organizer, social proof, makes sense for venue?

Outputs:
  validated_events.json  — verified events with verification_source added
  rejected_events.json   — rejected events with rejection reasons
  validation.log         — detailed run log

Usage:
    ANTHROPIC_API_KEY=sk-... python ai_validation_agent.py
    ANTHROPIC_API_KEY=sk-... python ai_validation_agent.py --input raw_events.json
    ANTHROPIC_API_KEY=sk-... python ai_validation_agent.py --dry-run --batch-size 5
"""

import argparse
import json
import logging
import os
import sys
import time
import zoneinfo
from datetime import datetime
from pathlib import Path

import anthropic

# ── Config ──────────────────────────────────────────────────────────────────

BASE_DIR        = Path(__file__).parent
EVENTS_FILE     = BASE_DIR / "events.json"
VALIDATED_FILE  = BASE_DIR / "validated_events.json"
REJECTED_FILE   = BASE_DIR / "rejected_events.json"
LOG_FILE        = BASE_DIR / "ai_validation.log"

IL_TZ           = zoneinfo.ZoneInfo("Asia/Jerusalem")
MODEL           = "claude-sonnet-4-20250514"
BATCH_SIZE      = 3       # events per Claude call (keep low to stay within token budget)
MAX_SEARCH_USES = 10      # web_search calls per batch
SLEEP_BETWEEN_BATCHES = 65 # seconds — avoid 30k tokens/min rate limit

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger("ai_validation")

# ── Prompt ───────────────────────────────────────────────────────────────────

VALIDATION_PROMPT = """You are a strict validation agent for FreeIL, an Israeli free-events aggregator.
Today's date is {today}.

Your ONLY job: verify that each event below is REAL and publicly confirmed.
Use the web_search tool actively for each event.

EVENTS TO VALIDATE:
{events_json}

For EACH event, follow these three steps:

STEP 1 — VERIFY THE URL
Fetch or search the event URL. Does it lead to THIS specific event (not a general homepage, category page, or 404)?
If yes → continue. If no → REJECT with reason "broken_link".

STEP 2 — CROSS-REFERENCE
Search the web for: event name + venue + date (in Hebrew AND English).
The event must appear on at least ONE external source:
  - Facebook event page
  - Venue's official website
  - Eventbrite / Tickchak
  - News article / local listing site
Name, date, location, and free admission must match.
If no external confirmation found → REJECT with reason "no_external_confirmation".

STEP 3 — SANITY CHECK
Ask:
  - Is there a real, identifiable organizer?
  - Is there social proof (Facebook attendance, ticket sales numbers, press coverage)?
  - Does the concept make sense for this venue?
  - Does anything feel generic, AI-hallucinated, or impossible to verify?
If any red flag → REJECT with reason "sanity_check_failed".

RULES:
- A convincing description is NOT proof
- A logical-sounding event is NOT proof
- Only hard external evidence counts
- When in doubt → REJECT
- 5 real events is better than 20 unverified ones

OUTPUT FORMAT — return ONLY a valid JSON object with exactly these two keys:

{{
  "verified": [
    {{
      ...all original event fields...,
      "verified": true,
      "verification_source": "https://exact-url-that-confirmed-the-event"
    }}
  ],
  "rejected": [
    {{
      "event_name": "...",
      "event_date": "...",
      "event_url": "...",
      "rejection_reason": "broken_link | no_external_confirmation | organizer_not_identifiable | details_mismatch | sanity_check_failed",
      "rejection_detail": "exact explanation of what was wrong"
    }}
  ]
}}

Return ONLY the JSON object. No markdown fences, no extra text."""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _extract_json_object(text: str):
    """Extract a JSON object from text that may have surrounding content."""
    if "```" in text:
        lines = text.split("\n")
        in_fence, fenced = False, []
        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                fenced.append(line)
        if fenced:
            text = "\n".join(fenced)

    text = text.strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def validate_batch(client: anthropic.Anthropic, events: list, today: str) -> tuple[list, list]:
    """Send one batch to Claude for validation. Returns (verified, rejected)."""
    events_json = json.dumps(events, ensure_ascii=False, indent=2)
    prompt = VALIDATION_PROMPT.format(today=today, events_json=events_json)

    log.info("Calling Claude for batch of %d events...", len(events))
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=8000,
            tools=[{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": MAX_SEARCH_USES,
            }],
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as e:
        log.error("Claude API error: %s", e)
        return [], []

    text_parts = [block.text for block in response.content if hasattr(block, "text")]
    response_text = "\n".join(text_parts).strip()

    result = _extract_json_object(response_text)
    if not result:
        log.error("Failed to parse Claude response. Preview: %s", response_text[:500])
        return [], []

    verified = result.get("verified", [])
    rejected = result.get("rejected", [])
    log.info("Batch result: %d verified, %d rejected", len(verified), len(rejected))
    return verified, rejected


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI validation agent for FreeIL events.")
    parser.add_argument("--input",      default=str(EVENTS_FILE),    help="Input JSON file")
    parser.add_argument("--validated",  default=str(VALIDATED_FILE), help="Output: verified events")
    parser.add_argument("--rejected",   default=str(REJECTED_FILE),  help="Output: rejected events log")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Events per Claude call")
    parser.add_argument("--dry-run",    action="store_true",          help="Print results, don't write files")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log.error("ANTHROPIC_API_KEY not set.")
        sys.exit(1)

    input_file = Path(args.input)
    if not input_file.exists():
        log.error("Input file not found: %s", input_file)
        sys.exit(1)

    events = json.loads(input_file.read_text(encoding="utf-8"))
    if not isinstance(events, list) or not events:
        log.error("Input must be a non-empty JSON array.")
        sys.exit(1)

    log.info("Loaded %d events from %s", len(events), input_file)
    today = datetime.now(IL_TZ).strftime("%Y-%m-%d")

    client      = anthropic.Anthropic(api_key=api_key)
    all_verified: list = []
    all_rejected: list = []

    # Process in batches
    batches = [events[i:i + args.batch_size] for i in range(0, len(events), args.batch_size)]
    log.info("Processing %d batches of up to %d events each", len(batches), args.batch_size)

    for idx, batch in enumerate(batches, 1):
        log.info("── Batch %d / %d ──", idx, len(batches))
        verified, rejected = validate_batch(client, batch, today)
        all_verified.extend(verified)
        all_rejected.extend(rejected)

        if idx < len(batches):
            log.info("Sleeping %ds before next batch...", SLEEP_BETWEEN_BATCHES)
            time.sleep(SLEEP_BETWEEN_BATCHES)

    # Summary
    total = len(events)
    n_verified = len(all_verified)
    n_rejected = len(all_rejected)
    n_unprocessed = total - n_verified - n_rejected
    log.info("═══ FINAL RESULTS ═══")
    log.info("Total input:    %d", total)
    log.info("Verified:       %d (%.0f%%)", n_verified, 100 * n_verified / total if total else 0)
    log.info("Rejected:       %d (%.0f%%)", n_rejected, 100 * n_rejected / total if total else 0)
    if n_unprocessed:
        log.warning("Unaccounted:    %d (likely API error — check log)", n_unprocessed)

    if all_rejected:
        log.info("\nREJECTION SUMMARY:")
        for r in all_rejected:
            log.info("  ✗ %s | %s | %s", r.get("event_name", "?"), r.get("rejection_reason", "?"), r.get("rejection_detail", "")[:80])

    if args.dry_run:
        log.info("Dry run — not writing output files.")
        print("\n── VERIFIED ──")
        print(json.dumps(all_verified, ensure_ascii=False, indent=2))
        print("\n── REJECTED ──")
        print(json.dumps(all_rejected, ensure_ascii=False, indent=2))
        return

    Path(args.validated).write_text(
        json.dumps(all_verified, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    Path(args.rejected).write_text(
        json.dumps(all_rejected, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info("Wrote %d verified events to %s", n_verified, args.validated)
    log.info("Wrote %d rejected events to %s",  n_rejected, args.rejected)


if __name__ == "__main__":
    main()
