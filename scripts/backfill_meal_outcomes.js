#!/usr/bin/env node
// backfill_meal_outcomes.js
//
// Computes per-meal BG outcomes from Nightscout glucose data and writes them
// directly to `health_ssot.health_log_entries`. Replaces backfill_notion_impact.js
// (which round-tripped through Notion).
//
// Outcome columns owned by this script:
//   pre_meal_bg, peak_bg, two_hour_peak_bg, peak_time, bg_delta,
//   time_to_peak_min, peak_bg_delta, peak_time_delta_min, outcomes_backfilled
//
// Architecture note: sync_ssot_to_mysql.js explicitly excludes these columns
// from its UPDATE clause so SSoT syncs don't clobber outcomes.
//
// Run cadence: hourly via cron. Only touches Food entries 3-48h old that need
// backfill or a delta refresh.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { writeReceipt } = require('./health-sync/cron_receipt');
const { withDnsRetry } = require('./health-sync/net_retry');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET_HASH = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01'; // SHA1 of JaviCare2026
const MYSQL_BIN = '/opt/homebrew/opt/mysql@8.4/bin/mysql';
const DB_NAME = 'health_ssot';
const MYSQL_CHARSET_ARG = '--default-character-set=utf8mb4';
const NOTION_KEY = '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';
const SYNC_STATE_PATH = path.join(process.env.HOME, '.openclaw/workspace/data/sync_state.json');

// ─── Nightscout ────────────────────────────────────────────────────────────

