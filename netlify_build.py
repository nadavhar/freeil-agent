#!/usr/bin/env python3
"""Runs during Netlify build: scans for events and pushes events.json back to GitHub.

Triggered by a daily build hook call. The updated events.json is deployed
as part of this build, and also persisted to GitHub for the next run.
"""
import base64
import json
import os
import sys
from pathlib import Path

import requests

# Import auto_scan from same directory
sys.path.insert(0, str(Path(__file__).parent))
import auto_scan

REPO = "nadavhar/freeil-agent"
EVENTS_FILE = Path(__file__).parent / "events.json"


def fetch_latest_events(token):
    """Fetch latest events.json from GitHub so we start fresh each build."""
    url = f"https://api.github.com/repos/{REPO}/contents/events.json"
    hdrs = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
    r = requests.get(url, headers=hdrs)
    if r.status_code == 200:
        content = base64.b64decode(r.json()["content"])
        EVENTS_FILE.write_bytes(content)
        print(f"[netlify_build] Fetched events.json from GitHub")
        return r.json()["sha"]
    print(f"[netlify_build] Warning: could not fetch events.json ({r.status_code})")
    return None


def push_to_github(token, sha, total):
    """Push updated events.json back to GitHub to persist for next run."""
    url = f"https://api.github.com/repos/{REPO}/contents/events.json"
    hdrs = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"}
    content = base64.b64encode(EVENTS_FILE.read_bytes()).decode()
    payload = {
        "message": f"Auto-scan: update free events (total: {total}) [skip netlify]",
        "content": content,
        "sha": sha,
        "committer": {"name": "netlify-build-bot", "email": "bot@freeil.co.il"},
    }
    r = requests.put(url, headers=hdrs, json=payload)
    if r.status_code in (200, 201):
        print(f"[netlify_build] Pushed updated events.json to GitHub")
    else:
        print(f"[netlify_build] GitHub push failed: {r.status_code}")


if __name__ == "__main__":
    github_token = os.environ.get("GITHUB_TOKEN")
    if not github_token:
        print("[netlify_build] No GITHUB_TOKEN — skipping scan (code-only deploy)")
        sys.exit(0)

    sha = fetch_latest_events(github_token)
    auto_scan.EVENTS_FILE = EVENTS_FILE
    auto_scan.main()

    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))
    if sha:
        push_to_github(github_token, sha, len(events))

    print(f"[netlify_build] Done. {len(events)} total events.")
