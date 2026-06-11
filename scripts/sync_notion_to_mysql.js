#!/usr/bin/env node
// sync_notion_to_mysql.js
//
// Mirrors the Notion health log database into MySQL `health_monitor.maria_health_log`.
// The table is the source of analytic OUTCOMES (Pre-Meal BG, 2hr Peak BG, BG Delta,
// Peak Time, etc.) which only exist in Notion because backfill_notion_impact.js
// writes them there ~3h post-meal.
//
// Performance: previous version spawned a `mysql` CLI process per row (~1700 rows
// × ~30ms = ~51s). This version:
//   1. Fetches all Notion pages once
//   2. SELECTs existing rows from MySQL to compute a delta hash
//   3. Issues a SINGLE batched INSERT ... ON DUPLICATE KEY UPDATE per chunk via
//      mysql STDIN multi-statement input.
// Typical no-op runtime: ~3-5 seconds (Notion pagination dominates).
//
// Also passes --default-character-set=utf8mb4 so UTF-8 entries (jamón, ·, emoji)
// are stored correctly instead of double-encoded.

const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const path = require('path');

function expandHomeDir(p) {
  if (p.startsWith('~')) return path.join(process.env.HOME, p.slice(1));
  return p;
}

const NOTION_KEY = fs.readFileSync(expandHomeDir('~/.config/notion/api_key'), 'utf8').trim();
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const MYSQL_BIN = '/opt/homebrew/opt/mysql@8.4/bin/mysql';
const DB_NAME = 'health_monitor';
const MYSQL_CHARSET_ARG = '--default-character-set=utf8mb4';

let writeReceipt = () => {};
try { ({ writeReceipt } = require('./health-sync/cron_receipt')); } catch (_) {}

// ─── Notion ────────────────────────────────────────────────────────────────

