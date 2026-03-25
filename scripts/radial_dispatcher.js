const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const {
  NS_ENTERED_BY,
  createNsTelemetry
} = require('./health-sync/ns_identity');
const { upsertNightscoutTreatment } = require('./health-sync/ns_upsert_safe');

// --- Configuration ---
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1 of JaviCare2026
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";
const MYSQL_SYNC_ENABLED = true;
const DASHBOARD_SYNC_ENABLED = false;

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
    (entry_title, event_date, user_name, category, meal_type, carbs_est, calories_est, proteins, photo_url)
    VALUES 
    (${mysqlEscape(data.text)}, ${mysqlEscape(data.iso.replace('T', ' ').substring(0, 19))}, 
     ${mysqlEscape(data.user)}, ${mysqlEscape(data.category)}, 
     ${mealType ? mysqlEscape(mealType) : 'NULL'}, 
     ${data.carbs || 'NULL'}, ${data.cals || 'NULL'}, ${data.proteins || 'NULL'},
     ${photoUrl ? mysqlEscape(photoUrl) : 'NULL'})
    ON DUPLICATE KEY UPDATE 
    entry_title = VALUES(entry_title),
    carbs_est = VALUES(carbs_est),
    calories_est = VALUES(calories_est),
    proteins = VALUES(proteins),
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

// Parse prediction from health_log.md title text.
// Returns { bg, peakIso } if found, otherwise null.
// bg = upper bound of range (e.g. "175-200" → 200), capped at 300.
// peakIso = midpoint of time range as ISO string, or null if unparseable.
function parsePredFromText(text, mealIso) {
  const match = text.match(/\(Pred:\s*([^@)]+?)\s*@\s*([^)]+)\)/i);
  if (!match) return null;

  const bgNums = match[1].match(/\d+/g);
  if (!bgNums) return null;
  const bg = Math.min(parseInt(bgNums[bgNums.length - 1]), 300);

  let peakIso = null;
  if (mealIso) {
    const dateStr = mealIso.substring(0, 10);
    const offset = mealIso.match(/[+-]\d{2}:\d{2}$/)?.[0] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
    const timeMatches = [...match[2].matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)/gi)];
    if (timeMatches.length > 0) {
      const mins = timeMatches.map(t => {
        const [h, m] = t[1].split(':').map(Number);
        return (h % 12 + (t[2].toUpperCase() === 'PM' ? 12 : 0)) * 60 + m;
      });
      const avg = Math.round(mins.reduce((a, b) => a + b) / mins.length);
      peakIso = `${dateStr}T${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}:00${offset}`;
    }
  }

  return { bg, peakIso };
}

function extractPhotos(text) {
  const regex = /\[📷\]\((https?:\/\/[^\)]+)\)/g;
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

// Normalize entry title to match normalize_health_log.js's stripMetadata + normalizeTitle.
// Both scripts must produce identical keys for the same logical entry.
function normalizeEntryTitle(text) {
  let t = text.replace(/\[[^\]]*\]\([^)]+\)/g, ''); // strip all markdown links (photos)
  t = t
    .replace(/\(BG:[^)]*\)/gi, '')
    .replace(/\(Pred:\s*[^@)]+?\s*@\s*[^)]+\)/gi, '')
    .replace(/\(Protein:[^)]*\)/gi, '')
    .replace(/\(Carbs:[^)]*\|[^)]*\)/g, '')
    .replace(/\(Carbs:[^)]*\)/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.toLowerCase().replace(/[""]/g, '"').replace(/['']/g, "'");
}

