const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

// --- Configuration ---
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1 of JaviCare2026
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";

// --- Helpers ---
function mysqlEscape(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function syncToMysql(data) {
  const mealType = data.category === "Food" ? (data.mealType === "-" ? "Snack" : data.mealType) : null;
  const photoUrl = data.photos && data.photos.length > 0 ? data.photos[0] : null;
  
  const sql = `
    INSERT INTO maria_health_log 
    (entry_title, event_date, user_name, category, meal_type, carbs_est, calories_est, photo_url)
    VALUES 
    (${mysqlEscape(data.text)}, ${mysqlEscape(data.iso.replace('T', ' ').substring(0, 19))}, 
     ${mysqlEscape(data.user)}, ${mysqlEscape(data.category)}, 
     ${mealType ? mysqlEscape(mealType) : 'NULL'}, 
     ${data.carbs || 'NULL'}, ${data.cals || 'NULL'}, 
     ${photoUrl ? mysqlEscape(photoUrl) : 'NULL'})
    ON DUPLICATE KEY UPDATE 
    entry_title = VALUES(entry_title),
    carbs_est = VALUES(carbs_est),
    calories_est = VALUES(calories_est),
    photo_url = VALUES(photo_url);
  `;
  
  try {
    execSync(`${MYSQL_BIN} -u root health_monitor -e "${sql.replace(/"/g, '\\"')}"`);
    console.log("  -> MySQL OK");
  } catch (e) {
    console.error("  -> MySQL Sync Failed:", e.message);
  }
}
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
          if (!d || d.trim() === "" || d.trim() === "[]") {
             resolve([]);
          } else {
             const parsed = JSON.parse(d);
             resolve(parsed);
          }
        } catch (e) {
          if (d.trim().startsWith('[') && d.trim().endsWith(']')) {
             // It is an array but maybe has something weird inside
             resolve([]);
          }
          console.error("  !! NS Request Parse Error. Body starts with:", d.substring(0, 100));
          resolve({ error: "Parse Error", body: d });
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
  const regex = /\[📷\]\((https?:\/\/[^\)]+)\)/g;
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

async function main() {
  console.log("Starting Radial Dispatcher v2.2...");
  
  if (!fs.existsSync(LOG_PATH)) {
    console.error("Error: health_log.md not found.");
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  // Process all history for backfill
  const lines = content.split('\n').filter(l => l.startsWith('| 202')).reverse(); 
  
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
      cals: parseInt(p[8]) || null
    };
    
    // Determine Timezone Offset
    let timePart = entryData.time;
    let offsetPart = null;
    if (timePart.includes(' ')) {
      const parts = timePart.split(' ');
      timePart = parts[0];
      offsetPart = parts[1];
    }

    const dStr = `${entryData.date}T${timePart}:00`;
    if (offsetPart) {
      entryData.iso = dStr + offsetPart;
    } else {
      const isPDT = new Date(dStr + "Z") > new Date("2026-03-08T10:00:00Z");
      entryData.iso = dStr + (isPDT ? "-07:00" : "-08:00");
    }

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

    const nsCheckUrl = `/api/v1/treatments.json?find[notes][$regex]=${encodeURIComponent(cleanText.substring(0, 30))}&count=1`;
    console.log(`  -> Querying NS by notes: ${nsCheckUrl}`);
    const existingNS = await nsRequest("GET", nsCheckUrl, {});
    
    if (!Array.isArray(existingNS)) {
      console.log(`  !! NS Query Failed (not an array): ${JSON.stringify(existingNS).substring(0, 200)}`);
    }

    if (Array.isArray(existingNS) && existingNS.length === 0) {
      console.log("  -> Pushing to Nightscout...");
      const postRes = await nsRequest("POST", "/api/v1/treatments.json", nsBody);
      console.log(`  -> POST result: ${JSON.stringify(postRes).substring(0, 50)}`);
    } else if (Array.isArray(existingNS) && existingNS.length > 0) {
      const existing = existingNS[0];
      // Only update if notes are substantially different or carbs changed
      if (existing.carbs !== nsBody.carbs) {
        console.log("  -> Updating Nightscout (carb change)...");
        const putRes = await nsRequest("PUT", "/api/v1/treatments.json", { ...nsBody, _id: existing._id });
        console.log(`  -> PUT result: ${JSON.stringify(putRes).substring(0, 50)}`);
      }
    }

    // 2. Sync to Notion
    const notionQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
      filter: { 
        and: [ 
            { property: "Date", date: { equals: entryData.iso } },
            { property: "Entry", title: { contains: cleanText.substring(0, 50) } }
        ] 
      }
    });
    const activeResults = (notionQuery.results || []).filter(r => !r.archived);

    const notionBody = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        "Entry": { title: [{ text: { content: cleanText } }] },
        "Date": { date: { start: entryData.iso } },
        "Category": { select: { name: entryData.category } },
        "User": { select: { name: entryData.user } },
        "Carbs (est)": { number: entryData.carbs },
        "Calories (est)": { number: entryData.cals },
        "Photo": { url: photos[0] || null }
      }
    };

    // Only set Meal Type if Category is Food
    if (entryData.category === "Food") {
      notionBody.properties["Meal Type"] = { 
        select: { name: entryData.mealType === "-" ? "Snack" : entryData.mealType } 
      };
    }

    if (activeResults.length === 0) {
      console.log("  -> Pushing to Notion...");
      
      // Basic prediction for new Food entries
      if (entryData.category === 'Food' && entryData.carbs > 0) {
        const mealTime = new Date(entryData.iso);
        const predPeakTime = new Date(mealTime.getTime() + 105 * 60 * 1000); 
        const predictedBg = Math.round(120 + (entryData.carbs * 3.5));
        
        notionBody.properties['Predicted Peak Time'] = { date: { start: predPeakTime.toISOString() } };
        notionBody.properties['Predicted Peak BG'] = { number: predictedBg > 300 ? 300 : predictedBg };
      }

      await notionRequest("POST", "/pages", notionBody);
    } else {
      const existing = activeResults[0];
      const existingTitle = existing.properties.Entry.title[0]?.plain_text;
      const existingCarbs = existing.properties["Carbs (est)"].number;
      const existingPhoto = existing.properties.Photo.url;

      if (existingTitle !== cleanText || existingCarbs !== entryData.carbs || existingPhoto !== (photos[0] || null)) {
        console.log("  -> Updating Notion...");
        delete notionBody.parent;
        await notionRequest("PATCH", `/pages/${existing.id}`, notionBody);
      }
    }

    // 3. Sync to MySQL
    syncToMysql({ ...entryData, text: cleanText, photos });
  }

  // 4. Update Dashboard
  try {
    console.log("  -> Updating Backup Dashboard...");
    execSync('node /Users/javier/.openclaw/workspace/scripts/generate_backup_dashboard_data.js');
    execSync('node /Users/javier/.openclaw/workspace/scripts/backfill_dashboard_history.js');
    execSync('node /Users/javier/.openclaw/workspace/scripts/generate_notion_gallery_data.js');
    execSync('cd /Users/javier/.openclaw/workspace/nightscout-meal-photos && git add . && git commit -m "chore: automated dashboard update" && git push origin main');
  } catch (e) {
    console.error("Dashboard update failed:", e.message);
  }

  console.log("Radial Sync Complete.");
}

main().catch(console.error);
