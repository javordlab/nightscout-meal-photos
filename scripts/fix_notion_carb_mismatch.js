const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

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
  console.log("Searching for the specific Notion page with 70g carbs...");
  const query = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
    filter: {
      and: [
        { property: "Date", date: { equals: "2026-03-09" } },
        { property: "Carbs (est)", number: { equals: 70 } }
      ]
    }
  });

  if (query.results && query.results.length > 0) {
    for (const page of query.results) {
        console.log(`Updating Notion page ${page.id} to 55g/650kcal...`);
        await notionRequest("PATCH", `/pages/${page.id}`, {
          properties: {
            "Carbs (est)": { number: 55 },
            "Calories (est)": { number: 650 },
            "Entry": { title: [{ text: { content: "Dinner: Pasta with meat sauce, cheese, pork belly, broccoli, and a slice of bread (~55g carbs, ~650 kcal) [📷](https://iili.io/qAQ2FNp.jpg) [📷](https://iili.io/qAQf0QV.jpg)" } }] }
          }
        });
    }
  } else {
    console.log("No matching page found with 70g carbs on March 9.");
  }
}

main().catch(console.error);
