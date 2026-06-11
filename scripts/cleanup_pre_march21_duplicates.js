#!/usr/bin/env node
//
// One-time cleanup script: archive duplicate Notion pages on or before 2026-03-21,
// remove duplicate MySQL rows (both health_ssot and health_monitor), and backfill
// missing nightscout.treatment_id in sync_state.json.
//
// Usage:
//   node scripts/cleanup_pre_march21_duplicates.js              # dry-run (default)
//   node scripts/cleanup_pre_march21_duplicates.js --commit     # actually mutate
//
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const DRY_RUN = !process.argv.includes('--commit');
const CUTOFF_DATE = '2026-03-22'; // on_or_before 2026-03-21

const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const MYSQL_BIN = '/opt/homebrew/opt/mysql@8.4/bin/mysql';
const NIGHTSCOUT_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const SYNC_STATE_PATH = path.join(__dirname, '../data/sync_state.json');
const WORKSPACE = path.join(__dirname, '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function notionRequest(method, endpoint, body = null) {
  const url = `https://api.notion.com/v1${endpoint}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function nsGet(path) {
  const url = `${NIGHTSCOUT_URL}/api/v1${path}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'api-secret': NS_SECRET } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '[]')); } catch { resolve([]); }
      });
    }).on('error', reject);
  });
}

function mysqlRun(db, sql) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', db, '-e', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function mysqlExec(db, sqlBatch) {
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', db], { input: sqlBatch, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql batch failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Phase 1: Notion duplicate cleanup ───────────────────────────────────────

