"""Search for free events in Israel from multiple sources."""

import requests
from bs4 import BeautifulSoup
from urllib.parse import quote_plus

# Target cities with Hebrew names
CITIES = {
    "Tel Aviv": "תל אביב",
    "Rishon LeZion": "ראשון לציון",
    "Jerusalem": "ירושלים",
}

# Keywords indicating free events
FREE_KEYWORDS_HE = ["חינם", "כניסה חופשית", "ללא תשלום", "בחינם", "כניסה חינם"]
FREE_KEYWORDS_EN = ["free", "no charge", "free admission", "free entry", "no cost"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _build_search_queries():
    """Build a list of search queries in Hebrew and English for free events."""
    queries = []

    # General Hebrew queries
    queries.append("אירועים חינם ישראל")
    queries.append("פעילויות ללא תשלום ישראל")
    queries.append("אירועים בכניסה חופשית")

    for city_en, city_he in CITIES.items():
        # Hebrew queries per city
        queries.append(f"אירועים חינם {city_he}")
        queries.append(f"פעילויות בחינם {city_he}")
        queries.append(f"כניסה חופשית {city_he}")

        # English queries per city
        queries.append(f"free events {city_en} Israel this week")
        queries.append(f"free things to do {city_en} Israel")

    return queries


def _scrape_goout(max_events=15):
    """Scrape free events from GoOut.co.il."""
    events = []
    urls = [
        "https://goout.co.il/",
        "https://goout.co.il/tel-aviv/",
        "https://goout.co.il/jerusalem/",
    ]

    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"[scraper] GoOut fetch failed for {url}: {e}")
            continue

        soup = BeautifulSoup(resp.text, "html.parser")

        # Look for event cards/listings
        selectors = [
            "div.event-card", "article.event", "div.event-item",
            "a.event-link", "div.card", "li.event",
            "div[class*='event']", "article[class*='event']",
        ]

        items = []
        for sel in selectors:
            items = soup.select(sel)
            if items:
                break

        if not items:
            # Fallback: look for any links with event-like paths
            for link in soup.find_all("a", href=True):
                href = link["href"]
                text = link.get_text(strip=True)
                if text and len(text) > 5 and any(
                    kw in href.lower() or kw in text.lower()
                    for kw in ["event", "אירוע", "free", "חינם"]
                ):
                    events.append({
                        "title": text[:200],
                        "url": href if href.startswith("http") else f"https://goout.co.il{href}",
                        "source": "GoOut.co.il",
                        "description": "",
                        "date_raw": "",
                        "location_raw": "",
                    })

        for item in items[:max_events]:
            title_el = item.select_one("h2, h3, h4, .title, .event-title, [class*='title']")
            date_el = item.select_one(".date, .event-date, time, [class*='date']")
            location_el = item.select_one(".location, .venue, .place, [class*='location'], [class*='venue']")
            link_el = item.select_one("a[href]") or (item if item.name == "a" else None)
            desc_el = item.select_one("p, .description, .summary, [class*='desc']")
            price_el = item.select_one(".price, [class*='price'], [class*='cost']")

            title = title_el.get_text(strip=True) if title_el else item.get_text(strip=True)[:200]
            full_text = item.get_text(strip=True).lower()

            # Check if event appears to be free
            is_likely_free = any(kw in full_text for kw in FREE_KEYWORDS_HE + FREE_KEYWORDS_EN)
            if price_el:
                price_text = price_el.get_text(strip=True).lower()
                is_likely_free = is_likely_free or any(kw in price_text for kw in FREE_KEYWORDS_HE + FREE_KEYWORDS_EN)

            href = ""
            if link_el and link_el.get("href"):
                href = link_el["href"]
                if not href.startswith("http"):
                    href = f"https://goout.co.il{href}"

            events.append({
                "title": title,
                "date_raw": date_el.get_text(strip=True) if date_el else "",
                "location_raw": location_el.get_text(strip=True) if location_el else "",
                "url": href,
                "description": desc_el.get_text(strip=True) if desc_el else "",
                "source": "GoOut.co.il",
                "is_likely_free": is_likely_free,
            })

    print(f"[scraper] GoOut: found {len(events)} events")
    return events[:max_events]


