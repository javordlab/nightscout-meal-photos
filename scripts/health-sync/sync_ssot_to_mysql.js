#!/usr/bin/env node
// sync_ssot_to_mysql.js
//
// Sync the normalized SSoT (`data/health_log.normalized.json`) into the
// `health_ssot` MySQL database. Designed to be safe to re-run any time:
//   * Upsert by entry_key (PK).
//   * Soft-delete entries that disappeared from the SSoT (sets deleted_at,
//     never DROPs the row, so we keep a full historical record).
//   * Resurrects soft-deleted rows if they reappear (clears deleted_at).
//   * Records every run in `health_ssot.sync_runs`.
//
// This script is the canonical "SSoT → analytics DB" mirror. It does not
// touch Notion or Nightscout. It also does not depend on sync_state.json,
// so a corrupted sync_state cannot poison the table.
//
// Schema lives in init_health_ssot_db.sql. Run that once before this script.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const MYSQL_BIN = '/opt/homebrew/opt/mysql@8.4/bin/mysql';
const DB_NAME = 'health_ssot';

let writeReceipt = () => {};
try { ({ writeReceipt } = require('./cron_receipt')); } catch (_) {}

// ─── MySQL helpers ──────────────────────────────────────────────────────────

function mysqlRun(sql) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', DB_NAME, '-e', sql], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`mysql failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

