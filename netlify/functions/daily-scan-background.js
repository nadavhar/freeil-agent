const Anthropic = require("@anthropic-ai/sdk");

const REPO = "nadavhar/freeil-agent";
const CITIES = [
  { en: "Tel Aviv", he: "תל אביב" },
  { en: "Jerusalem", he: "ירושלים" },
  { en: "Haifa", he: "חיפה" },
  { en: "Beer Sheva", he: "באר שבע" },
  { en: "Eilat", he: "אילת" },
  { en: "Tiberias", he: "טבריה" },
  { en: "Nazareth", he: "נצרת" },
  { en: "Safed", he: "צפת" },
  { en: "Akko", he: "עכו" },
];
const EVENT_TYPES = [
  "concert","festival","market","exhibition","tour","workshop",
  "sport","community","culture","food","nature","nightlife",
  "family","museum","lecture","yoga","art","other",
];

async function ghGet(token, path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!r.ok) throw new Error(`GitHub GET failed: ${r.status}`);
  return r.json();
}

async function ghPut(token, path, content, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
      sha,
      committer: { name: "netlify-bot", email: "bot@freeil.co.il" },
    }),
  });
  return r.ok;
}

function cleanupExpired(events) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const recurring = ["יומי","כל יום","כל שבת","כל שישי","every","daily","weekly","פתוח","קבוע","recurring"];
  return events.filter((ev) => {
    const d = (ev.date_display || "").toLowerCase();
    if (recurring.some((k) => d.includes(k))) return true;
    return !ev.date || ev.date >= cutoffStr;
  });
}

function strSim(a, b) {
  a = a || ""; b = b || "";
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) return 1;
  const dp = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    let prev = i;
    for (let j = 1; j <= shorter.length; j++) {
      const cur = longer[i-1] === shorter[j-1] ? dp[j-1] : 1 + Math.min(dp[j-1], dp[j], prev);
      dp[j-1] = prev; prev = cur;
    }
    dp[shorter.length] = prev;
  }
  return (longer.length - dp[shorter.length]) / longer.length;
}

function isDuplicate(ev, existing, threshold = 0.75) {
  return existing.some((e) => {
    if (e.city !== ev.city) return false;
    const ts = strSim(ev.title, e.title);
    if (ts >= threshold) return true;
    return strSim(ev.location, e.location) >= threshold && ts >= 0.5;
  });
}

function isValid(ev) {
  if (!ev.title || !ev.city || ev.latitude == null || ev.longitude == null) return false;
  if (!(29 <= ev.latitude && ev.latitude <= 34 && 34 <= ev.longitude && ev.longitude <= 36.5)) return false;
  return CITIES.some((c) => c.en === ev.city);
}

async function scanWithClaude(apiKey) {
  const client = new Anthropic({ apiKey });
  const citiesText = CITIES.map((c) => `- ${c.en} (${c.he})`).join("\n");
  const today = new Date().toISOString().split("T")[0];

  const prompt = `You are a free-event discovery assistant for Israel.
Search the web for FREE events and activities across Israeli cities (חינם / כניסה חופשית / free admission).
Cities (search in BOTH Hebrew and English):
${citiesText}

Search for: free museums, lectures, yoga in parks, art events, guided tours, festivals, concerts, family activities, food events, nature activities.
Today: ${today}. Focus on upcoming and ongoing events.

Return a JSON array. Each event must have:
- title (string, Hebrew preferred)
- date (YYYY-MM-DD)
- date_display (string)
- location (string)
- city (one of: ${CITIES.map((c) => c.en).join(", ")})
- latitude (float)
- longitude (float)
- event_type (one of: ${EVENT_TYPES.join(", ")})
- description (Hebrew, 1-2 sentences)
- is_free (true)
- source (URL)

Return ONLY a valid JSON array. No markdown fences.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 20 }],
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const start = text.indexOf("[");
  if (start === -1) return [];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return []; }
    }
  }
  return [];
}

exports.handler = async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const ghToken = process.env.GITHUB_TOKEN;
  if (!apiKey || !ghToken) {
    console.error("[daily-scan] Missing ANTHROPIC_API_KEY or GITHUB_TOKEN");
    return { statusCode: 500 };
  }

  const fileData = await ghGet(ghToken, "events.json");
  const existing = JSON.parse(Buffer.from(fileData.content, "base64").toString());
  console.log(`[daily-scan] Loaded ${existing.length} events`);

  const cleaned = cleanupExpired(existing);
  const newEvents = await scanWithClaude(apiKey);
  console.log(`[daily-scan] Claude found ${newEvents.length} candidates`);

  let added = 0;
  for (const ev of newEvents) {
    ev.is_free = true;
    if (!isValid(ev) || isDuplicate(ev, cleaned)) continue;
    ev.date = ev.date || new Date().toISOString().split("T")[0];
    ev.date_display = ev.date_display || "";
    ev.description = ev.description || "";
    ev.source = ev.source || "web_search";
    ev.event_type = ev.event_type || "other";
    cleaned.push(ev);
    added++;
  }

  console.log(`[daily-scan] Added ${added}. Total: ${cleaned.length}`);
  const content = JSON.stringify(cleaned, null, 2) + "\n";
  const ok = await ghPut(
    ghToken, "events.json", content, fileData.sha,
    `Auto-scan: update free events (total: ${cleaned.length})`
  );
  console.log(`[daily-scan] GitHub push: ${ok ? "success" : "failed"}`);
  return { statusCode: 200 };
};