function notionRequest(method, endpoint, body = null) {
  const url = `https://api.notion.com/v1${endpoint}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(url, opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); }
        catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── MySQL helpers ─────────────────────────────────────────────────────────

function mysqlRun(sql) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', MYSQL_CHARSET_ARG, DB_NAME, '-e', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

function mysqlExec(sqlBatch) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', MYSQL_CHARSET_ARG, DB_NAME], { input: sqlBatch, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql batch failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

// ─── Row extraction ────────────────────────────────────────────────────────

function pageToRow(page) {
  const p = page.properties;
  let mealType = p['Meal Type']?.select?.name || null;
  if (mealType === '-' || mealType === 'None') mealType = null;

  const dateStr = (s) => s ? s.replace('T', ' ').substring(0, 19) : null;

  // entry_title column is VARCHAR(255). Full titles live in health_log_entries
  // (TEXT column) — this analytics table only needs a short identifier.
  const rawTitle = (p.Entry?.title?.[0]?.plain_text) || 'Untitled';
  return {
    notion_id: page.id,
    entry_title: rawTitle.length > 250 ? rawTitle.slice(0, 247) + '...' : rawTitle,
    event_date: dateStr(p.Date?.date?.start),
    user_name: p.User?.select?.name || 'Maria Dennis',
    category: p.Category?.select?.name || 'Food',
    meal_type: mealType,
    carbs_est: p['Carbs (est)']?.number ?? null,
    calories_est: p['Calories (est)']?.number ?? null,
    photo_url: p.Photo?.url || null,
    pre_meal_bg: p['Pre-Meal BG']?.number ?? null,
    peak_bg_2hr: p['2hr Peak BG']?.number ?? null,
    bg_delta: p['BG Delta']?.number ?? null,
    peak_time: dateStr(p['Peak Time']?.date?.start),
    time_to_peak_min: p['Time to Peak (min)']?.number ?? null,
    predicted_peak_bg: p['Predicted Peak BG']?.number ?? null,
    predicted_peak_time: dateStr(p['Predicted Peak Time']?.date?.start),
    peak_bg_delta: p['Peak BG Delta']?.number ?? null,
    peak_time_delta_min: p['Peak Time Delta (min)']?.number ?? null,
  };
}

const COLS = [
  'notion_id','entry_title','event_date','user_name','category','meal_type',
  'carbs_est','calories_est','photo_url',
  'pre_meal_bg','peak_bg_2hr','bg_delta','peak_time','time_to_peak_min',
  'predicted_peak_bg','predicted_peak_time','peak_bg_delta','peak_time_delta_min'
];

function rowHash(row) {
  // Hash everything but notion_id to detect content changes.
  const payload = COLS.filter(c => c !== 'notion_id').map(c => String(row[c] ?? '')).join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function rowToValues(row) {
  return COLS.map(c => esc(row[c])).join(', ');
}

// ─── Main ──────────────────────────────────────────────────────────────────

// State file tracks last successful sync timestamp for incremental mode.
const STATE_FILE = path.join(process.env.HOME, '.openclaw/workspace/data/sync_notion_to_mysql_state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { console.warn('state save failed:', e.message); }
}

async function main() {
  const t0 = Date.now();
  const fullSync = process.argv.includes('--full');
  const state = loadState();
  const lastSyncAt = state.lastSyncAt;
  // Use incremental mode (filter by last_edited_time) when we have a prior
  // sync timestamp and not explicitly asked for full. Overlap by 5 minutes
  // to catch any clock-skew edge cases.
  const useIncremental = lastSyncAt && !fullSync;
  const sinceFilter = useIncremental ? new Date(new Date(lastSyncAt).getTime() - 5 * 60 * 1000).toISOString() : null;
  console.log(`Starting Notion → MySQL sync (${useIncremental ? 'incremental since ' + sinceFilter : 'full'})...`);

  // 1. Fetch Notion pages — all OR only those edited since last sync
  const rawRows = [];
  let cursor;
  let pages = 0;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    if (sinceFilter) body.filter = { timestamp: 'last_edited_time', last_edited_time: { on_or_after: sinceFilter } };
    const res = await notionRequest('POST', `/databases/${NOTION_DB_ID}/query`, body);
    if (!res.results) throw new Error('Notion query failed: ' + JSON.stringify(res).slice(0, 300));
    for (const page of res.results) {
      if (page.archived) continue;
      const row = pageToRow(page);
      row._last_edited = page.last_edited_time;
      rawRows.push(row);
    }
    cursor = res.has_more ? res.next_cursor : null;
    pages++;
  } while (cursor);
  console.log(`Fetched ${rawRows.length} live Notion pages in ${pages} request(s) (${Date.now() - t0}ms)`);

  // For incremental runs with no changes, we can exit early.
  if (rawRows.length === 0) {
    saveState({ lastSyncAt: new Date().toISOString() });
    console.log('No pages changed since last sync. Done.');
    writeReceipt({ status: 'noop', summary: 'Notion → MySQL: no changes since last sync', metrics: { pages: 0, ms: Date.now() - t0 } });
    return;
  }

  // Dedupe by the table's unique key (event_date, entry_title) — Notion may
  // still have residual duplicates from older dedup bugs. Keep the most
  // recently edited copy; the others are harmless and stale.
  const dedupMap = new Map();
  for (const r of rawRows) {
    const key = `${r.event_date || ''}|${r.entry_title}`;
    const prev = dedupMap.get(key);
    if (!prev || r._last_edited > prev._last_edited) dedupMap.set(key, r);
  }
  const rows = [...dedupMap.values()];
  for (const r of rows) delete r._last_edited;
  const droppedDupes = rawRows.length - rows.length;
  if (droppedDupes > 0) console.log(`Deduped: dropped ${droppedDupes} duplicate (date,title) Notion pages`);

  // 2. Build existing-hash map from MySQL
  const existing = mysqlRun(
    `SELECT notion_id, SHA2(CONCAT_WS('|',
      COALESCE(entry_title,''), COALESCE(event_date,''), COALESCE(user_name,''),
      COALESCE(category,''), COALESCE(meal_type,''),
      COALESCE(carbs_est,''), COALESCE(calories_est,''), COALESCE(photo_url,''),
      COALESCE(pre_meal_bg,''), COALESCE(peak_bg_2hr,''), COALESCE(bg_delta,''),
      COALESCE(peak_time,''), COALESCE(time_to_peak_min,''),
      COALESCE(predicted_peak_bg,''), COALESCE(predicted_peak_time,''),
      COALESCE(peak_bg_delta,''), COALESCE(peak_time_delta_min,'')
    ), 256) AS h FROM maria_health_log;`
  );
  const existingHashes = new Map();
  for (const line of existing.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [id, h] = line.split('\t');
    existingHashes.set(id, h.slice(0, 16));
  }
  console.log(`MySQL has ${existingHashes.size} existing rows`);

  // 3. Compute delta
  const toWrite = [];
  let unchanged = 0, inserted = 0, updated = 0;
  for (const row of rows) {
    const prev = existingHashes.get(row.notion_id);
    const next = rowHash(row);
    if (prev === undefined) { inserted++; toWrite.push(row); }
    else if (prev !== next) { updated++; toWrite.push(row); }
    else { unchanged++; }
  }
  console.log(`Delta: ${inserted} new + ${updated} changed + ${unchanged} unchanged`);

  // 4. Batch write
  if (toWrite.length > 0) {
    const updateClause = COLS.filter(c => c !== 'notion_id').map(c => `${c}=VALUES(${c})`).join(', ');
    const CHUNK = 100;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK);
      const values = chunk.map(r => `(${rowToValues(r)})`).join(',\n');
      const sql = `INSERT INTO maria_health_log (${COLS.join(', ')}) VALUES\n${values}\nON DUPLICATE KEY UPDATE ${updateClause};`;
      mysqlExec(sql);
    }
    console.log(`Wrote ${toWrite.length} rows in ${Math.ceil(toWrite.length / CHUNK)} batch(es)`);
  }

  saveState({ lastSyncAt: new Date().toISOString() });

  const totalMs = Date.now() - t0;
  console.log(`Sync complete in ${(totalMs / 1000).toFixed(1)}s — ${rows.length} pages / ${inserted} new / ${updated} updated / ${unchanged} unchanged`);

  writeReceipt({
    status: 'ok',
    summary: `Notion → MySQL synced ${rows.length} pages (${inserted} new / ${updated} updated / ${unchanged} unchanged) in ${(totalMs / 1000).toFixed(1)}s`,
    metrics: { pages: rows.length, inserted, updated, unchanged, ms: totalMs }
  });
}

main().catch(err => {
  console.error(err);
  writeReceipt({ status: 'error', summary: `Notion → MySQL sync failed: ${err.message || err}`, metrics: null });
  process.exit(1);
});
