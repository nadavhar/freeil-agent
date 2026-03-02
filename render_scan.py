#!/usr/bin/env python3
"""Wrapper for auto_scan.py that pushes events.json to GitHub after scanning.

Designed to run as a Render cron job.
Requires: ANTHROPIC_API_KEY, GITHUB_TOKEN env vars.
"""

import base64
import json
import os
import sys
from pathlib import Path

import requests

import auto_scan

REPO = "nadavhar/freeil-agent"
EVENTS_FILE = Path(__file__).parent / "events.json"


def push_to_github(token, total):
    """Push updated events.json to GitHub via Contents API."""
    url = f"https://api.github.com/repos/{REPO}/contents/events.json"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }

    # Get current file SHA
    r = requests.get(url, headers=headers)
    if r.status_code != 200:
        print(f"[render_scan] Failed to get current file SHA: {r.text}")
        sys.exit(1)
    sha = r.json()["sha"]

    # Encode new content
    content = EVENTS_FILE.read_bytes()
    encoded = base64.b64encode(content).decode()

    # Push update
    payload = {
        "message": f"Auto-scan: update free events (total: {total})",
        "content": encoded,
        "sha": sha,
        "committer": {
            "name": "render-bot",
            "email": "render-bot@freeil.co.il",
        },
    }
    r = requests.put(url, headers=headers, json=payload)
    if r.status_code in (200, 201):
        print(f"[render_scan] Pushed events.json to GitHub ({total} events)")
    else:
        print(f"[render_scan] GitHub push failed: {r.status_code} {r.text}")
        sys.exit(1)


if __name__ == "__main__":
    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_token:
        print("[render_scan] ERROR: GITHUB_TOKEN not set")
        sys.exit(1)

    # Run the scan
    added = auto_scan.main()

    # Load result to get total count
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
    total = len(events)

    # Push to GitHub (triggers Netlify redeploy automatically)
    push_to_github(github_token, total)
