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


def sync_gh_pages(token):
    """Mirror main branch tree to gh-pages using the Git Trees API."""
    hdrs = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
    base = f"https://api.github.com/repos/{REPO}"

    # Get latest commit on main
    r = requests.get(f"{base}/git/ref/heads/main", headers=hdrs)
    if r.status_code != 200:
        print(f"[netlify_build] sync_gh_pages: could not get main ref ({r.status_code})")
        return
    main_sha = r.json()["object"]["sha"]

    # Get that commit's tree SHA
    r = requests.get(f"{base}/git/commits/{main_sha}", headers=hdrs)
    tree_sha = r.json()["tree"]["sha"]

    # Get current gh-pages HEAD (for parent)
    r = requests.get(f"{base}/git/ref/heads/gh-pages", headers=hdrs)
    gh_pages_sha = r.json()["object"]["sha"]

    # Create a new commit on gh-pages pointing to main's tree
    r = requests.post(f"{base}/git/commits", headers=hdrs, json={
        "message": "Sync gh-pages with main [skip netlify]",
        "tree": tree_sha,
        "parents": [gh_pages_sha],
        "author": {"name": "netlify-build-bot", "email": "bot@freeil.co.il"},
    })
    if r.status_code != 201:
        print(f"[netlify_build] sync_gh_pages: commit failed ({r.status_code})")
        return
    new_sha = r.json()["sha"]

    # Update gh-pages ref
    r = requests.patch(f"{base}/git/refs/heads/gh-pages", headers=hdrs,
                       json={"sha": new_sha})
    if r.status_code == 200:
        print(f"[netlify_build] Synced gh-pages with main")
    else:
        print(f"[netlify_build] sync_gh_pages: ref update failed ({r.status_code})")


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

    sync_gh_pages(github_token)
    print(f"[netlify_build] Done. {len(events)} total events.")
