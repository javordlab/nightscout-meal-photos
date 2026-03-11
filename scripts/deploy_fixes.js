const https = require('https');

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

async function main() {
  console.log("Fixing [MISSING NOTION] 2026-03-10 14:30 Medication :: 500mg Metformin HCL");
  const m1 = {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      "Entry": { title: [{ text: { content: "500mg Metformin HCL" } }] },
      "Date": { date: { start: "2026-03-10T14:30:00-07:00" } },
      "Category": { select: { name: "Medication" } },
      "User": { select: { name: "Maria Dennis" } }
    }
  };
  await notionRequest("POST", "/pages", m1);

  console.log("Fixing Nightscout and Notion Mismatches for March 9 Dinner/Dessert...");
  
  // NS 18:40 Food
  await nsRequest("POST", "/api/v1/treatments.json", {
    enteredBy: "Javordclaw-Fix",
    eventType: "Meal Bolus",
    carbs: 55,
    notes: "Pasta with meat sauce, cheese, pork belly, broccoli, and a slice of bread (~55g carbs, ~650 kcal) [📷](https://iili.io/qAQ2FNp.jpg) [📷](https://iili.io/qAQf0QV.jpg)",
    created_at: "2026-03-09T18:40:00-07:00"
  });

  // NS 18:56 Food
  await nsRequest("POST", "/api/v1/treatments.json", {
    enteredBy: "Javordclaw-Fix",
    eventType: "Meal Bolus",
    carbs: 10,
    notes: "Chocolate cake with whipped cream (~10g carbs, ~120 kcal) [📷](https://iili.io/qAZ5pMF.jpg)",
    created_at: "2026-03-09T18:56:00-07:00"
  });

  // Find and update Notion page for 18:40 to match local (55/650)
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

  console.log("Fixes deployed.");
}

main().catch(console.error);
