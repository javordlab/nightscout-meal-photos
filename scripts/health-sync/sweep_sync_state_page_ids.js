#!/usr/bin/env node
/**
 * sweep_sync_state_page_ids.js — one-off (or occasional) repair:
 *
 * For every Food entry in sync_state.json with a notion.page_id, verify that
 * page is still active in Notion. If not, query the Notion DB by Entry Key to
 * find the active page and rewrite sync_state to point at it. If no active
 * page exists at all, clear notion.page_id so the next radial_dispatcher run
 * will re-query and recreate.
 *
 * Safe to re-run. Does nothing if no stales are found.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const NOTION_KEY = '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';
const NOTION_DB  = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const SS         = '/Users/javier/.openclaw/workspace/data/sync_state.json';
const BAK        = `${SS}.bak.${Date.now()}`;
const KEEP_BAKS  = 3;

// This script does an unguarded read→modify→write of sync_state.json. The
// radial dispatcher (5-min cron) writes the same file — running concurrently
// would clobber one side's changes. Abort if a dispatcher is live.
function checkDispatcherNotRunning() {
  if (process.argv.includes('--force')) {
    console.log('WARNING: --force passed — skipping radial_dispatcher running check.');
    return;
  }
  let out = '';
  try {
    out = execSync('pgrep -f radial_dispatcher.js', { encoding: 'utf8' }).trim();
  } catch {
    return; // pgrep exits 1 when nothing matches — safe to proceed
  }
  if (out) {
    console.error(`radial_dispatcher.js is currently running (pid(s): ${out.split('\n').join(', ')}).`);
    console.error('Refusing to modify sync_state.json while the dispatcher may also write it.');
    console.error('Wait for it to finish, or re-run with --force if you are sure.');
    process.exit(1);
  }
}

// Keep only the newest KEEP_BAKS sync_state.json.bak.* files.
function pruneOldBackups() {
  try {
    const dir = path.dirname(SS);
    const base = path.basename(SS);
    const baks = fs.readdirSync(dir)
      .filter(f => f.startsWith(`${base}.bak.`))
      .sort()   // suffix is Date.now() — lexicographic sort == chronological (same width)
      .reverse();
    for (const f of baks.slice(KEEP_BAKS)) {
      fs.unlinkSync(path.join(dir, f));
      console.log(`Pruned old backup: ${f}`);
    }
  } catch (e) {
    console.error(`Backup pruning failed (non-fatal): ${e.message}`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function notion(method, endpoint, body = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(`https://api.notion.com/v1${endpoint}`, { method, headers }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', err => resolve({ status: 0, data: { error: err.message } }));
    if (data) req.write(data);
    req.end();
  });
}

// 1. Pull all active Food pages once (fast map for the common case)
async function loadActiveFoodPages() {
  const map = new Map();  // entry_key -> page_id
  let cursor;
  while (true) {
    const body = { filter: { property: 'Category', select: { equals: 'Food' } }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const r = await notion('POST', `/databases/${NOTION_DB}/query`, body);
    if (r.status !== 200) throw new Error(`Notion query failed: ${r.status}`);
    for (const p of r.data.results || []) {
      if (p.archived) continue;
      const ekRich = p.properties?.['Entry Key']?.rich_text || [];
      const ek = ekRich.map(t => t.plain_text).join('');
      if (ek) map.set(ek, p.id);
    }
    if (!r.data.has_more) break;
    cursor = r.data.next_cursor;
    await sleep(150);
  }
  return map;
}

async function main() {
  checkDispatcherNotRunning();
  const activeByEk = await loadActiveFoodPages();
  console.log(`Active Notion Food pages indexed by Entry Key: ${activeByEk.size}`);

  const ss = JSON.parse(fs.readFileSync(SS, 'utf8'));
  const entries = ss.entries || {};

  const foodEntries = Object.entries(entries).filter(([ek, v]) => v.category === 'Food');
  console.log(`Food entries in sync_state: ${foodEntries.length}`);

  // Build the set of active page_ids (normalized, hyphen-agnostic)
  const activeIds = new Set([...activeByEk.values()].map(id => id.replace(/-/g, '').toLowerCase()));

  let fixed = 0, cleared = 0, okAlready = 0, noChange = 0;
  for (const [ek, v] of foodEntries) {
    const cur = v.notion?.page_id;
    if (!cur) { noChange++; continue; }
    const curNorm = cur.replace(/-/g, '').toLowerCase();
    if (activeIds.has(curNorm)) { okAlready++; continue; }

    // Stale. Find the active one by Entry Key.
    const active = activeByEk.get(ek);
    if (active && active !== cur) {
      v.notion.page_id = active;
      v.notion.last_synced_at = new Date().toISOString();
      fixed++;
    } else {
      // No active page for this entry. Clear page_id so next dispatcher run re-queries.
      delete v.notion.page_id;
      cleared++;
    }
  }

  // Backup and write
  if (fixed > 0 || cleared > 0) {
    fs.copyFileSync(SS, BAK);
    fs.writeFileSync(SS, JSON.stringify(ss, null, 2) + '\n');
    console.log(`Backup: ${BAK}`);
  }
  console.log(`Done: fixed=${fixed} cleared=${cleared} ok_already=${okAlready} no_page_id=${noChange}`);
  pruneOldBackups();
}

main().catch(e => { console.error(e); process.exit(1); });