def _scrape_parks_events(max_events=15):
    """Scrape events from Israel Nature and Parks Authority."""
    url = "https://www.parks.org.il/events/"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[scraper] parks.org.il fetch failed: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    events = []

    selectors = [
        "div.event-item", "article.event", "div.event-card",
        "li.event", "div.views-row", "div.card",
    ]

    items = []
    for sel in selectors:
        items = soup.select(sel)
        if items:
            break

    if not items:
        for link in soup.find_all("a", href=True):
            href = link["href"]
            if "/event/" in href or "/events/" in href:
                title = link.get_text(strip=True)
                if title and len(title) > 5:
                    events.append({
                        "title": title,
                        "url": href if href.startswith("http") else f"https://www.parks.org.il{href}",
                        "source": "parks.org.il",
                        "date_raw": "",
                        "location_raw": "",
                        "description": "",
                    })
                    if len(events) >= max_events:
                        break

    for item in items[:max_events]:
        title_el = item.select_one("h2, h3, h4, .title, .event-title")
        date_el = item.select_one(".date, .event-date, time")
        location_el = item.select_one(".location, .event-location, .place")
        link_el = item.select_one("a[href]")
        desc_el = item.select_one("p, .description, .summary")

        href = ""
        if link_el and link_el.get("href"):
            href = link_el["href"]
            if not href.startswith("http"):
                href = f"https://www.parks.org.il{href}"

        events.append({
            "title": title_el.get_text(strip=True) if title_el else item.get_text(strip=True)[:200],
            "date_raw": date_el.get_text(strip=True) if date_el else "",
            "location_raw": location_el.get_text(strip=True) if location_el else "",
            "url": href,
            "description": desc_el.get_text(strip=True) if desc_el else "",
            "source": "parks.org.il",
        })

    print(f"[scraper] parks.org.il: found {len(events)} events")
    return events[:max_events]


