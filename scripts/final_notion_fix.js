const https = require('https');
const NOTION_KEY = "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";

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
  const pageId = "31f85ec7-0668-818c-b040-c10359294522";
  console.log(`Correcting Notion page ${pageId} for 55g/650kcal...`);
  await notionRequest("PATCH", `/pages/${pageId}`, {
    properties: {
      "Carbs (est)": { number: 55 },
      "Calories (est)": { number: 650 },
      "Entry": { title: [{ text: { content: "Dinner: Pasta with meat sauce, cheese, pork belly, broccoli, and a slice of bread (~55g carbs, ~650 kcal) [📷](https://iili.io/qAQ2FNp.jpg) [📷](https://iili.io/qAQf0QV.jpg)" } }] }
    }
  });
  console.log("Notion corrected.");
}
main();