// Stream rows in via STDIN as a single multi-statement batch. Faster + safer
// than building one giant -e arg (which can blow argv limits with 500+ rows).
function mysqlExec(sqlBatch) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', DB_NAME], { input: sqlBatch, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`mysql batch failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function esc(v) {
  if (v === null || v === undefined || v === '' || v === '-') return 'NULL';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function num(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function bool(v) { return v ? '1' : '0'; }

// ─── Field extraction ───────────────────────────────────────────────────────

// Predicted peak BG comes through as text like "144-154 mg/dL" or "180 mg/dL"
// or "175-190 mg/dL @ 12:03 PM". Extract a low/high pair when present.
function parsePredictedPeakBg(text) {
  if (!text) return [null, null];
  const range = text.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return [parseInt(range[1], 10), parseInt(range[2], 10)];
  const single = text.match(/(\d+)/);
  if (single) {
    const n = parseInt(single[1], 10);
    return [n, n];
  }
  return [null, null];
}

// "20:53 -07:00" -> tz "-07:00"
function extractTzOffset(time) {
  if (!time) return '';
  const m = time.match(/([+-]\d{2}:?\d{2})/);
  return m ? m[1] : '';
}

function buildRow(e) {
  const [bgLow, bgHigh] = parsePredictedPeakBg(e.predicted?.peakBgText);
  const a = e.actual || {};
  const s = e.sync || {};
  return {
    entry_key: e.entryKey,
    content_hash: e.contentHash || '',
    ts_iso: e.timestamp,
    event_date: e.date,
    event_time: e.time,
    tz_offset: extractTzOffset(e.time),
    user_name: e.user,
    category: e.category,
    meal_type: e.mealType && e.mealType !== '-' ? e.mealType : null,
    title: e.title || '',
    notes: e.notes,
    photo_urls: Array.isArray(e.photoUrls) ? JSON.stringify(e.photoUrls) : '[]',
    primary_photo_url: Array.isArray(e.photoUrls) && e.photoUrls.length > 0 ? e.photoUrls[0] : null,
    carbs_est: e.carbsEst,
    calories_est: e.caloriesEst,
    protein_est: e.proteinEst,
    predicted_peak_bg_text: e.predicted?.peakBgText,
    predicted_peak_time_text: e.predicted?.peakTimeText,
    predicted_peak_bg_low: bgLow,
    predicted_peak_bg_high: bgHigh,
    pre_meal_bg: a.preMealBg,
    peak_bg: a.peakBg,
    two_hour_peak_bg: a.twoHourPeakBg,
    peak_time: a.peakTime ? a.peakTime.replace('T', ' ').substring(0, 19) : null,
    bg_delta: a.bgDelta,
    time_to_peak_min: a.timeToPeakMin,
    peak_bg_delta: a.peakBgDelta,
    peak_time_delta_min: a.peakTimeDeltaMin,
    sync_ns: s.nightscout,
    sync_notion: s.notion,
    sync_gallery: s.gallery,
    outcomes_backfilled: s.outcomesBackfilled,
    source_file: e.source?.file,
    source_line: e.source?.line,
    raw_row: e.source?.rawRow
  };
}

function rowToValues(r) {
  return [
    esc(r.entry_key),
    esc(r.content_hash),
    esc(r.ts_iso),
    esc(r.event_date),
    esc(r.event_time),
    esc(r.tz_offset),
    esc(r.user_name),
    esc(r.category),
    esc(r.meal_type),
    esc(r.title),
    esc(r.notes),
    esc(r.photo_urls),
    esc(r.primary_photo_url),
    num(r.carbs_est),
    num(r.calories_est),
    num(r.protein_est),
    esc(r.predicted_peak_bg_text),
    esc(r.predicted_peak_time_text),
    num(r.predicted_peak_bg_low),
    num(r.predicted_peak_bg_high),
    num(r.pre_meal_bg),
    num(r.peak_bg),
    num(r.two_hour_peak_bg),
    esc(r.peak_time),
    num(r.bg_delta),
    num(r.time_to_peak_min),
    num(r.peak_bg_delta),
    num(r.peak_time_delta_min),
    esc(r.sync_ns),
    esc(r.sync_notion),
    esc(r.sync_gallery),
    bool(r.outcomes_backfilled),
    esc(r.source_file),
    num(r.source_line),
    esc(r.raw_row)
  ].join(', ');
}

const COLS = [
  'entry_key','content_hash','ts_iso','event_date','event_time','tz_offset','user_name',
  'category','meal_type','title','notes','photo_urls','primary_photo_url','carbs_est','calories_est','protein_est',
  'predicted_peak_bg_text','predicted_peak_time_text','predicted_peak_bg_low','predicted_peak_bg_high',
  'pre_meal_bg','peak_bg','two_hour_peak_bg','peak_time','bg_delta','time_to_peak_min',
  'peak_bg_delta','peak_time_delta_min','sync_ns','sync_notion','sync_gallery',
  'outcomes_backfilled','source_file','source_line','raw_row'
];

// All non-PK columns get refreshed on conflict, plus deleted_at is cleared
// (so a re-appearing entry is resurrected automatically).
const UPDATE_CLAUSE = COLS.filter(c => c !== 'entry_key')
  .map(c => `${c}=VALUES(${c})`)
  .concat(['deleted_at=NULL'])
  .join(', ');

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date();
  let runId = null;
  const metrics = { ssot_entries: 0, inserted: 0, updated: 0, unchanged: 0, soft_deleted: 0 };

  try {
    if (!fs.existsSync(NORMALIZED_PATH)) {
      throw new Error(`Normalized SSoT not found: ${NORMALIZED_PATH}. Run normalize_health_log.js first.`);
    }

    // Open a sync_runs row up front so partial failures are visible.
    // LAST_INSERT_ID() is per-connection, so the INSERT and SELECT must share
    // a single mysql invocation.
    const insertOut = mysqlRun(
      `INSERT INTO sync_runs (started_at, status) VALUES (NOW(), 'running'); SELECT LAST_INSERT_ID() AS id;`
    );
    runId = parseInt(insertOut.trim().split('\n').pop(), 10);
    if (!Number.isFinite(runId) || runId === 0) {
      throw new Error(`Failed to capture sync_runs id (got "${insertOut.trim()}")`);
    }

    const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
    const entries = normalized.entries || [];
    metrics.ssot_entries = entries.length;
    console.log(`Loaded ${entries.length} SSoT entries from ${NORMALIZED_PATH}`);

    // Build current state map (key -> content_hash) BEFORE writing, so we can
    // distinguish inserted/updated/unchanged for the metrics + tell what's
    // missing from the SSoT (for soft-delete).
    const existingHashes = new Map();
    const existingDeletedKeys = new Set();
    const existingRows = mysqlRun(
      `SELECT entry_key, content_hash, deleted_at IS NOT NULL AS is_deleted FROM health_log_entries`
    );
    const lines = existingRows.split('\n').slice(1); // skip header
    for (const line of lines) {
      if (!line.trim()) continue;
      const [key, hash, deleted] = line.split('\t');
      existingHashes.set(key, hash);
      if (deleted === '1') existingDeletedKeys.add(key);
    }
    console.log(`Existing rows in MySQL: ${existingHashes.size} (${existingDeletedKeys.size} soft-deleted)`);

    // Classify entries.
    const seenKeys = new Set();
    const toWrite = [];
    for (const e of entries) {
      if (!e.entryKey) continue;
      seenKeys.add(e.entryKey);
      const prev = existingHashes.get(e.entryKey);
      if (prev === undefined) {
        metrics.inserted++;
        toWrite.push(e);
      } else if (prev !== e.contentHash || existingDeletedKeys.has(e.entryKey)) {
        metrics.updated++;
        toWrite.push(e);
      } else {
        metrics.unchanged++;
      }
    }

    // Write in chunks to keep batch SQL under ~5MB.
    const CHUNK = 100;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK);
      const values = chunk.map(e => `(${rowToValues(buildRow(e))})`).join(',\n');
      const sql = `INSERT INTO health_log_entries (${COLS.join(', ')}) VALUES\n${values}\nON DUPLICATE KEY UPDATE ${UPDATE_CLAUSE};`;
      mysqlExec(sql);
    }
    if (toWrite.length) console.log(`Wrote ${toWrite.length} rows (${metrics.inserted} new + ${metrics.updated} updated)`);

    // Soft-delete: anything in MySQL but no longer in SSoT, and not already deleted.
    const toDelete = [];
    for (const key of existingHashes.keys()) {
      if (!seenKeys.has(key) && !existingDeletedKeys.has(key)) toDelete.push(key);
    }
    if (toDelete.length) {
      const list = toDelete.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
      mysqlRun(`UPDATE health_log_entries SET deleted_at=NOW() WHERE entry_key IN (${list})`);
      metrics.soft_deleted = toDelete.length;
      console.log(`Soft-deleted ${toDelete.length} entries no longer in SSoT`);
    }

    // Close out the run row.
    mysqlRun(
      `UPDATE sync_runs SET finished_at=NOW(), ssot_entries=${metrics.ssot_entries}, ` +
      `inserted=${metrics.inserted}, updated=${metrics.updated}, unchanged=${metrics.unchanged}, ` +
      `soft_deleted=${metrics.soft_deleted}, status='ok' WHERE id=${runId}`
    );

    const summary = `SSoT→MySQL: ${metrics.ssot_entries} entries — ${metrics.inserted} new / ${metrics.updated} updated / ${metrics.unchanged} unchanged / ${metrics.soft_deleted} soft-deleted`;
    console.log(summary);
    writeReceipt({ status: 'ok', summary, metrics });
    return 0;
  } catch (e) {
    console.error('SSoT→MySQL sync failed:', e.message);
    if (runId) {
      try {
        mysqlRun(
          `UPDATE sync_runs SET finished_at=NOW(), status='error', error=${esc(e.message)} WHERE id=${runId}`
        );
      } catch (_) {}
    }
    writeReceipt({ status: 'error', summary: `SSoT→MySQL sync failed: ${e.message}`, metrics });
    return 1;
  }
}

if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = { main };
