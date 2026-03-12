const fs = require('fs');
const https = require('https');

// --- Configuration ---
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

// --- Helpers ---
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
        try {
          resolve(JSON.parse(d || "{}"));
        } catch (e) {
          resolve(d);
        }
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
        try {
          resolve(JSON.parse(d || "{}"));
        } catch (e) {
          resolve(d);
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function extractPhotos(text) {
  const regex = /\[📷\]\((https:\/\/iili\.io\/[^\)]+)\)/g;
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

async function main() {
  console.log("Starting Radial Dispatcher v2...");
  
  if (!fs.existsSync(LOG_PATH)) {
    console.error("Error: health_log.md not found.");
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n').filter(l => l.includes('| 2026-03-10') || l.includes('| 2026-03-11') || l.includes('| 2026-03-12')).reverse(); // Process Mar 10-12
  
  console.log(`Found ${lines.length} entries in log.`);

  for (const line of lines) {
    const p = line.split('|').map(x => x.trim());
    if (p.length < 9) continue;

    const entryData = {
      date: p[1],
      time: p[2],
      user: p[3],
      category: p[4],
      mealType: p[5],
      text: p[6],
      carbs: parseInt(p[7]) || null,
      cals: parseInt(p[8]) || null,
      iso: `${p[1]}T${p[2]}:00-07:00` // Assuming PDT for Mar 2026
    };

    const photos = extractPhotos(entryData.text);
    const cleanText = entryData.text.replace(/\[📷\]\([^\)]+\)/g, '').trim();

    console.log(`Checking: ${entryData.date} ${entryData.time} - ${cleanText}`);

    // 1. Sync to Nightscout
    let eventType = "Note";
    if (entryData.category === "Food") eventType = "Meal Bolus";
    if (entryData.category === "Activity") eventType = "Exercise";

    const nsBody = {
      enteredBy: "Javordclaw-SSoT",
      eventType: eventType,
      carbs: entryData.carbs,
      notes: `${cleanText}${entryData.carbs ? ` (~${entryData.carbs}g carbs, ~${entryData.cals} kcal)` : ''}${photos.length ? ' 📷 ' + photos.join(' ') : ''}`,
      created_at: entryData.iso
    };

    const existingNS = await nsRequest("GET", `/api/v1/treatments.json?find[created_at]=${entryData.iso}&count=1`, {});
    if (Array.isArray(existingNS) && existingNS.length === 0) {
      console.log("  -> Pushing to Nightscout...");
      await nsRequest("POST", "/api/v1/treatments.json", nsBody);
    } else if (Array.isArray(existingNS) && existingNS.length > 0) {
      // Check if text matches, if not update
      const existing = existingNS[0];
      if (existing.notes !== nsBody.notes || existing.carbs !== nsBody.carbs) {
        console.log("  -> Updating Nightscout...");
        await nsRequest("PUT", "/api/v1/treatments.json", { ...nsBody, _id: existing._id });
      }
    }

    // 2. Sync to Notion
    const notionQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
      filter: {
        and: [
          { property: "Date", date: { equals: entryData.iso } }
        ]
      }
    });

    const notionBody = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        "Entry": { title: [{ text: { content: cleanText } }] },
        "Date": { date: { start: entryData.iso } },
        "Category": { select: { name: entryData.category } },
        "User": { select: { name: entryData.user } },
        "Carbs (est)": { number: entryData.carbs },
        "Calories (est)": { number: entryData.cals },
        "Meal Type": { select: { name: entryData.mealType === "-" ? "Snack" : entryData.mealType } },
        "Photo": { url: photos[0] || null }
      }
    };

    if (notionQuery.results.length === 0) {
      console.log("  -> Pushing to Notion...");
      await notionRequest("POST", "/pages", notionBody);
    } else {
      const existing = notionQuery.results[0];
      const existingTitle = existing.properties.Entry.title[0]?.plain_text;
      const existingCarbs = existing.properties["Carbs (est)"].number;
      const existingPhoto = existing.properties.Photo.url;

      if (existingTitle !== cleanText || existingCarbs !== entryData.carbs || existingPhoto !== (photos[0] || null)) {
        console.log("  -> Updating Notion...");
        delete notionBody.parent;
        await notionRequest("PATCH", `/pages/${existing.id}`, notionBody);
      }
    }
  }

  console.log("Radial Sync Complete.");
}

main().catch(console.error);