function buildEntryKey(entryData, cleanText) {
  const title = normalizeEntryTitle(cleanText);
  return crypto
    .createHash('sha256')
    .update(`${entryData.iso}|${entryData.user}|${title}`)
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
  console.log("Starting Radial Dispatcher v2.3...");
  
  if (!fs.existsSync(LOG_PATH)) {
    console.error("Error: health_log.md not found.");
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const allLines = content.split('\n');
  const dataLines = allLines.filter(l => l.startsWith('| 202'));
  
  console.log(`Found ${dataLines.length} entries in log.`);

  // Process today's entries first, then last 30 days (using robust local date)
  const _sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const laDate = new Intl.DateTimeFormat('en-CA', { timeZone: _sysTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const today = laDate; // YYYY-MM-DD
  const cutoffDate = new Intl.DateTimeFormat('en-CA', { timeZone: _sysTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const priorityLines = dataLines.filter(l => l.includes(today));
  const otherLines = dataLines.filter(l => !l.includes(today) && l.slice(2, 12) >= cutoffDate).reverse();
  const finalLines = [...priorityLines, ...otherLines];
  console.log(`Processing ${priorityLines.length} today + ${otherLines.length} recent (cutoff: ${cutoffDate})`);

  let glucoseEntries = [];
  let photoSyncedToNotion = false;
  const nsTelemetry = createNsTelemetry();
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

    // Carbs and cals are always the last two data columns; entry text is everything in between.
    // This handles pipe characters inside the text (e.g. "(Protein: 18g | Carbs: ~45g | Cals: ~340)").
    const carbsIdx = p.length - 3;
    const calsIdx  = p.length - 2;
    const entryText = p.slice(6, carbsIdx).join(' | ');
    const proteinMatch = entryText.match(/\(Protein:\s*([\d.]+)g[^)]*\)/i);
    const entryData = {
      date: p[1],
      time: p[2],
      user: p[3],
      category: p[4],
      mealType: p[5],
      text: entryText,
      carbs: parseInt(p[carbsIdx]) || null,
      cals: parseInt(p[calsIdx]) || null,
      proteins: proteinMatch ? parseFloat(proteinMatch[1]) : null
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
      const _d = new Date(dStr); const _om = -_d.getTimezoneOffset(); const _s = _om >= 0 ? '+' : '-'; const _h = String(Math.floor(Math.abs(_om) / 60)).padStart(2, '0'); const _m = String(Math.abs(_om) % 60).padStart(2, '0');
      entryData.iso = dStr + `${_s}${_h}:${_m}`;
    }

    const photos = entryData.category === 'Food' ? extractPhotos(entryData.text) : [];
    let cleanText = entryData.text.replace(/\[📷\]\([^\)]+\)/g, '').trim();
    cleanText = injectKnownBgIfUnknown(cleanText, entryData.iso, glucoseEntries);

    if (cleanText.includes('[Photo received - awaiting manual description]')) {
      console.log(`Skipping draft placeholder: ${entryData.date} ${entryData.time}`);
      continue;
    }

    console.log(`Checking: ${entryData.date} ${entryData.time} - ${cleanText}`);

    // 1. Sync to Nightscout
    let eventType = "Note";
    if (entryData.category === "Food") eventType = "Meal Bolus";
    if (entryData.category === "Activity") eventType = "Exercise";

    const entryKey = buildEntryKey(entryData, cleanText);
    const nsBody = {
      enteredBy: NS_ENTERED_BY,
      eventType: eventType,
      carbs: entryData.carbs,
      notes: buildNightscoutNotes(cleanText, entryData, photos, entryKey),
      created_at: entryData.iso
    };

    const nsEntryKey = `sha256:${entryKey}`;
    const nsRes = await upsertNightscoutTreatment({
      nsRequest,
      payload: nsBody,
      entryKey: nsEntryKey,
      titleForMatch: cleanText,
      normalizeForMatch: normalizeEntryTitle,
      telemetry: nsTelemetry,
      logger: (evt) => console.log(`  -> NS ${evt.op}: ${JSON.stringify(evt)}`)
    });

    if (nsRes.status === 'error') {
      console.log(`  !! NS sync error (${nsRes.error}) for ${nsEntryKey}`);
    } else if (nsRes.status === 'conflict') {
      console.log(`  !! NS conflict (${nsRes.reason}) for ${nsEntryKey}; candidates=${(nsRes.candidateIds || []).join(',')}`);
    } else {
      console.log(`  -> NS ${nsRes.status}: ${nsRes.treatmentId || 'n/a'}`);
    }

    // 2. Sync to Notion
    // Query by timestamp + user only (NOT title) so title edits update rather than duplicate.
    const notionQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
      filter: {
        and: [
          { property: "Date", date: { equals: entryData.iso } },
          { property: "User", select: { equals: entryData.user } }
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
        "Proteins": { number: entryData.proteins },
        "Photo": { url: photos[0] || null }
      }
    };

    // Only set Meal Type if Category is Food
    if (entryData.category === "Food") {
      notionBody.properties["Meal Type"] = {
        select: { name: entryData.mealType === "-" ? "Snack" : entryData.mealType }
      };
    }

    // Projection block: use agent's context-aware prediction from title, fall back to formula.
    if (entryData.category === 'Food' && entryData.carbs > 0) {
      const mealTime = new Date(entryData.iso);
      const pred = parsePredFromText(cleanText, entryData.iso);
      const predictedBg = pred ? pred.bg : Math.min(Math.round(120 + (entryData.carbs * 3.5)), 300);
      const peakIso = pred?.peakIso || new Date(mealTime.getTime() + 105 * 60 * 1000).toISOString();
      notionBody.properties['Predicted Peak Time'] = { date: { start: peakIso } };
      notionBody.properties['Predicted Peak BG'] = { number: predictedBg };
    }

    if (activeResults.length === 0) {
      console.log("  -> Pushing to Notion...");
      await notionRequest("POST", "/pages", notionBody);
      if (photos[0]) photoSyncedToNotion = true;
    } else {
      const existing = activeResults[0];

      // Archive any duplicates beyond the canonical first result
      if (activeResults.length > 1) {
        for (const dupe of activeResults.slice(1)) {
          console.log(`  -> Archiving duplicate Notion page: ${dupe.id}`);
          await notionRequest("PATCH", `/pages/${dupe.id}`, { archived: true });
        }
      }

      const existingTitle = existing.properties.Entry?.title[0]?.plain_text;
      const existingCarbs = existing.properties["Carbs (est)"]?.number;
      const existingPhoto = existing.properties.Photo?.url;

      if (existingTitle !== cleanText || existingCarbs !== entryData.carbs || existingPhoto !== (photos[0] || null)) {
        console.log("  -> Updating Notion...");
        delete notionBody.parent;
        await notionRequest("PATCH", `/pages/${existing.id}`, notionBody);
        if (photos[0] && existingPhoto !== photos[0]) photoSyncedToNotion = true;
      } else {
        console.log("  -> Notion up to date.");
      }
    }

    // 3. Sync to MySQL (paused)
    if (MYSQL_SYNC_ENABLED) {
      syncToMysql({ ...entryData, text: cleanText, photos });
    }
  }

  // 4. Update gallery when a photo was written to Notion this run
  if (photoSyncedToNotion) {
    try {
      console.log("  -> Photo synced to Notion — regenerating gallery...");
      execSync('node /Users/javier/.openclaw/workspace/scripts/generate_notion_gallery_data.js', { stdio: 'inherit' });
      execSync('cd /Users/javier/.openclaw/workspace/nightscout-meal-photos && git add data/notion_meals.json && (git commit -m "chore: gallery update after photo sync" || true) && git push origin main', { stdio: 'inherit' });
      console.log("  -> Gallery updated and pushed.");
    } catch (e) {
      console.error("Gallery update failed:", e.message);
    }
  }

  console.log(`NS Telemetry: ${JSON.stringify(nsTelemetry)}`);
  console.log("Radial Sync Complete.");
}

main().catch(console.error);
