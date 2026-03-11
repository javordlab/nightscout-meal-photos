const https = require('https');
const fs = require('fs');

const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function nsRequest(method, endpoint, body = null) {
  const url = `${NIGHTSCOUT_URL}${endpoint}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'api-secret': NIGHTSCOUT_SECRET,
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
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
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
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

const entriesToFix = [
  { date: "2026-03-10", time: "10:22", category: "Food", entry: "Snack: Small handful of goji berries [📷](https://iili.io/q5dLMCX.jpg)", carbs: 12, cals: 110 },
  { date: "2026-03-10", time: "10:05", category: "Food", entry: "Breakfast: Cheese, prosciutto, bread, kiwi, and milk (~35g carbs, ~380 kcal)", carbs: 35, cals: 380 },
  { date: "2026-03-09", time: "10:24", category: "Food", entry: "Breakfast: Scallion pancake with cheese, fried egg, kiwi, and black coffee [📷](https://iili.io/qAnVvMN.jpg)", carbs: 43, cals: 410 },
  { date: "2026-03-09", time: "13:37", category: "Food", entry: "Lunch: Scallion pancake, prosciutto, and avocado (~42g carbs, ~500 kcal) [📷](https://iili.io/qAWqhN9.jpg)", carbs: 42, cals: 500 },
  { date: "2026-03-09", time: "13:39", category: "Food", entry: "Sliced apple and kiwi (~22g carbs, ~90 kcal) [📷](https://iili.io/qAWYFjf.jpg)", carbs: 22, cals: 90 },
  { date: "2026-03-09", time: "15:58", category: "Food", entry: "Mixed nuts and cheese balls (~12g carbs, ~250 kcal) [📷](https://iili.io/qAS2gVV.jpg)", carbs: 12, cals: 250 },
  { date: "2026-03-09", time: "21:30", category: "Food", entry: "Glass of milk and a spoon of peanut butter (~15g carbs, ~250 kcal)", carbs: 15, cals: 250 }
];

async function main() {
  for (const entryData of entriesToFix) {
    const iso = `${entryData.date}T${entryData.time}:00-07:00`;
    console.log(`Fixing Missing NS for ${entryData.date} ${entryData.time}: ${entryData.entry}`);

    const nsBody = {
      enteredBy: "Javordclaw-Fix",
      eventType: "Meal Bolus",
      carbs: entryData.carbs,
      notes: `${entryData.entry} (~${entryData.carbs}g carbs, ~${entryData.cals} kcal)`,
      created_at: iso
    };
    await nsRequest("POST", "/api/v1/treatments.json", nsBody);
  }

  // Update Notion 18:40 manually for Mismatch
  const query = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
    filter: {
      and: [
        { property: "Date", date: { equals: "2026-03-09" } },
        { property: "Entry", title: { contains: "Pasta with meat sauce" } }
      ]
    }
  });

  if (query.results && query.results[0]) {
    console.log(`Updating Notion page ${query.results[0].id} for carb/cal correction...`);
    await notionRequest("PATCH", `/pages/${query.results[0].id}`, {
      properties: {
        "Carbs (est)": { number: 55 },
        "Calories (est)": { number: 650 },
        "Entry": { title: [{ text: { content: "Dinner: Pasta with meat sauce, cheese, pork belly, broccoli, and a slice of bread (~55g carbs, ~650 kcal) [📷](https://iili.io/qAQ2FNp.jpg) [📷](https://iili.io/qAQf0QV.jpg)" } }] }
      }
    });
  }

  console.log("All fixes deployed.");
}

main().catch(console.error);