async function cleanupNotion() {
  console.log('\n═══ Phase 1: Notion duplicate cleanup ═══');

  // Fetch all non-archived pages on or before cutoff
  const allPages = [];
  let cursor = null;
  let fetchBatch = 0;
  do {
    const r = await notionRequest('POST', `/databases/${NOTION_DB_ID}/query`, {
      filter: { property: 'Date', date: { before: CUTOFF_DATE } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of (r.results || [])) {
      if (!p.archived) allPages.push(p);
    }
    cursor = r.has_more ? r.next_cursor : null;
    fetchBatch++;
    if (fetchBatch % 5 === 0) console.log(`  fetched ${allPages.length} pages so far...`);
  } while (cursor);

  console.log(`  Total non-archived pages before ${CUTOFF_DATE}: ${allPages.length}`);

  // Group by composite key: date(ISO)|user|category
  // Use timestamp rounded to the minute for grouping
  const groups = new Map();
  for (const p of allPages) {
    const dateStart = p.properties?.Date?.date?.start || '';
    const user = p.properties?.User?.select?.name || '';
    const cat = p.properties?.Category?.select?.name || '';
    // Normalize date to minute precision for grouping
    const dt = new Date(dateStart);
    const dateKey = isNaN(dt.getTime()) ? dateStart : dt.toISOString().slice(0, 16);
    const key = `${dateKey}|${user}|${cat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let totalToArchive = 0;
  let groupsWithDupes = 0;
  const archiveIds = [];

  for (const [key, pages] of groups.entries()) {
    if (pages.length < 2) continue;
    groupsWithDupes++;

    // Pick canonical: prefer the one with an Entry Key, or the oldest (first created)
    pages.sort((a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());

    // Prefer a page that has an entry_key matching sync_state
    let canonical = pages.find(p =>
      (p.properties?.['Entry Key']?.rich_text?.[0]?.plain_text || '').startsWith('sha256:')
    ) || pages[0];

    const dupes = pages.filter(p => p.id !== canonical.id);
    for (const d of dupes) {
      archiveIds.push(d.id);
    }
    totalToArchive += dupes.length;
  }

  console.log(`  Groups with duplicates: ${groupsWithDupes}`);
  console.log(`  Pages to archive: ${totalToArchive}`);
  console.log(`  Pages to keep: ${allPages.length - totalToArchive}`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would archive these pages. Run with --commit to execute.');
    return { archived: 0, wouldArchive: totalToArchive };
  }

  // Archive in batches with rate-limit awareness
  let archived = 0;
  for (let i = 0; i < archiveIds.length; i++) {
    const id = archiveIds[i];
    try {
      await notionRequest('PATCH', `/pages/${id}`, { archived: true });
      archived++;
      if (archived % 50 === 0) {
        console.log(`  archived ${archived}/${archiveIds.length}...`);
        await sleep(1000); // respect Notion rate limits
      } else if (archived % 3 === 0) {
        await sleep(350); // ~3 req/sec
      }
    } catch (err) {
      console.error(`  !! Failed to archive ${id}: ${err.message}`);
    }
  }

  console.log(`  Archived ${archived} duplicate Notion pages.`);
  return { archived };
}

// ─── Phase 2: MySQL health_ssot dedup ────────────────────────────────────────

async function cleanupMysqlSsot() {
  console.log('\n═══ Phase 2: MySQL health_ssot dedup ═══');

  // The health_ssot table is keyed by entry_key (SHA256). Duplicates here
  // would mean rows with different entry_keys but same logical entry
  // (same timestamp + user + category). Find them.
  const sql = `
    SELECT entry_key, ts_iso, user_name, category, meal_type, title,
           first_seen_at
    FROM health_log_entries
    WHERE event_date < '${CUTOFF_DATE}'
      AND deleted_at IS NULL
    ORDER BY ts_iso, user_name, category, first_seen_at;
  `;
  const raw = mysqlRun('health_ssot', sql);
  const rows = raw.trim().split('\n').slice(1).map(line => {
    const cols = line.split('\t');
    return {
      entry_key: cols[0],
      ts_iso: cols[1],
      user_name: cols[2],
      category: cols[3],
      meal_type: cols[4],
      title: cols[5],
      first_seen_at: cols[6],
    };
  });

  console.log(`  Total rows before ${CUTOFF_DATE}: ${rows.length}`);

  // Group by normalized timestamp (minute precision) + user + category
  const groups = new Map();
  for (const r of rows) {
    const dt = new Date(r.ts_iso);
    const dateKey = isNaN(dt.getTime()) ? r.ts_iso : dt.toISOString().slice(0, 16);
    const key = `${dateKey}|${r.user_name}|${r.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  let dupeCount = 0;
  const softDeleteKeys = [];
  for (const [key, entries] of groups.entries()) {
    if (entries.length < 2) continue;
    // Keep the oldest (first_seen_at), soft-delete the rest
    entries.sort((a, b) => new Date(a.first_seen_at).getTime() - new Date(b.first_seen_at).getTime());
    for (let i = 1; i < entries.length; i++) {
      softDeleteKeys.push(entries[i].entry_key);
      dupeCount++;
    }
  }

  console.log(`  Duplicate rows to soft-delete: ${dupeCount}`);

  if (dupeCount === 0) {
    console.log('  No duplicates found in health_ssot.');
    return { deleted: 0 };
  }

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would soft-delete these rows. Run with --commit to execute.');
    return { deleted: 0, wouldDelete: dupeCount };
  }

  // Soft-delete in batches of 200
  let deleted = 0;
  for (let i = 0; i < softDeleteKeys.length; i += 200) {
    const batch = softDeleteKeys.slice(i, i + 200);
    const list = batch.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
    mysqlRun('health_ssot', `UPDATE health_log_entries SET deleted_at=NOW() WHERE entry_key IN (${list}) AND deleted_at IS NULL`);
    deleted += batch.length;
    console.log(`  soft-deleted ${deleted}/${softDeleteKeys.length}...`);
  }

  console.log(`  Soft-deleted ${deleted} duplicate rows from health_ssot.`);
  return { deleted };
}

// ─── Phase 3: MySQL health_monitor dedup ─────────────────────────────────────

async function cleanupMysqlMonitor() {
  console.log('\n═══ Phase 3: MySQL health_monitor dedup ═══');

  // health_monitor.maria_health_log is keyed by notion_id.
  // Duplicate Notion pages → duplicate rows here (different notion_id, same entry).
  // After Notion cleanup, orphaned notion_ids should be removed.
  const sql = `
    SELECT notion_id, entry_title, event_date, user_name, category, meal_type
    FROM maria_health_log
    WHERE event_date < '${CUTOFF_DATE}'
    ORDER BY event_date, user_name, category;
  `;

  let raw;
  try {
    raw = mysqlRun('health_monitor', sql);
  } catch (err) {
    console.log(`  health_monitor.maria_health_log not found or empty — skipping. (${err.message})`);
    return { deleted: 0 };
  }

  const lines = raw.trim().split('\n').slice(1);
  if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) {
    console.log('  No rows found in health_monitor before cutoff.');
    return { deleted: 0 };
  }

  const rows = lines.map(line => {
    const cols = line.split('\t');
    return {
      notion_id: cols[0],
      entry_title: cols[1],
      event_date: cols[2],
      user_name: cols[3],
      category: cols[4],
      meal_type: cols[5],
    };
  });

  console.log(`  Total rows before ${CUTOFF_DATE}: ${rows.length}`);

  // Group by event_date + user + category + meal_type
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.event_date}|${r.user_name}|${r.category}|${r.meal_type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const deleteIds = [];
  for (const [key, entries] of groups.entries()) {
    if (entries.length < 2) continue;
    // Keep the first, delete the rest
    for (let i = 1; i < entries.length; i++) {
      deleteIds.push(entries[i].notion_id);
    }
  }

  console.log(`  Duplicate rows to delete: ${deleteIds.length}`);

  if (deleteIds.length === 0) {
    console.log('  No duplicates found in health_monitor.');
    return { deleted: 0 };
  }

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would delete these rows. Run with --commit to execute.');
    return { deleted: 0, wouldDelete: deleteIds.length };
  }

  // Delete in batches of 200
  let deleted = 0;
  for (let i = 0; i < deleteIds.length; i += 200) {
    const batch = deleteIds.slice(i, i + 200);
    const list = batch.map(k => `'${k.replace(/'/g, "''")}'`).join(',');
    mysqlRun('health_monitor', `DELETE FROM maria_health_log WHERE notion_id IN (${list})`);
    deleted += batch.length;
    console.log(`  deleted ${deleted}/${deleteIds.length}...`);
  }

  console.log(`  Deleted ${deleted} duplicate rows from health_monitor.`);
  return { deleted };
}

// ─── Phase 4: Backfill missing nightscout.treatment_id in sync_state ─────────

async function backfillSyncState() {
  console.log('\n═══ Phase 4: Backfill missing NS treatment_id in sync_state ═══');

  const syncState = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
  const entries = syncState.entries || {};

  // Find entries with notion.page_id but no nightscout.treatment_id
  const missing = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.notion?.page_id && !entry.nightscout?.treatment_id) {
      missing.push({ key, entry });
    }
  }

  console.log(`  Entries missing nightscout.treatment_id: ${missing.length}`);

  if (missing.length === 0) {
    console.log('  Nothing to backfill.');
    return { backfilled: 0 };
  }

  // Fetch all NS treatments in the date range for batch lookup
  // We'll fetch in chunks by date to avoid massive single requests
  const timestamps = missing.map(m => new Date(m.entry.timestamp).getTime()).filter(t => !isNaN(t));
  const minDate = new Date(Math.min(...timestamps));
  const maxDate = new Date(Math.max(...timestamps));
  // Add 1 day buffer on each side
  minDate.setDate(minDate.getDate() - 1);
  maxDate.setDate(maxDate.getDate() + 1);

  console.log(`  Fetching NS treatments from ${minDate.toISOString().slice(0,10)} to ${maxDate.toISOString().slice(0,10)}...`);

  const allTreatments = [];
  // Fetch in 7-day windows
  let windowStart = new Date(minDate);
  while (windowStart < maxDate) {
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const gte = windowStart.toISOString();
    const lte = (windowEnd < maxDate ? windowEnd : maxDate).toISOString();
    try {
      const batch = await nsGet(`/treatments.json?count=10000&find[created_at][$gte]=${gte}&find[created_at][$lte]=${lte}`);
      if (Array.isArray(batch)) allTreatments.push(...batch);
    } catch (err) {
      console.error(`  !! NS fetch error for ${gte}: ${err.message}`);
    }
    windowStart = windowEnd;
    await sleep(200);
  }

  console.log(`  Fetched ${allTreatments.length} NS treatments total.`);

  // Index NS treatments by timestamp (rounded to minute) for fast lookup
  const nsByMinute = new Map();
  for (const t of allTreatments) {
    const ts = t.created_at || t.timestamp;
    if (!ts) continue;
    const dt = new Date(ts);
    if (isNaN(dt.getTime())) continue;
    const minuteKey = dt.toISOString().slice(0, 16);
    if (!nsByMinute.has(minuteKey)) nsByMinute.set(minuteKey, []);
    nsByMinute.get(minuteKey).push(t);
  }

  let backfilled = 0;
  for (const { key, entry } of missing) {
    const dt = new Date(entry.timestamp);
    if (isNaN(dt.getTime())) continue;
    const minuteKey = dt.toISOString().slice(0, 16);
    const candidates = nsByMinute.get(minuteKey) || [];

    // Match by notes/eventType similarity
    let match = null;
    for (const c of candidates) {
      // Simple heuristic: notes contain part of the title, or eventType matches category
      const notes = (c.notes || '').toLowerCase();
      const titleLower = (entry.title || '').toLowerCase().slice(0, 30);
      if (titleLower && notes.includes(titleLower.slice(0, 15))) {
        match = c;
        break;
      }
      // Category match: Food→Meal, Medication→Medication/Treatment, Exercise→Exercise
      const catMap = { Food: 'Meal', Medication: 'Note', Exercise: 'Exercise' };
      if (c.eventType === (catMap[entry.category] || entry.category)) {
        match = c;
        break;
      }
    }

    if (match) {
      if (!DRY_RUN) {
        if (!entries[key].nightscout) entries[key].nightscout = {};
        entries[key].nightscout.treatment_id = match._id;
        entries[key].nightscout.last_synced_at = new Date().toISOString();
      }
      backfilled++;
    }
  }

  console.log(`  Matched ${backfilled} of ${missing.length} entries to NS treatments.`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would update sync_state.json. Run with --commit to execute.');
    return { backfilled: 0, wouldBackfill: backfilled };
  }

  // Write updated sync_state
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(syncState, null, 2) + '\n');
  console.log(`  Updated sync_state.json with ${backfilled} NS treatment_ids.`);
  return { backfilled };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Pre-March-21 Duplicate Cleanup — ${DRY_RUN ? 'DRY RUN' : 'LIVE COMMIT'}`);
  console.log(`${'═'.repeat(60)}`);

  const t0 = Date.now();

  const r1 = await cleanupNotion();
  const r2 = await cleanupMysqlSsot();
  const r3 = await cleanupMysqlMonitor();
  const r4 = await backfillSyncState();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Mode:           ${DRY_RUN ? 'DRY RUN (no changes made)' : 'COMMITTED'}`);
  console.log(`  Notion:         ${DRY_RUN ? `would archive ${r1.wouldArchive || 0}` : `archived ${r1.archived}`} pages`);
  console.log(`  MySQL ssot:     ${DRY_RUN ? `would soft-delete ${r2.wouldDelete || 0}` : `soft-deleted ${r2.deleted}`} rows`);
  console.log(`  MySQL monitor:  ${DRY_RUN ? `would delete ${r3.wouldDelete || 0}` : `deleted ${r3.deleted}`} rows`);
  console.log(`  Sync state:     ${DRY_RUN ? `would backfill ${r4.wouldBackfill || 0}` : `backfilled ${r4.backfilled}`} NS treatment_ids`);
  console.log(`  Elapsed:        ${elapsed}s`);
  console.log(`${'═'.repeat(60)}\n`);

  if (DRY_RUN) {
    console.log('  To execute for real, run:');
    console.log('    node scripts/cleanup_pre_march21_duplicates.js --commit\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
