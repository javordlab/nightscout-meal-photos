const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');

// --- Configuration ---
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1 of JaviCare2026
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";
const MYSQL_SYNC_ENABLED = true;
const DASHBOARD_SYNC_ENABLED = true;

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

function buildEntryKey(entryData, cleanText) {
  return crypto
    .createHash('sha256')
    .update(`${entryData.iso}|${entryData.user}|${entryData.category}|${entryData.mealType}|${cleanText}`)
    .digest('hex');
}

function buildNightscoutNotes(cleanText, entryData, photos, entryKey) {
  const nutrition = entryData.carbs !== null ? ` (~${entryData.carbs}g carbs, ~${entryData.cals ?? 'n/a'} kcal)` : '';
  const photoPart = photos.length ? ` 📷 ${photos.join(' ')}` : '';
  return `${cleanText}${nutrition}${photoPart} [entry_key:sha256:${entryKey}]`;
}

function directionToArrow(direction) {
  const map = {
    Flat: '➡️',
    FortyFiveUp: '↗️',
    SingleUp: '⬆️',
    DoubleUp: '⬆️⬆️',
    FortyFiveDown: '↘️',
    SingleDown: '⬇️',
    DoubleDown: '⬇️⬇️'
  };
  return map[direction] || direction || '';
}

