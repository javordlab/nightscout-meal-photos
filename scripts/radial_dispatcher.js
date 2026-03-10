const fs = require('fs');
const https = require('https');

// --- Configuration ---
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

// --- Helpers ---
async function nsRequest(method, endpoint, body) {
  const url = `${NIGHTSCOUT_URL}${endpoint}`;
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        'api-secret': NIGHTSCOUT_SECRET,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d || "{}")));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function notionRequest(method, endpoint, body) {
  const url = `https://api.notion.com/v1${endpoint}`;
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d || "{}")));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// --- Main Logic ---
async function main() {
  console.log("Starting Radial Dispatcher...");
  
  if (!fs.existsSync(LOG_PATH)) {
    console.error("Error: health_log.md not found.");
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n').filter(l => l.includes('| 202'));
  
  // We only sync the most recent entry from the top of the file
  const topEntry = lines[0];
  if (!topEntry) {
    console.log("No log entries found to sync.");
    return;
  }

  const p = topEntry.split('|').map(x => x.trim());
  const entryData = {
    date: p[1],
    time: p[2],
    user: p[3],
    category: p[4],
    mealType: p[5],
    text: p[6],
    carbs: parseInt(p[7]) || null,
    cals: parseInt(p[8]) || null,
    iso: `${p[1]}T${p[2]}:00-07:00` // Assuming PDT for now
  };

  console.log(`Syncing SSoT Entry: ${entryData.date} ${entryData.time} - ${entryData.text}`);

  // 1. Sync to Nightscout
  let eventType = "Note";
  if (entryData.category === "Food") eventType = "Meal Bolus";
  if (entryData.category === "Activity") eventType = "Exercise";

  const nsBody = {
    enteredBy: "Javordclaw-SSoT",
    eventType: eventType,
    carbs: entryData.carbs,
    notes: `${entryData.text} (~${entryData.carbs}g carbs, ~${entryData.cals} kcal)`,
    created_at: entryData.iso
  };

  // Check if already exists in NS (Basic dedupe by timestamp and text)
  const existingNS = await nsRequest("GET", `/api/v1/treatments.json?find[created_at]=${entryData.iso}&count=1`, {});
  if (existingNS.length === 0) {
    console.log("Pushing to Nightscout...");
    await nsRequest("POST", "/api/v1/treatments.json", nsBody);
  } else {
    console.log("Already exists in Nightscout. Skipping.");
  }

  // 2. Sync to Notion
  const notionQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
    filter: {
      and: [
        { property: "Date", date: { equals: entryData.date } },
        { property: "Entry", title: { contains: entryData.text.split('[')[0].trim() } }
      ]
    }
  });

  if (notionQuery.results.length === 0) {
    console.log("Pushing to Notion...");
    const notionBody = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        "Entry": { title: [{ text: { content: entryData.text } }] },
        "Date": { date: { start: entryData.iso } },
        "Category": { select: { name: entryData.category } },
        "User": { select: { name: entryData.user } },
        "Carbs (est)": { number: entryData.carbs },
        "Calories (est)": { number: entryData.cals },
        "Meal Type": { select: { name: entryData.mealType === "-" ? "Snack" : entryData.mealType } }
      }
    };
    await notionRequest("POST", "/pages", notionBody);
  } else {
    console.log("Already exists in Notion. Skipping.");
  }

  // 3. Trigger Gallery Rebuild
  console.log("Triggering Gallery Rebuild...");
  // Normally we would call node scripts/generate_notion_gallery_data.js here
  // But since we want SSoT, let's eventually make the gallery pull from health_log.md directly.

  console.log("Radial Sync Complete.");
}

main().catch(console.error);
