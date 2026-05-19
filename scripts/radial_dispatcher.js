const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const path = require('path');
const {
  NS_ENTERED_BY,
  createNsTelemetry
} = require('./health-sync/ns_identity');
const { loadSyncState, saveSyncState, upsertEntry } = require('./health-sync/sync_state');
const { stampFile: stampRowIds } = require('./health-sync/row_id');
const SYNC_STATE_PATH = path.join(__dirname, '../data/sync_state.json') ||
  '/Users/javier/.openclaw/workspace/data/sync_state.json';
const { upsertNightscoutTreatment } = require('./health-sync/ns_upsert_safe');
const { writeReceipt } = require('./health-sync/cron_receipt');

// --- Configuration ---
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const NORMALIZED_PATH = "/Users/javier/.openclaw/workspace/data/health_log.normalized.json";
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1 of JaviCare2026
const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";
const MYSQL_SYNC_ENABLED = false; // paused — toggled by cron
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
  // Match both [📷](url) and [photo](url) formats
  const regex = /\[(?:📷|photo)\]\((https?:\/\/[^\)]+)\)/gi;
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

// Normalize entry title to match normalize_health_log.js's stripMetadata + normalizeTitle.
// Both scripts must produce identical keys for the same logical entry.
//
// IMPORTANT: this list MUST stay in sync with normalize_health_log.js stripMetadata.
// Any annotation that gets appended to a meal entry AFTER initial write — and that
// is NOT a stable identifier of the entry — must be stripped here, otherwise the
// entry_key drifts on every revision and the dispatcher creates duplicate Notion
// pages. The "[Coach: …]" addition in particular caused the 190-page dedup
// backlog cleaned up on 2026-05-18.
function normalizeEntryTitle(text) {
  let t = text.replace(/\[[^\]]*\]\([^)]+\)/g, ''); // strip all markdown links (photos)
  t = t
    .replace(/\[id:[a-f0-9]{8}\]/g, '')
    .replace(/\[Coach:[^\]]*\]/gi, '')
    .replace(/\[Cumulative[^\]]*\]/gi, '')
    .replace(/\(logged late\)/gi, '')
    .replace(/\(BG:[^)]*\)/gi, '')
    .replace(/\(Pred:\s*[^@)]+?\s*@\s*[^)]+\)/gi, '')
    .replace(/\(Protein:[^)]*\)/gi, '')
    .replace(/\(Carbs:[^)]*\|[^)]*\)/g, '')
    .replace(/\(Carbs:[^)]*\)/g, '')
    .replace(/\(Cals:[^)]*\)/gi, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
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

  // Outcome metrics for the cron dashboard receipt (see scripts/health-sync/cron_receipt.js).
  const metrics = {
    processed: 0,
    skipped: 0,
    ns_ok: 0,
    ns_errors: 0,
    ns_conflicts: 0,
    notion_new: 0,
    notion_updated: 0,
    notion_unchanged: 0,
    notion_duplicates_archived: 0,
    entry_errors: 0,
    gallery_updated: 0
  };

  if (!fs.existsSync(LOG_PATH)) {
    console.error("Error: health_log.md not found.");
    writeReceipt({ status: 'error', summary: 'health_log.md not found', metrics });
    process.exit(1);
  }

  // Stamp [id:xxxxxxxx] tags on any data rows that lack one. This is the
  // foundation for ID-based Notion reconciliation — every SSoT row gets a
  // stable identity that survives title rewrites (mealtype reclassification,
  // Coach/BG enrichment, photo URL replacement, etc.).
  try {
    const idStats = stampRowIds(LOG_PATH);
    if (idStats.stamped > 0) {
      console.log(`Stamped row IDs: ${idStats.stamped} new / ${idStats.alreadyStamped} existing (errors: ${idStats.errors})`);
    }
  } catch (e) {
    console.error('Row ID stamper failed:', e.message);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const allLines = content.split('\n');
  const dataLines = allLines.filter(l => l.startsWith('| 202'));

  console.log(`Found ${dataLines.length} entries in log.`);

  // Load sync state once — used to skip already-synced entries
  const syncState = loadSyncState(SYNC_STATE_PATH);
  const syncedTimestamps = new Set(
    Object.values(syncState.entries || {}).map(e => e.timestamp)
  );

  // Load normalized SSoT so we can use the SAME entry_key that
  // normalize_health_log.js / unified_sync.js / sync_state.json use. Recomputing
  // it locally produced a different hash (this script's cleanText includes BG
  // annotations like "(BG: 139 mg/dL Flat)" while the normalized title strips
  // them), which made the Notion `Entry Key` lookup miss for legitimate
  // matches and silently create duplicates.
  //
  // Indexed by (iso|user|category|normalizedTitle) — the normalized title is
  // required to disambiguate same-minute siblings like the 2026-03-28 19:30
  // pair (Berberine + Metformin both Medication).
  let normalizedByKey = new Map();
  try {
    if (fs.existsSync(NORMALIZED_PATH)) {
      const norm = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
      for (const e of (norm.entries || [])) {
        const titleKey = normalizeEntryTitle(e.title || '');
        normalizedByKey.set(`${e.timestamp}|${e.user}|${e.category}|${titleKey}`, e);
      }
    }
  } catch (e) {
    console.warn(`  !! Could not load normalized SSoT: ${e.message}`);
  }

  // Today's entries always processed (may have new photos/edits).
  // Older entries only processed if NOT yet in sync_state (never synced).
  const _sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: _sysTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const priorityLines = dataLines.filter(l => l.includes(today));
  const otherLines = dataLines.filter(l => !l.includes(today)).reverse();
  const finalLines = [...priorityLines, ...otherLines];
  console.log(`Processing ${priorityLines.length} today + ${otherLines.length} historical (skip-eligible)`);

  let glucoseEntries = [];
  let photoSyncedToNotion = false;
  const nsTelemetry = createNsTelemetry();

  // Row Id reconciler — track every SSoT row's [id:xxx] that falls in the
  // 7-day reconciliation window. After the per-entry loop, any Notion page in
  // that window whose Row Id is not in this set gets archived as an orphan.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const recentRowIds = new Set();
  const ROW_ID_GRACE_SENTINEL = path.join(__dirname, '../data/row_id_reconciler_initialized.json');
  try {
    // 576 = 48h of CGM readings at 5-min intervals — enough for any projection window
    glucoseEntries = await nsRequest("GET", "/api/v1/entries.json?count=576", {});
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
    const rowIdMatch = entryText.match(/\[id:([a-f0-9]{8})\]/);
    const rowId = rowIdMatch ? rowIdMatch[1] : null;
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

    // Track Row Id for the orphan reconciler regardless of whether this entry
    // ends up being synced this run (skip-if-synced still keeps it canonical).
    // Use date-string comparison (entryData.date >= sevenDaysAgoDateStr) to
    // match the Notion query window — using timestamp-ms cutoff misaligns when
    // an entry's Date is the same as cutoff-day but its time is earlier.
    const _entryMs = new Date(entryData.iso).getTime();
    const _sevenDaysAgoDateStr = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);
    if (rowId && entryData.date >= _sevenDaysAgoDateStr) {
      recentRowIds.add(rowId);
    }

    const photos = entryData.category === 'Food' ? extractPhotos(entryData.text) : [];
    let cleanText = entryData.text
      .replace(/\[(?:📷|photo)\]\([^\)]+\)/gi, '')
      .replace(/\s*\[id:[a-f0-9]{8}\]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    cleanText = injectKnownBgIfUnknown(cleanText, entryData.iso, glucoseEntries);

    if (cleanText.includes('[Photo received - awaiting manual description]')) {
      console.log(`Skipping draft placeholder: ${entryData.date} ${entryData.time}`);
      metrics.skipped++;
      continue;
    }

    // Skip if already fully synced: look up by timestamp+user in sync_state.
    //
    // Drift-robust: sync_state can have MULTIPLE records for the same
    // (timestamp, user) when entry_key has drifted across title rewrites.
    // Scan all matching records and pick any one that has both NS treatment
    // and Notion page IDs — that proves the entry was fully synced at some
    // point. Using .find() with just the first match misses these (caused
    // ~500 entries to re-process every cron tick).
    //
    // Photo check policy:
    //   - Entries WITHIN 7-day window: require exact photo URL match —
    //     ensures recent gh-pages photo URL rewrites propagate to NS.
    //   - Entries OUTSIDE 7-day window: skip without photo check. NS notes
    //     may carry slightly stale photo URLs, but photos remain accessible
    //     via Notion + gh-pages gallery. Re-syncing every old entry just to
    //     refresh a photo URL costs ~700 NS calls per cron tick.
    const matchingRecords = Object.values(syncState.entries || {}).filter(
      e => e.timestamp === entryData.iso && e.user === entryData.user
    );
    const fullySynced = matchingRecords.find(
      e => e.nightscout?.treatment_id && e.notion?.page_id
    );
    if (fullySynced) {
      const isOldEntry = entryData.date < _sevenDaysAgoDateStr;
      let canSkip = false;
      if (isOldEntry) {
        canSkip = true;
      } else {
        const photosSynced = photos.length === 0 ||
          (fullySynced.photo_urls?.length > 0 && photos.every(u => fullySynced.photo_urls.includes(u)));
        canSkip = photosSynced;
      }
      if (canSkip) {
        console.log(`Skip (synced): ${entryData.date} ${entryData.time.slice(0,5)}`);
        metrics.skipped++;
        continue;
      }
    }

    metrics.processed++;
    // Prefer the normalized SSoT's precomputed entry_key (consistent with
    // sync_state.json + Notion `Entry Key` property). Fall back to local
    // recompute only if the entry isn't in the normalized index.
    const lookupTitle = normalizeEntryTitle(cleanText);
    const normalizedEntry = normalizedByKey.get(
      `${entryData.iso}|${entryData.user}|${entryData.category}|${lookupTitle}`
    );
    const entryKey = normalizedEntry?.entryKey?.replace(/^sha256:/, '') || buildEntryKey(entryData, cleanText);
    console.log(`Checking: ${entryData.date} ${entryData.time} - ${cleanText.slice(0, 60)}`);

    // 1. Sync to Nightscout (skipped for Sleep — not a treatment)
    let eventType = "Note";
    if (entryData.category === "Food") eventType = "Meal Bolus";
    if (entryData.category === "Activity" || entryData.category === "Exercise") eventType = "Exercise";

    const nsEntryKey = `sha256:${entryKey}`;
    if (entryData.category === "Sleep") {
      console.log(`  -> NS skipped (Sleep entries don't sync to Nightscout)`);
    } else {
      const nsBody = {
        enteredBy: NS_ENTERED_BY,
        eventType: eventType,
        carbs: entryData.carbs,
        notes: buildNightscoutNotes(cleanText, entryData, photos, entryKey),
        created_at: entryData.iso
      };

      const syncStateEntry = (syncState.entries || {})[nsEntryKey];
      const knownNsTreatmentId = syncStateEntry?.nightscout?.treatment_id || null;
      const nsRes = await upsertNightscoutTreatment({
        nsRequest,
        payload: nsBody,
        entryKey: nsEntryKey,
        knownTreatmentId: knownNsTreatmentId,
        titleForMatch: cleanText,
        normalizeForMatch: normalizeEntryTitle,
        telemetry: nsTelemetry,
        logger: (evt) => console.log(`  -> NS ${evt.op}: ${JSON.stringify(evt)}`)
      });

      if (nsRes.status === 'error') {
        console.log(`  !! NS sync error (${nsRes.error}) for ${nsEntryKey}`);
        metrics.ns_errors++;
      } else if (nsRes.status === 'conflict') {
        console.log(`  !! NS conflict (${nsRes.reason}) for ${nsEntryKey}; candidates=${(nsRes.candidateIds || []).join(',')}`);
        metrics.ns_conflicts++;
      } else {
        console.log(`  -> NS ${nsRes.status}: ${nsRes.treatmentId || 'n/a'}`);
        metrics.ns_ok++;
      }
    }

    // 2. Sync to Notion — Row Id reconciler (2026-05-19)
    //
    // Every SSoT row carries a stable `[id:xxxxxxxx]` tag stamped by
    // scripts/health-sync/row_id.js. Notion pages mirror it in the `Row Id`
    // property. The reconciler is a 1:1 mapping: one SSoT row ↔ one Notion
    // page. Title rewrites (mealtype reclassification, Coach/BG/photo
    // enrichment) no longer drift identity because the Row Id is independent
    // of content.
    //
    // Fallback chain (added 2026-05-19 after runaway-dupe incident):
    //   1. Query by Row Id (preferred — set on all backfilled pages).
    //   2. If 0 results: query by Entry Key (legacy pages without Row Id).
    //      When a match is found, stamp Row Id on the matched page so the
    //      next run uses the fast path.
    // Hard window: entries older than 7 days bypass Notion sync entirely.
    // The reconciler only operates on a 7-day window, and old pages may
    // lack BOTH Row Id and Entry Key — without this gate they'd be
    // re-created on every cron tick. NS sync still runs for old entries
    // (NS has its own 30-day cutoff + idempotent upsert).
    // Use date-string comparison to align with recentRowIds + Notion query.
    if (entryData.date < _sevenDaysAgoDateStr) {
      metrics.notion_skipped_old = (metrics.notion_skipped_old || 0) + 1;
      continue;
    }
    let activeResults = [];
    if (!rowId) {
      console.warn(`  !! No Row Id for ${entryData.iso} ${entryData.category} — skipping Notion sync (stamper should have caught this)`);
      metrics.notion_skipped_no_row_id = (metrics.notion_skipped_no_row_id || 0) + 1;
      continue;
    }
    const notionQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
      filter: { property: "Row Id", rich_text: { equals: rowId } }
    });
    activeResults = (notionQuery.results || []).filter(r => !r.archived);

    // Fallback to Entry Key for legacy pages without Row Id stamped.
    if (activeResults.length === 0) {
      const ekQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
        filter: { property: "Entry Key", rich_text: { equals: nsEntryKey } }
      });
      const ekMatches = (ekQuery.results || []).filter(r => !r.archived);
      if (ekMatches.length > 0) {
        // Stamp Row Id on the matched legacy page so future runs use Row Id.
        const matched = ekMatches[0];
        try {
          await notionRequest("PATCH", `/pages/${matched.id}`, {
            properties: { "Row Id": { rich_text: [{ text: { content: rowId } }] } }
          });
          metrics.notion_legacy_row_id_stamped = (metrics.notion_legacy_row_id_stamped || 0) + 1;
        } catch (e) {
          console.warn(`  !! Failed to stamp Row Id on legacy page ${matched.id.slice(0,8)}: ${e.message}`);
        }
        activeResults = ekMatches;
      }
    }

    // Extract the [Coach: ...] supportive nutrition assessment from cleanText, if present.
    // Added 2026-04-09 — generated by the food-log agent (foodlog-cwd/CLAUDE.md Step 4.5)
    // for Food entries only, written into the entry text as a bracketed annotation.
    // We pull it out here so it can be stored in its own Notion "Meal Assessment" property
    // for dashboard display, while keeping the source-of-truth annotation in health_log.md.
    let coachAssessment = null;
    const coachMatch = cleanText.match(/\[Coach:\s*([^\]]+)\]/);
    if (coachMatch) {
      coachAssessment = coachMatch[1].trim();
    }

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
        "Photo": { url: photos[0] || null },
        // Stable per-entry identity. Added 2026-04-06 to disambiguate
        // same-minute entries that previously collided on (Date,User,Category).
        // Retained for backward compat — Entry Key is no longer the canonical
        // lookup but other consumers still read it.
        "Entry Key": { rich_text: [{ text: { content: nsEntryKey } }] },
        // Row Id is the canonical lookup since 2026-05-19. Stable across title
        // rewrites; sourced from health_log.md's `[id:xxx]` inline tag.
        "Row Id": { rich_text: [{ text: { content: rowId } }] }
      }
    };

    // Set Meal Assessment property if a Coach annotation was found in the entry text
    if (coachAssessment) {
      notionBody.properties["Meal Assessment"] = {
        rich_text: [{ text: { content: coachAssessment.slice(0, 2000) } }]
      };
    }

    // Only set Meal Type if Category is Food
    if (entryData.category === "Food") {
      notionBody.properties["Meal Type"] = {
        select: { name: entryData.mealType === "-" ? "Snack" : entryData.mealType }
      };
    }

    // Sleep stage properties — populated from normalize_health_log.js's sleep block
    // (the parser extracts hours/deep/rem/core/awake from the entry title).
    if (entryData.category === "Sleep" && normalizedEntry?.sleep) {
      const s = normalizedEntry.sleep;
      if (s.hours !== null) notionBody.properties["Sleep Hours"] = { number: s.hours };
      if (s.deep  !== null) notionBody.properties["Deep"]        = { number: s.deep };
      if (s.rem   !== null) notionBody.properties["REM"]         = { number: s.rem };
      if (s.core  !== null) notionBody.properties["Core"]        = { number: s.core };
      if (s.awake !== null) notionBody.properties["Awake"]       = { number: s.awake };
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
      // SAFETY BRAKE (added 2026-05-19 after runaway-dupe incident):
      // If we've already created NOTION_CREATE_CAP pages this run, abort
      // instead of continuing — a legitimate run should create at most a
      // few brand-new pages per cron tick. More than that means something
      // is wrong (lookup failing across many entries) and we shouldn't keep
      // creating.
      const NOTION_CREATE_CAP = 5;
      if (metrics.notion_new >= NOTION_CREATE_CAP) {
        console.error(`  !! SAFETY BRAKE: ${metrics.notion_new} Notion pages already created this run — aborting before creating more. Investigate why Row Id + Entry Key lookups are missing legitimate pages.`);
        writeReceipt({
          status: 'error',
          summary: `Aborted at ${metrics.notion_new} Notion creates (safety brake) — Row Id/Entry Key lookups failing`,
          metrics
        });
        process.exit(2);
      }
      console.log("  -> Pushing to Notion...");
      const createdPage = await notionRequest("POST", "/pages", notionBody);
      metrics.notion_new++;
      if (photos[0]) photoSyncedToNotion = true;

      // Persist the new page_id to sync_state so future cycles find it
      // instead of creating another duplicate.
      if (createdPage?.id) {
        upsertEntry(syncState, nsEntryKey, {
          timestamp: entryData.iso,
          user: entryData.user,
          category: entryData.category,
          meal_type: entryData.mealType || '-',
          title: cleanText.slice(0, 200),
          photo_urls: photos,
          notion: {
            page_id: createdPage.id,
            last_synced_at: new Date().toISOString()
          }
        });
        saveSyncState(SYNC_STATE_PATH, syncState);
      }
    } else {
      const existing = activeResults[0];

      // Row Id is unique by construction; >1 match means something else wrote
      // a page with our Row Id (shouldn't happen). Log and use the first; the
      // orphan reconciler at end of run won't touch them since both have a
      // valid Row Id, but the warning surfaces the anomaly.
      if (activeResults.length > 1) {
        console.warn(`  !! DUP Row Id: ${activeResults.length} pages share Row Id ${rowId} — investigate. Using first: ${existing.id.slice(0,8)}`);
        metrics.notion_dup_row_ids = (metrics.notion_dup_row_ids || 0) + (activeResults.length - 1);
      }

      // Persist page_id to sync_state on every match (covers entries
      // created before this fix, or where sync_state was rebuilt).
      const syncEntry = (syncState.entries || {})[nsEntryKey];
      if (!syncEntry?.notion?.page_id || syncEntry.notion.page_id !== existing.id) {
        upsertEntry(syncState, nsEntryKey, {
          timestamp: entryData.iso,
          user: entryData.user,
          category: entryData.category,
          meal_type: entryData.mealType || '-',
          title: cleanText.slice(0, 200),
          photo_urls: photos,
          notion: {
            page_id: existing.id,
            last_synced_at: new Date().toISOString()
          }
        });
        saveSyncState(SYNC_STATE_PATH, syncState);
      }

      const existingTitle = existing.properties.Entry?.title[0]?.plain_text;
      const existingCarbs = existing.properties["Carbs (est)"]?.number;
      const existingPhoto = existing.properties.Photo?.url;

      if (existingTitle !== cleanText || existingCarbs !== entryData.carbs || existingPhoto !== (photos[0] || null)) {
        console.log("  -> Updating Notion...");
        delete notionBody.parent;
        await notionRequest("PATCH", `/pages/${existing.id}`, notionBody);
        metrics.notion_updated++;
        if (photos[0] && existingPhoto !== photos[0]) photoSyncedToNotion = true;
      } else {
        console.log("  -> Notion up to date.");
        metrics.notion_unchanged++;
      }
    }

    // 3. Sync to MySQL (paused)
    if (MYSQL_SYNC_ENABLED) {
      syncToMysql({ ...entryData, text: cleanText, photos });
    }
  }

  // 4. Row Id orphan reconciler (2026-05-19)
  //    Single rule: any non-archived Notion page in the 7-day window whose
  //    Row Id is NOT in the SSoT row-id set gets archived. Includes pages
  //    with no Row Id at all (legacy / unified_sync / other writers).
  //
  //    First-run grace: if the sentinel file doesn't exist, log candidates
  //    instead of archiving and write the sentinel. This lets us audit the
  //    initial candidate set before destructive action. Delete the sentinel
  //    file to re-enter grace mode.
  try {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);
    const allPages = [];
    let cursor = null;
    do {
      const r = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
        filter: { property: "Date", date: { on_or_after: sevenDaysAgo } },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {})
      });
      for (const p of (r.results || [])) {
        if (p.archived) continue;
        allPages.push(p);
      }
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);

    const candidates = [];
    for (const p of allPages) {
      const pageRowId = p.properties?.["Row Id"]?.rich_text?.[0]?.plain_text || "";
      if (!pageRowId || !recentRowIds.has(pageRowId)) {
        candidates.push({
          id: p.id,
          rowId: pageRowId,
          title: (p.properties?.Entry?.title?.[0]?.plain_text || "").slice(0, 60),
          date: p.properties?.Date?.date?.start || ""
        });
      }
    }

    const inGrace = !fs.existsSync(ROW_ID_GRACE_SENTINEL);
    if (inGrace) {
      console.warn(`  !! Row Id reconciler GRACE MODE: ${candidates.length} candidate(s) would be archived. Listing only — delete the sentinel file to re-enter grace mode in the future.`);
      for (const c of candidates) {
        console.warn(`     ${c.id.slice(0,8)} Row Id="${c.rowId || '(empty)'}" date=${c.date.slice(0,16)} title="${c.title}"`);
      }
      fs.writeFileSync(ROW_ID_GRACE_SENTINEL, JSON.stringify({
        initializedAt: new Date().toISOString(),
        firstRunCandidates: candidates,
        recentRowIdCount: recentRowIds.size
      }, null, 2));
      metrics.row_id_grace_candidates = candidates.length;
    } else {
      const ARCHIVE_CAP = 20;
      let archived = 0;
      for (const c of candidates) {
        if (archived >= ARCHIVE_CAP) {
          console.warn(`  !! Row Id reconciler capped at ${ARCHIVE_CAP} archives per run — investigate manually.`);
          break;
        }
        console.log(`  -> Row Id orphan archive: ${c.id.slice(0,8)} (Row Id="${c.rowId || '(empty)'}") "${c.title}"`);
        await notionRequest("PATCH", `/pages/${c.id}`, { archived: true });
        archived++;
      }
      if (archived > 0) {
        console.log(`  Row Id reconciler: archived ${archived} orphan page(s).`);
        metrics.notion_orphans_archived = archived;
      }
    }
  } catch (e) {
    console.warn(`  !! Row Id reconciler failed (non-fatal): ${e.message}`);
  }

  // 5. Update gallery when a photo was written to Notion this run
  if (photoSyncedToNotion) {
    try {
      console.log("  -> Photo synced to Notion — regenerating gallery...");
      execSync('/opt/homebrew/bin/node /Users/javier/.openclaw/workspace/scripts/generate_notion_gallery_data.js', { stdio: 'inherit' });
      // generate_notion_gallery_data.js now calls deploy_gh_pages.js internally
      console.log("  -> Gallery updated and deployed to gh-pages.");
      metrics.gallery_updated = 1;
    } catch (e) {
      console.error("Gallery update failed:", e.message);
      metrics.entry_errors++;
    }
  }

  console.log(`NS Telemetry: ${JSON.stringify(nsTelemetry)}`);
  console.log("Radial Sync Complete.");

  // --- Outcome receipt for cron dashboard ---
  // Fold NS telemetry into metrics so the dashboard has the full picture.
  Object.assign(metrics, {
    ns_fallback_matches: nsTelemetry.fallback_match_count || 0,
    ns_ambiguous_matches: nsTelemetry.ambiguous_match_count || 0,
    ns_verify_fails: nsTelemetry.verify_fail_count || 0
  });

  const totalErrors = metrics.ns_errors + metrics.entry_errors + metrics.ns_verify_fails;
  let status;
  if (totalErrors === 0) {
    status = metrics.processed === 0 ? 'noop' : 'ok';
  } else if (totalErrors >= metrics.processed && metrics.processed > 0) {
    status = 'error';
  } else {
    status = 'partial';
  }

  const summary =
    metrics.processed === 0
      ? `No entries needed sync (${metrics.skipped} already synced)`
      : `Synced ${metrics.processed} entries — NS: ${metrics.ns_ok} ok / ${metrics.ns_errors} err / ${metrics.ns_conflicts} conflict · ` +
        `Notion: ${metrics.notion_new} new / ${metrics.notion_updated} upd / ${metrics.notion_unchanged} unchanged` +
        (metrics.gallery_updated ? ' · gallery updated' : '');

  writeReceipt({ status, summary, metrics });
}

main().catch(err => {
  console.error(err);
  writeReceipt({
    status: 'error',
    summary: `Radial Sync crashed: ${err.message || err}`,
    metrics: null
  });
  process.exit(1);
});