async function fetchJson(url, headers = {}) {
  return withDnsRetry(() => new Promise((resolve, reject) => {
    const options = { headers: { 'api-secret': NS_SECRET_HASH, ...headers } };
    https.get(url, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`NS request failed (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(data || '[]')); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  }), { label: 'NS glucose fetch' });
}

function getBgAt(entries, mealTime) {
  const target = new Date(mealTime).getTime();
  let closest = null;
  let minDiff = 30 * 60 * 1000;  // 30-min window
  for (const e of entries) {
    const mills = e.date || e.mills;
    const diff = Math.abs(mills - target);
    if (diff < minDiff) { minDiff = diff; closest = e; }
  }
  return closest ? closest.sgv : null;
}

function getPeak3Hr(entries, mealTime) {
  const start = new Date(mealTime).getTime();
  const end = start + 3 * 60 * 60 * 1000;
  let peakBg = 0;
  let peakTimeMs = null;
  for (const e of entries) {
    const mills = e.date || e.mills;
    if (mills >= start && mills <= end && e.sgv > peakBg) {
      peakBg = e.sgv;
      peakTimeMs = mills;
    }
  }
  return {
    peakBg: peakBg || null,
    peakTime: peakTimeMs ? new Date(peakTimeMs).toISOString().slice(0, 19).replace('T', ' ') : null,
  };
}

// ─── Notion (best-effort mirror) ───────────────────────────────────────────
//
// MySQL is the canonical source for outcomes. Notion writes are a mirror kept
// in sync for parity with the legacy view — failures here are logged but do
// not affect MySQL writes or the script's exit status.

function notionPatch(pageId, properties) {
  return new Promise(resolve => {
    const data = JSON.stringify({ properties });
    const req = https.request({
      hostname: 'api.notion.com', port: 443, path: `/v1/pages/${pageId}`,
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', err => resolve({ status: 0, error: err.message }));
    req.write(data);
    req.end();
  });
}

function buildPageIdLookup() {
  // sync_state.json may have multiple entry_key records pointing at the same
  // page_id (due to historical hash drift). Build a forward map: entry_key → page_id,
  // plus a drift-robust fallback: entry keys drift on title edits, so when the
  // direct lookup misses, match sync_state records by (timestamp, user, category)
  // and prefer one that actually carries a page_id (the first match is often a
  // stale drift record without IDs).
  let stateEntries = {};
  try {
    stateEntries = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8')).entries || {};
  } catch (e) {
    console.warn('Could not load sync_state.json:', e.message);
  }
  const direct = new Map();
  for (const [k, v] of Object.entries(stateEntries)) {
    const pid = v.notion && v.notion.page_id;
    if (pid) direct.set(k, pid);
  }
  const records = Object.values(stateEntries);
  const lookup = (entryKey, row) => {
    const hit = direct.get(entryKey);
    if (hit) return hit;
    if (!row || !row.ts_iso) return null;
    const match = records
      .filter(r => r.timestamp === row.ts_iso && r.user === row.user_name && r.category === row.category)
      .find(r => r.notion && r.notion.page_id);
    return match ? match.notion.page_id : null;
  };
  lookup.size = direct.size;
  return lookup;
}

function fieldsToNotionProperties(fields) {
  const props = {};
  if ('pre_meal_bg' in fields)         props['Pre-Meal BG']           = { number: fields.pre_meal_bg };
  if ('two_hour_peak_bg' in fields)    props['2hr Peak BG']           = { number: fields.two_hour_peak_bg };
  if ('bg_delta' in fields)            props['BG Delta']              = { number: fields.bg_delta };
  if ('peak_time' in fields && fields.peak_time) {
    // health_log_entries.peak_time is "YYYY-MM-DD HH:MM:SS" (UTC from Nightscout)
    props['Peak Time'] = { date: { start: fields.peak_time.replace(' ', 'T') + '.000Z' } };
  }
  if ('time_to_peak_min' in fields)    props['Time to Peak (min)']    = { number: fields.time_to_peak_min };
  if ('peak_bg_delta' in fields)       props['Peak BG Delta']         = { number: fields.peak_bg_delta };
  if ('peak_time_delta_min' in fields) props['Peak Time Delta (min)'] = { number: fields.peak_time_delta_min };
  return props;
}

// ─── MySQL ─────────────────────────────────────────────────────────────────

function mysqlQuery(sql) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', MYSQL_CHARSET_ARG, DB_NAME, '-N', '-B', '-e', sql], { encoding: 'utf8' });
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
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  const t0 = Date.now();
  const metrics = {
    candidates: 0,
    too_recent: 0,
    no_glucose: 0,
    peak_backfilled: 0,
    variance_calculated: 0,
    already_current: 0,
    updated: 0,
    notion_mirrored: 0,
    notion_skipped_no_page_id: 0,
    notion_errors: 0,
    errors: 0,
  };

  // Single 48h cutoff in ms, shared by the NS fetch and the row filter so both
  // sides of the windowed comparison use the same precision.
  const cutoffMs = Date.now() - 48 * 60 * 60 * 1000;

  // Date-bounded NS fetch with generous headroom (count=576 was exactly 48h of
  // 5-min readings — zero margin, silently truncated if cadence densifies).
  const nsEntries = await fetchJson(`${NS_URL}/api/v1/entries.json?find[date][$gte]=${cutoffMs}&count=5000`);
  console.log(`Fetched ${nsEntries.length} NS entries`);

  const lookupPageId = buildPageIdLookup();
  console.log(`Loaded ${lookupPageId.size} entry_key → page_id mappings from sync_state`);

  // Pull Food entries from the last 48h that need outcome work.
  // ts_iso is the canonical SSoT timestamp (e.g. "2026-05-21T11:10:00+02:00").
  // The SQL event_date filter is only a coarse prefilter (local date-string with
  // a day of slack); the exact window is applied below on ts_iso in ms.
  const coarseSince = new Date(cutoffMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = mysqlQuery(`
    SELECT entry_key, ts_iso, title,
           pre_meal_bg, peak_bg, two_hour_peak_bg, peak_time, bg_delta, time_to_peak_min,
           predicted_peak_bg_low, predicted_peak_bg_high, predicted_peak_time_text,
           peak_bg_delta, peak_time_delta_min, user_name, category
    FROM health_log_entries
    WHERE category='Food'
      AND deleted_at IS NULL
      AND event_date >= '${coarseSince}'
    ORDER BY ts_iso DESC;
  `).trim().split('\n').filter(Boolean).map(line => {
    const c = line.split('\t').map(v => v === 'NULL' ? null : v);
    return {
      entry_key: c[0], ts_iso: c[1], title: c[2],
      pre_meal_bg: c[3] != null ? Number(c[3]) : null,
      peak_bg: c[4] != null ? Number(c[4]) : null,
      two_hour_peak_bg: c[5] != null ? Number(c[5]) : null,
      peak_time: c[6],
      bg_delta: c[7] != null ? Number(c[7]) : null,
      time_to_peak_min: c[8] != null ? Number(c[8]) : null,
      predicted_peak_bg_low: c[9] != null ? Number(c[9]) : null,
      predicted_peak_bg_high: c[10] != null ? Number(c[10]) : null,
      predicted_peak_time_text: c[11],
      peak_bg_delta: c[12] != null ? Number(c[12]) : null,
      peak_time_delta_min: c[13] != null ? Number(c[13]) : null,
      user_name: c[14],
      category: c[15],
    };
  }).filter(r => {
    const t = new Date(r.ts_iso).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });
  metrics.candidates = rows.length;
  console.log(`Considering ${rows.length} Food entries in the last 48h`);

  const updates = [];  // { entry_key, fields: {...} }
  const now = Date.now();

  for (const row of rows) {
    const mealMs = new Date(row.ts_iso).getTime();
    const ageHours = (now - mealMs) / 3_600_000;
    if (ageHours < 3) { metrics.too_recent++; continue; }

    const fields = {};

    // 1. Backfill peak data if missing
    let peakBg = row.two_hour_peak_bg ?? row.peak_bg;
    let preBg = row.pre_meal_bg;
    let peakTimeStr = row.peak_time;
    if (peakBg == null || preBg == null) {
      const pb = getBgAt(nsEntries, row.ts_iso);
      const { peakBg: pkBg, peakTime: pkTime } = getPeak3Hr(nsEntries, row.ts_iso);
      if (pb != null && pkBg != null && pkTime) {
        preBg = pb; peakBg = pkBg; peakTimeStr = pkTime;
        const delta = pkBg - pb;
        // pkTime is "YYYY-MM-DD HH:MM:SS" in UTC (sliced from toISOString) —
        // parse explicitly as UTC. Without the 'Z' it's read as HOST-local
        // time, skewing time_to_peak_min by the UTC offset (all stored values
        // before 2026-07-23 carry this skew; the delta block below already
        // parsed correctly).
        const timeToPeak = Math.round((new Date(pkTime.replace(' ', 'T') + 'Z').getTime() - mealMs) / 60_000);
        Object.assign(fields, {
          pre_meal_bg: preBg,
          peak_bg: peakBg,
          two_hour_peak_bg: peakBg,
          bg_delta: delta,
          peak_time: peakTimeStr,
          time_to_peak_min: timeToPeak,
        });
        metrics.peak_backfilled++;
      } else {
        metrics.no_glucose++;
        continue;
      }
    }

    // 2. Variance vs prediction
    // Notion historically used the high end of the SSoT range as "Predicted Peak BG".
    const predBg = row.predicted_peak_bg_high;
    if (predBg != null && peakBg != null) {
      const bgVar = peakBg - predBg;
      let timeVar = null;
      if (peakTimeStr && row.predicted_peak_time_text) {
        // predicted_peak_time_text is a string like "10:25 PM" — parse to today's date.
        const m = String(row.predicted_peak_time_text).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (m) {
          const mealDate = new Date(mealMs);
          let h = Number(m[1]);
          const mm = Number(m[2]);
          if (m[3]) {
            const ap = m[3].toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
          }
          const predTime = new Date(mealDate);
          predTime.setHours(h, mm, 0, 0);
          // If predicted peak time was before the meal, push to next day
          if (predTime.getTime() < mealMs) predTime.setDate(predTime.getDate() + 1);
          // peak_time is stored as "YYYY-MM-DD HH:MM:SS" — always UTC, since
          // we wrote it from new Date(ms).toISOString().slice(0,19). Parse
          // explicitly as UTC; without the 'Z', JS treats it as local time
          // and the variance comes out skewed by the system's UTC offset.
          const peakDate = new Date(peakTimeStr.replace(' ', 'T') + 'Z');
          timeVar = Math.round((peakDate.getTime() - predTime.getTime()) / 60_000);
        }
      }
      const bgChanged = row.peak_bg_delta !== bgVar;
      const timeChanged = timeVar != null && row.peak_time_delta_min !== timeVar;
      if (bgChanged) { fields.peak_bg_delta = bgVar; metrics.variance_calculated++; }
      if (timeChanged) fields.peak_time_delta_min = timeVar;
    }

    if (Object.keys(fields).length === 0) {
      metrics.already_current++;
      continue;
    }
    fields.outcomes_backfilled = 1;
    updates.push({ entry_key: row.entry_key, row, fields });
  }

  if (updates.length > 0) {
    const buildStmt = u => {
      const setClause = Object.entries(u.fields).map(([k, v]) => `${k}=${esc(v)}`).join(', ');
      return `UPDATE health_log_entries SET ${setClause} WHERE entry_key=${esc(u.entry_key)};`;
    };

    // Write in chunks; if a chunk's batch fails (one bad statement aborts the
    // rest of the batch — the exact May-26 freeze pattern), retry that chunk
    // one row at a time so a single bad row only loses itself.
    const CHUNK = 100;
    const failedKeys = new Set();
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      try {
        mysqlExec(chunk.map(buildStmt).join('\n'));
        metrics.updated += chunk.length;
      } catch (batchErr) {
        for (const u of chunk) {
          try {
            mysqlExec(buildStmt(u));
            metrics.updated++;
          } catch (rowErr) {
            metrics.errors++;
            failedKeys.add(u.entry_key);
            const msg = (rowErr.message || '').replace(/\s+/g, ' ').slice(0, 200);
            console.error(`  ✗ skipped ${String(u.entry_key).slice(0, 20)}: ${msg}`);
          }
        }
      }
    }
    console.log(`Wrote ${metrics.updated}/${updates.length} outcome updates to MySQL` +
      (metrics.errors ? ` (${metrics.errors} failed)` : ''));

    // Best-effort Notion mirror — failures don't affect MySQL writes.
    // Rows that failed the MySQL write are not mirrored (MySQL is canonical).
    for (const u of updates) {
      if (failedKeys.has(u.entry_key)) continue;
      const pageId = lookupPageId(u.entry_key, u.row);
      if (!pageId) { metrics.notion_skipped_no_page_id++; continue; }
      const props = fieldsToNotionProperties(u.fields);
      if (Object.keys(props).length === 0) continue;
      const res = await notionPatch(pageId, props);
      if (res.status === 200) {
        metrics.notion_mirrored++;
      } else {
        metrics.notion_errors++;
        if (metrics.notion_errors <= 3) {
          console.warn(`  !! Notion PATCH ${pageId.slice(0, 8)} status=${res.status} ${String(res.body || res.error).slice(0, 140)}`);
        }
      }
    }
    console.log(`Mirrored ${metrics.notion_mirrored}/${updates.length} to Notion (skipped ${metrics.notion_skipped_no_page_id} no-page-id, ${metrics.notion_errors} errors)`);
  }

  const totalMs = Date.now() - t0;
  console.log(`Done in ${(totalMs / 1000).toFixed(1)}s — ` +
    `${metrics.candidates} candidates / ${metrics.too_recent} too recent / ` +
    `${metrics.peak_backfilled} peak backfilled / ${metrics.variance_calculated} variance / ` +
    `${metrics.already_current} already current / ${metrics.no_glucose} no NS data`);

  let status;
  if (metrics.errors > 0) status = metrics.errors >= metrics.updated ? 'error' : 'partial';
  else if (nsEntries.length === 0 && metrics.candidates > 0) status = 'warn';
  else if (metrics.updated === 0 && metrics.candidates === 0) status = 'noop';
  else status = 'ok';
  const summary =
    `Reviewed ${metrics.candidates} food entries — ` +
    `${metrics.updated} MySQL updates (${metrics.peak_backfilled} peak backfill, ${metrics.variance_calculated} variance), ` +
    `${metrics.notion_mirrored} Notion mirrored, ` +
    `${metrics.already_current} already current, ${metrics.too_recent} too recent` +
    (metrics.errors > 0 ? `, ${metrics.errors} MySQL row failures` : '') +
    (nsEntries.length === 0 && metrics.candidates > 0 ? ' — NS returned 0 entries (outage?)' : '') +
    (metrics.notion_errors > 0 ? `, ${metrics.notion_errors} Notion errors` : '');
  writeReceipt({ status, summary, metrics });
}

run().catch(e => {
  console.error(e);
  writeReceipt({ status: 'error', summary: `Meal outcomes backfill crashed: ${e.message || e}`, metrics: null });
  process.exit(1);
});