def _search_via_google(query, max_results=10):
    """Search Google for free event listings and extract results."""
    search_url = f"https://www.google.com/search?q={quote_plus(query)}&hl=he&gl=il&num={max_results}"

    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[scraper] Google search failed for '{query}': {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []

    # Extract search result entries
    for g in soup.select("div.g, div[data-sokoban-container]"):
        link_el = g.select_one("a[href]")
        title_el = g.select_one("h3")
        snippet_el = g.select_one("div[data-sncf], span.st, div.VwiC3b, div[style*='line-clamp']")

        if not link_el or not title_el:
            continue

        href = link_el.get("href", "")
        if not href.startswith("http"):
            continue

        results.append({
            "title": title_el.get_text(strip=True),
            "url": href,
            "description": snippet_el.get_text(strip=True) if snippet_el else "",
            "date_raw": "",
            "location_raw": "",
            "source": f"Google: {query[:40]}",
        })

    print(f"[scraper] Google '{query[:30]}...': found {len(results)} results")
    return results[:max_results]


def search_free_events(max_events_per_source=15):
    """Search all sources for free events in Israel.

    Returns a combined list of raw event dicts from multiple sources.
    """
    all_events = []

    # 1. Direct site scraping
    print("[scraper] --- Scraping direct sources ---")
    all_events.extend(_scrape_goout(max_events=max_events_per_source))
    all_events.extend(_scrape_parks_events(max_events=max_events_per_source))

    # 2. Google search with Hebrew and English queries
    print("[scraper] --- Searching Google ---")
    queries = _build_search_queries()
    seen_urls = {ev.get("url", "") for ev in all_events if ev.get("url")}

    for query in queries:
        results = _search_via_google(query, max_results=8)
        for r in results:
            if r["url"] not in seen_urls:
                seen_urls.add(r["url"])
                all_events.append(r)

    print(f"[scraper] Total raw events collected: {len(all_events)}")
    return all_events


def get_sample_events():
    """Return sample free events for demo/testing."""
    return [
        {
            "title": "סיור אמנות רחוב חינם בפלורנטין",
            "date_raw": "15/02/2026",
            "location_raw": "פלורנטין, תל אביב",
            "description": "סיור מודרך חינם באמנות רחוב וגרפיטי בשכונת פלורנטין. כניסה חופשית, ללא הרשמה.",
            "url": "https://example.com/florentin-art-tour",
            "source": "GoOut.co.il",
        },
        {
            "title": "שוק אוכל חינם - נמל תל אביב",
            "date_raw": "20/02/2026",
            "location_raw": "נמל תל אביב",
            "description": "טעימות חינם משפים מובילים בנמל תל אביב. כניסה חופשית לכל המשפחה.",
            "url": "https://example.com/tlv-food-market",
            "source": "Facebook Events",
        },
        {
            "title": "Free Friday Concert at the First Station",
            "date_raw": "21/02/2026",
            "location_raw": "התחנה הראשונה, ירושלים",
            "description": "Free live music concert every Friday at the First Station complex. No charge, open to all.",
            "url": "https://example.com/first-station-concert",
            "source": "GoOut.co.il",
        },
        {
            "title": "פסטיבל תרבות חינם - כיכר רבין",
            "date_raw": "28/02/2026",
            "location_raw": "כיכר רבין, תל אביב",
            "description": "פסטיבל תרבות בכניסה חופשית עם הופעות מוזיקה, תיאטרון רחוב ואומנות.",
            "url": "https://example.com/rabin-sq-festival",
            "source": "Google",
        },
        {
            "title": "סיור לילי חינם בעיר העתיקה",
            "date_raw": "07/03/2026",
            "location_raw": "העיר העתיקה, ירושלים",
            "description": "סיור לילי מודרך חינם ברובע היהודי בעיר העתיקה. כניסה חופשית.",
            "url": "https://example.com/old-city-night-tour",
            "source": "Google",
        },
        {
            "title": "שוק פשפשים וגינת קהילה - ראשון לציון",
            "date_raw": "14/03/2026",
            "location_raw": "פארק הנחל, ראשון לציון",
            "description": "שוק פשפשים קהילתי וסדנאות גינון חינם בפארק הנחל. ללא תשלום.",
            "url": "https://example.com/rishon-flea-market",
            "source": "Facebook Events",
        },
        {
            "title": "Free Yoga in the Park - Tel Aviv",
            "date_raw": "Every Saturday 08:00",
            "location_raw": "Park HaYarkon, Tel Aviv",
            "description": "Free weekly yoga session in Park HaYarkon. No registration needed, just show up.",
            "url": "https://example.com/tlv-yoga",
            "source": "Facebook Events",
        },
        {
            "title": "תערוכת אמנות בכניסה חופשית - מוזיאון ראשון לציון",
            "date_raw": "01/03/2026 - 30/04/2026",
            "location_raw": "מוזיאון ראשון לציון, ראשון לציון",
            "description": "תערוכת אמנות ישראלית עכשווית. כניסה חופשית בימים א-ה.",
            "url": "https://example.com/rishon-museum",
            "source": "GoOut.co.il",
        },
        {
            "title": "הקרנת סרטים בחינם - סינמטק תל אביב",
            "date_raw": "10/03/2026",
            "location_raw": "סינמטק תל אביב",
            "description": "הקרנת סרטים ישראליים קלאסיים בחינם במסגרת שבוע הקולנוע הישראלי.",
            "url": "https://example.com/cinematheque-free",
            "source": "GoOut.co.il",
        },
        {
            "title": "סיור היסטורי חינם במושבה הגרמנית",
            "date_raw": "22/03/2026",
            "location_raw": "המושבה הגרמנית, ירושלים",
            "description": "סיור היסטורי מודרך חינם במושבה הגרמנית. הסיור בעברית, כניסה חופשית.",
            "url": "https://example.com/german-colony-tour",
            "source": "Google",
        },
        {
            "title": "Free Open Mic Night - Jaffa Port",
            "date_raw": "18/03/2026",
            "location_raw": "Jaffa Port, Tel Aviv-Jaffa",
            "description": "Free open mic night at Jaffa Port warehouse. Music, comedy, poetry. No charge.",
            "url": "https://example.com/jaffa-open-mic",
            "source": "Facebook Events",
        },
        {
            "title": "פעילות משפחות חינם - פארק אשדוד ים, ראשון לציון",
            "date_raw": "28/03/2026",
            "location_raw": "פארק הנחל, ראשון לציון",
            "description": "פעילות לכל המשפחה בחינם: הפעלות לילדים, סדנאות יצירה, והופעות רחוב.",
            "url": "https://example.com/rishon-family-day",
            "source": "Facebook Events",
        },
    ]
