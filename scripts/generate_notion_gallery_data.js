const fs = require('fs');
const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json";

async function notionRequest(method, endpoint, body = null) {
  const url = `https://api.notion.com/v1${endpoint}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(url, options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve(d); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log("Querying Notion for gallery data...");
  const res = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
    filter: {
      and: [
        { property: "Category", select: { equals: "Food" } },
        { property: "Photo", url: { is_not_empty: true } }
      ]
    },
    sorts: [{ property: "Date", direction: "descending" }]
  });

  if (!res.results) {
    console.error("Failed to query Notion:", res);
    return;
  }

  const meals = res.results.map(page => {
    const p = page.properties;
    return {
      id: page.id,
      title: p.Entry.title[0]?.plain_text || "Untitled",
      type: p["Meal Type"]?.select?.name || "Food",
      date: p.Date.date.start,
      photo: p.Photo.url,
      carbs: p["Carbs (est)"]?.number,
      cals: p["Calories (est)"]?.number,
      delta: p["BG Delta"]?.number,
      peak: p["2hr Peak BG"]?.number
    };
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(meals, null, 2));
  console.log(`Successfully wrote ${meals.length} meals to gallery data.`);
}

main().catch(console.error);
