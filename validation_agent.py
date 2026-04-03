#!/usr/bin/env python3
"""Validation agent for freeil scraped events.

Checks each event for:
  - broken_link  : URL unreachable or leads to wrong page
  - expired      : event date has already passed
  - mismatch     : date/details on source don't match scraped data
  - valid        : link works and event is upcoming

Usage (standalone):
    python validation_agent.py                  # validates events.json in-place
    python validation_agent.py --dry-run        # print results, don't write
    python validation_agent.py --input raw_events.json --output validated.json

Events with status 'expired' or 'broken_link' are excluded from the output.
"""

import argparse
import asyncio
import json
import logging
import re
import sys
import zoneinfo
from datetime import datetime, date
from pathlib import Path
from urllib.parse import urlparse

import httpx

# ── Config ──────────────────────────────────────────────────────────────────

EVENTS_FILE   = Path(__file__).parent / "events.json"
LOG_FILE      = Path(__file__).parent / "validation.log"
IL_TZ         = zoneinfo.ZoneInfo("Asia/Jerusalem")

REQUEST_TIMEOUT     = 10          # seconds per request
RATE_LIMIT_DELAY    = 1.5         # seconds between requests to the same domain
MAX_CONCURRENCY     = 3           # max parallel requests at once
RETRY_AFTER_DEFAULT = 5           # seconds to wait on 429 if no Retry-After header

RECURRING_KEYWORDS = [
    "כל ", "שבועי", "חודשי", "קבוע", "תמידי", "מתמשך",
    "every", "weekly", "monthly", "permanent", "ongoing",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "he,en;q=0.9",
}

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger("validation_agent")


# ── Helpers ──────────────────────────────────────────────────────────────────

def is_recurring(event: dict) -> bool:
    display = event.get("date_display", "")
    return any(kw in display for kw in RECURRING_KEYWORDS)


def event_date(event: dict) -> date | None:
    raw = event.get("date", "")
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def is_expired(event: dict) -> bool:
    """Return True if a one-time event's date is in the past."""
    if is_recurring(event):
        return False
    d = event_date(event)
    if d is None:
        return False
    today = datetime.now(IL_TZ).date()
    return d < today


def title_on_page(title: str, html: str) -> bool:
    """Rough check: key words from the event title appear in the page HTML."""
    if not title:
        return True  # can't validate without a title
    # Use first 3 meaningful words (skip short words)
    words = [w for w in re.split(r"[\s,\-–|/]+", title) if len(w) > 2][:3]
    return any(w.lower() in html.lower() for w in words)


# ── Per-domain rate limiter ──────────────────────────────────────────────────

class DomainRateLimiter:
    def __init__(self):
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def wait(self, url: str):
        domain = urlparse(url).netloc
        async with self._lock:
            last = self._last.get(domain, 0)
            now = asyncio.get_event_loop().time()
            wait = RATE_LIMIT_DELAY - (now - last)
            if wait > 0:
                self._last[domain] = now + wait
            else:
                self._last[domain] = now
        if wait > 0:
            await asyncio.sleep(wait)


# ── Core validator ───────────────────────────────────────────────────────────

async def validate_event(
    event: dict,
    client: httpx.AsyncClient,
    limiter: DomainRateLimiter,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Return the event dict with a 'validation_status' field added."""
    title  = event.get("title", "")
    url    = event.get("source", "").strip()
    result = dict(event)

    # 1. Expired check (no network needed)
    if is_expired(event):
        log.info("EXPIRED  | %s | %s", event.get("date", ""), title)
        result["validation_status"] = "expired"
        return result

    # 2. No URL → can't validate link
    if not url or not url.startswith("http"):
        log.warning("NO_URL   | %s", title)
        result["validation_status"] = "valid"   # assume valid, can't check
        return result

    # 3. Link + content check
    async with semaphore:
        await limiter.wait(url)
        try:
            resp = await client.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True)
        except httpx.TimeoutException:
            log.warning("TIMEOUT  | %s | %s", url, title)
            result["validation_status"] = "broken_link"
            return result
        except Exception as e:
            log.warning("ERROR    | %s | %s | %s", url, title, e)
            result["validation_status"] = "broken_link"
            return result

    # Handle rate limit
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", RETRY_AFTER_DEFAULT))
        log.warning("RATE_LIMIT | sleeping %ds | %s", retry_after, url)
        await asyncio.sleep(retry_after)
        result["validation_status"] = "broken_link"   # conservative — don't retry inline
        return result

    if resp.status_code >= 400:
        log.info("BROKEN   | HTTP %d | %s | %s", resp.status_code, url, title)
        result["validation_status"] = "broken_link"
        return result

    # 4. Content check — does the page mention the event?
    html = resp.text
    if not title_on_page(title, html):
        log.info("MISMATCH | title not found on page | %s | %s", url, title)
        result["validation_status"] = "mismatch"
        return result

    log.info("VALID    | %s | %s", url, title)
    result["validation_status"] = "valid"
    return result


# ── Main ─────────────────────────────────────────────────────────────────────

async def run(input_file: Path, output_file: Path, dry_run: bool):
    events = json.loads(input_file.read_text(encoding="utf-8"))
    if not isinstance(events, list):
        log.error("Input file must contain a JSON array.")
        sys.exit(1)

    log.info("Validating %d events…", len(events))

    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    limiter   = DomainRateLimiter()

    async with httpx.AsyncClient(headers=HEADERS) as client:
        tasks = [
            validate_event(ev, client, limiter, semaphore)
            for ev in events
        ]
        results = await asyncio.gather(*tasks)

    # Stats
    counts = {}
    for r in results:
        s = r.get("validation_status", "unknown")
        counts[s] = counts.get(s, 0) + 1

    log.info("Results: %s", counts)

    # Filter out broken/expired
    kept = [r for r in results if r.get("validation_status") not in ("expired", "broken_link")]
    removed = len(results) - len(kept)
    log.info("Keeping %d / %d events (%d removed).", len(kept), len(results), removed)

    if dry_run:
        log.info("Dry run — not writing output.")
        for r in results:
            status = r.get("validation_status", "?")
            print(f"[{status:12}] {r.get('title', '')}")
        return

    # Strip validation_status before saving (optional — keep it for debugging)
    output_file.write_text(
        json.dumps(kept, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Wrote %d events to %s", len(kept), output_file)


def main():
    parser = argparse.ArgumentParser(description="Validate scraped freeil events.")
    parser.add_argument("--input",   default=str(EVENTS_FILE), help="Input JSON file")
    parser.add_argument("--output",  default=None,             help="Output JSON file (default: overwrite input)")
    parser.add_argument("--dry-run", action="store_true",      help="Print results without writing")
    args = parser.parse_args()

    input_file  = Path(args.input)
    output_file = Path(args.output) if args.output else input_file

    if not input_file.exists():
        print(f"Error: {input_file} not found.")
        sys.exit(1)

    asyncio.run(run(input_file, output_file, args.dry_run))


if __name__ == "__main__":
    main()
