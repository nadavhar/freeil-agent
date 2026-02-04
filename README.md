# FreeIL - Free Events in Israel

Search agent for finding free events across Israel - museums, lectures, yoga in parks, tours, art exhibitions, and more.

## Features

- **Multi-source scraping**: GoOut.co.il, parks.org.il, Google search
- **Hebrew & English queries**: Searches in both languages for comprehensive coverage
- **Claude-powered analysis**: Extracts and categorizes events using AI
- **Interactive map**: Leaflet-based map with color-coded markers
- **Filterable by city & type**: Easy filtering across categories

## Event Categories

| Category | Hebrew | Color |
|----------|--------|-------|
| Museum | מוזיאונים | Blue |
| Lecture | הרצאות | Teal |
| Yoga | יוגה | Green |
| Art | אמנות | Pink |
| Tour | סיורים | Blue |
| Concert | קונצרטים | Pink |
| Festival | פסטיבלים | Orange |
| Market | שווקים | Brown |
| Food | אוכל | Orange |
| Family | משפחה | Green |

## Cities Covered

- Tel Aviv (תל אביב)
- Jerusalem (ירושלים)
- Rishon LeZion (ראשון לציון)
- Haifa (חיפה)
- Beer Sheva (באר שבע)

## Installation

```bash
pip install -r requirements.txt
```

## Usage

### Demo Mode (no API key needed)

```bash
python3 main.py --demo
```

Then open `index.html` in your browser.

### Live Search

```bash
export ANTHROPIC_API_KEY="your-api-key"
python3 main.py
```

## Project Structure

```
freeil-agent/
├── main.py          # Entry point
├── scraper.py       # Web scraping and search queries
├── analyzer.py      # Claude API integration for event extraction
├── index.html       # Interactive map frontend
├── events.json      # Generated events data
└── requirements.txt # Python dependencies
```

## Search Queries

The agent searches for:
- מוזיאונים חינם (free museums)
- הרצאות חינם (free lectures)
- יוגה חינם בפארק (free yoga in park)
- סיורים מודרכים חינם (free guided tours)
- תערוכות אמנות חינם (free art exhibitions)
- And many more...

## License

MIT
