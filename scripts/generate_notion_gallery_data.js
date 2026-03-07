const https = require('https');
const fs = require('fs');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const OUTPUT_FILE = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json";

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => resolve(JSON.parse(responseBody)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log("Fetching food entries with photos from Notion...");
  const data = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: "Category", select: { equals: "Food" } },
        { property: "Photo", url: { is_not_empty: true } }
      ]
    },
    sorts: [{ property: "Date", direction: "descending" }]
  });

  if (!data.results) {
      console.error("No results found or error occurred.");
      process.exit(1);
  }

  const meals = data.results.map(item => {
    const props = item.properties;
    return {
      id: item.id,
      title: props.Entry.title[0]?.text?.content || "Untitled",
      type: props["Meal Type"]?.select?.name || "Food",
      date: props.Date.date.start,
      photo: props.Photo.url,
      carbs: props["Carbs (est)"].number,
      cals: props["Calories (est)"].number,
      delta: props["BG Delta"].number,
      peak: props["2hr Peak BG"].number
    };
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(meals, null, 2));
  console.log(`Generated ${meals.length} entries in ${OUTPUT_FILE}`);
}

main().catch(console.error);
