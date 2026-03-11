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
  console.log("Listing March 10 Notion pages...");
  const query = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
    filter: { property: "Date", date: { equals: "2026-03-10" } }
  });
  
  query.results.forEach(p => {
    const title = p.properties.Entry.title[0]?.plain_text || "No Title";
    const carbs = p.properties["Carbs (est)"].number;
    const cals = p.properties["Calories (est)"].number;
    console.log(`- ${p.id}: "${title}" [${carbs}g, ${cals}kcal]`);
  });
}
main();