function injectKnownBgIfUnknown(cleanText, mealIso, glucoseEntries) {
  if (!cleanText.includes('(BG: Unknown)') || !Array.isArray(glucoseEntries) || glucoseEntries.length === 0) {
    return cleanText;
  }

  const mealMs = new Date(mealIso).getTime();
  let best = null;
  let bestDiff = 20 * 60 * 1000; // <= 20 min window

  for (const e of glucoseEntries) {
    const t = e.date || e.mills;
    if (!t || e.sgv == null) continue;
    const diff = Math.abs(t - mealMs);
    if (diff <= bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }

  if (!best) return cleanText;
  const bgText = `${best.sgv} mg/dL ${directionToArrow(best.direction)}`.trim();
  return cleanText.replace('(BG: Unknown)', `(BG: ${bgText})`);
}

async function main() {
  console.log("Starting Radial Dispatcher v2.2...");
  
  if (!fs.existsSync(LOG_PATH)) {
    console.error("Error: health_log.md not found.");
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const allLines = content.split('\n');
  const dataLines = allLines.filter(l => l.startsWith('| 202'));
  
  console.log(`Found ${dataLines.length} entries in log.`);

  // Process today's entries first, then the rest (using robust local PST date)
  const laDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const today = laDate; // YYYY-MM-DD
  const priorityLines = dataLines.filter(l => l.includes(today));
  const otherLines = dataLines.filter(l => !l.includes(today)).reverse();
  const finalLines = [...priorityLines, ...otherLines];

  let glucoseEntries = [];
  try {
    glucoseEntries = await nsRequest("GET", "/api/v1/entries.json?count=5000", {});
    if (!Array.isArray(glucoseEntries)) glucoseEntries = [];
  } catch (e) {
    console.log(`  !! Could not preload glucose entries: ${e.message}`);
    glucoseEntries = [];
  }

  for (const line of finalLines) {
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
    let cleanText = entryData.text.replace(/\[📷\]\([^\)]+\)/g, '').trim();
    cleanText = injectKnownBgIfUnknown(cleanText, entryData.iso, glucoseEntries);

    console.log(`Checking: ${entryData.date} ${entryData.time} - ${cleanText}`);

    // 1. Sync to Nightscout
    let eventType = "Note";
    if (entryData.category === "Food") eventType = "Meal Bolus";
    if (entryData.category === "Activity") eventType = "Exercise";

    const entryKey = buildEntryKey(entryData, cleanText);
    const nsBody = {
      enteredBy: "Javordclaw-SSoT",
      eventType: eventType,
      carbs: entryData.carbs,
      notes: buildNightscoutNotes(cleanText, entryData, photos, entryKey),
      created_at: entryData.iso
    };

    const nsCheckByKeyUrl = `/api/v1/treatments.json?find[notes][$regex]=${encodeURIComponent(`entry_key:sha256:${entryKey}`)}&count=10`;
    console.log(`  -> Querying NS by entry key: ${nsCheckByKeyUrl}`);
    let existingNS = await nsRequest("GET", nsCheckByKeyUrl, {});
    let lookupMode = 'key';

    if (!Array.isArray(existingNS) || existingNS.length === 0) {
      const nsFallbackUrl = `/api/v1/treatments.json?find[created_at]=${encodeURIComponent(entryData.iso)}&find[enteredBy]=Javordclaw-SSoT&count=10`;
      console.log(`  -> Fallback NS query by timestamp: ${nsFallbackUrl}`);
      existingNS = await nsRequest("GET", nsFallbackUrl, {});
      lookupMode = 'timestamp';
    }

    if (!Array.isArray(existingNS)) {
      console.log(`  !! NS Query Failed (not an array): ${JSON.stringify(existingNS).substring(0, 200)}`);
      existingNS = [];
    }

    if (existingNS.length === 0) {
      console.log("  -> Pushing to Nightscout...");
      const postRes = await nsRequest("POST", "/api/v1/treatments.json", nsBody);
      console.log(`  -> POST result: ${JSON.stringify(postRes).substring(0, 50)}`);
    } else {
      const existing =
        existingNS.find(e => (e.notes || '').includes(`entry_key:sha256:${entryKey}`)) ||
        existingNS.find(e => e.created_at === entryData.iso) ||
        existingNS[0];

      const notesChanged = (existing.notes || '') !== (nsBody.notes || '');
      const carbsChanged = existing.carbs !== nsBody.carbs;
      const typeChanged = (existing.eventType || '') !== (nsBody.eventType || '');

      if (notesChanged || carbsChanged || typeChanged) {
        const reasons = [
          carbsChanged ? 'carbs' : null,
          notesChanged ? 'notes' : null,
          typeChanged ? 'eventType' : null
        ].filter(Boolean).join(', ');
        console.log(`  -> Updating Nightscout (${reasons})...`);
        const putRes = await nsRequest("PUT", "/api/v1/treatments.json", { ...nsBody, _id: existing._id });
        console.log(`  -> PUT result: ${JSON.stringify(putRes).substring(0, 50)}`);
      }

      if (lookupMode === 'key' && existingNS.length > 1) {
        const dupes = existingNS.filter(e => e._id && e._id !== existing._id);
        for (const dupe of dupes) {
          console.log(`  -> Removing duplicate NS treatment: ${dupe._id}`);
          await nsRequest("DELETE", `/api/v1/treatments/${dupe._id}`);
        }
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

    // 3. Sync to MySQL (paused)
    if (MYSQL_SYNC_ENABLED) {
      syncToMysql({ ...entryData, text: cleanText, photos });
    }
  }

  // 4. Update Dashboard (paused)
  if (DASHBOARD_SYNC_ENABLED) {
    try {
      console.log("  -> Updating Backup Dashboard...");
      execSync('node /Users/javier/.openclaw/workspace/scripts/generate_backup_dashboard_data.js');
      execSync('node /Users/javier/.openclaw/workspace/scripts/generate_notion_gallery_data.js');
      
      // Generate charts and copy to deploy
      console.log("  -> Generating chart images...");
      execSync('node /Users/javier/.openclaw/workspace/scripts/generate_daily_glucose_chart.js');
      execSync('node /Users/javier/.openclaw/workspace/scripts/generate_glucose_chart.js');
      execSync('cp /Users/javier/.openclaw/workspace/tmp/*.png /Users/javier/.openclaw/workspace/nightscout-meal-photos/');
      
      execSync('cd /Users/javier/.openclaw/workspace/nightscout-meal-photos && git add data/backups.json data/notion_meals.json *.png && (git commit -m "chore: automated dashboard update" || true) && git push origin main');
    } catch (e) {
      console.error("Dashboard update failed:", e.message);
    }
  }

  console.log("Radial Sync Complete.");
}

main().catch(console.error);
