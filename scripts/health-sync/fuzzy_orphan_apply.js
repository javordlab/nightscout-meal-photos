#!/usr/bin/env node
/**
 * fuzzy_orphan_apply.js — Reads tmp/fuzzy_orphans.json (produced by
 * fuzzy_orphan_scan.js) and archives the listed candidate duplicates in Notion.
 *
 * Safety model:
 *   1. Default mode: prints the plan, archives NOTHING. You must pass --apply.
 *   2. Before any archive, fetches the page's full properties and writes them to
 *      data/notion_archive_backups/<timestamp>.json. No archive happens unless
 *      the backup write succeeded.
 *   3. Per-run cap (--max=N) and per-group cap (--per-group-max=N) bound damage.
 *   4. Refuses to act on a group whose canonical was picked via "oldest_no_ssot"
 *      (no SSoT proof of canonical). Those need manual review.
 *   5. Skips groups marked skipped:true in the scan (multi-SSoT collisions).
 *   6. Restore mode: --restore=<backup-file> un-archives every page in the
 *      backup. Pages remain in Notion's trash for ~30 days after archival, so
 *      restore via PATCH archived:false is the supported recovery path.
 *
 * Usage:
 *   # Dry-run (default) — prints the plan, writes nothing:
 *   node scripts/health-sync/fuzzy_orphan_apply.js
 *
 *   # Apply — writes backup, then archives:
 *   node scripts/health-sync/fuzzy_orphan_apply.js --apply
 *
 *   # Apply with safety caps:
 *   node scripts/health-sync/fuzzy_orphan_apply.js --apply --max=50 --per-group-max=10
 *
 *   # Restore from a backup file (un-archives every page in it):
 *   node scripts/health-sync/fuzzy_orphan_apply.js --restore=data/notion_archive_backups/2026-05-18T22-00-00.json
 */

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const NOTION_KEY = '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';
const SCAN_PATH = '/Users/javier/.openclaw/workspace/tmp/fuzzy_orphans.json';
const BACKUP_DIR = '/Users/javier/.openclaw/workspace/data/notion_archive_backups';

const HARD_RUN_CEILING = 500; // defense in depth — refuse if the JSON has more

function parseArgs(argv) {
  const args = { apply: false, max: Infinity, perGroupMax: 20, restore: null, allowStaleScan: false };
  // NaN/zero/negative caps silently disable the safety limit (NaN comparisons
  // are always false) — validate hard and refuse to run.
  const parsePositiveInt = (flag, raw) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) {
      console.error(`Invalid value for ${flag}: "${raw}" — must be a positive integer.`);
      console.error(`Usage: fuzzy_orphan_apply.js [--apply] [--max=N] [--per-group-max=N] [--allow-stale-scan] [--restore=<backup-file>]`);
      process.exit(2);
    }
    return n;
  };
  for (const a of argv.slice(2)) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--max=')) args.max = parsePositiveInt('--max', a.slice(6));
    else if (a.startsWith('--per-group-max=')) args.perGroupMax = parsePositiveInt('--per-group-max', a.slice(16));
    else if (a === '--allow-stale-scan') args.allowStaleScan = true;
    else if (a.startsWith('--restore=')) args.restore = a.slice(10);
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 35).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function notionRequest(method, endpoint, body = null) {
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
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(url, opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d || '{}'); }
        catch (e) { return reject(new Error(`Notion parse error: ${e.message} body=${d.slice(0,200)}`)); }
        if (parsed.object === 'error') return reject(new Error(`Notion API: ${parsed.code} — ${parsed.message}`));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function loadScan() {
  if (!fs.existsSync(SCAN_PATH)) {
    console.error(`No scan file at ${SCAN_PATH}. Run fuzzy_orphan_scan.js first.`);
    process.exit(1);
  }
  const stat = fs.statSync(SCAN_PATH);
  const ageMin = (Date.now() - stat.mtimeMs) / 60000;
  const scan = JSON.parse(fs.readFileSync(SCAN_PATH, 'utf8'));
  return { scan, ageMin };
}

function buildPlan(scan, args) {
  // Filter to actionable groups. Skip:
  //   - groups marked skipped (multi-SSoT)
  //   - groups whose canonical was picked via 'oldest_no_ssot' (no SSoT proof)
  //   - candidates classified 'canonical_mismatch_swap' — the canonical the
  //     scan picked (via entry_key) has the wrong metadata vs SSoT and the
  //     candidate is actually the better match. Archiving the candidate would
  //     archive the GOOD page. Handle these manually.
  const plan = [];
  let reasonCounts = { skipped_multi_ssot: 0, no_ssot_canonical: 0, skipped_canonical_swap: 0 };
  for (const g of scan.groups) {
    if (g.skipped) { reasonCounts.skipped_multi_ssot++; continue; }
    if (g.canonical?.matchStrategy === 'oldest_no_ssot') { reasonCounts.no_ssot_canonical++; continue; }
    if (!g.candidates || g.candidates.length === 0) continue;

    const safeCands = g.candidates.filter(c => {
      if (c.classification === 'canonical_mismatch_swap') {
        reasonCounts.skipped_canonical_swap++;
        return false;
      }
      return true;
    });
    if (safeCands.length === 0) continue;

    const candsCapped = safeCands.slice(0, args.perGroupMax);
    plan.push({
      compositeLoose: g.compositeLoose,
      canonical: g.canonical,
      ssotEntry: g.ssotEntry,
      candidates: candsCapped,
      candidatesDeferred: safeCands.length - candsCapped.length
    });
  }
  // Truncate to --max across the whole plan
  const flat = [];
  let totalDeferred = 0;
  for (const g of plan) {
    for (const c of g.candidates) {
      if (flat.length >= args.max) { totalDeferred++; continue; }
      flat.push({ groupKey: g.compositeLoose, canonical: g.canonical, ssotEntry: g.ssotEntry, candidate: c });
    }
    totalDeferred += g.candidatesDeferred;
  }
  return { plan, flat, totalDeferred, reasonCounts };
}

function printPlan(plan, flat, args, scanAgeMin) {
  console.log('');
  console.log('=== Fuzzy Orphan Apply — Plan ===');
  console.log(`Source: ${SCAN_PATH} (${scanAgeMin.toFixed(1)} min old)`);
  console.log(`Actionable groups:        ${plan.length}`);
  console.log(`Candidates to archive:    ${flat.length}`);
  console.log(`Per-group cap:            ${args.perGroupMax}`);
  console.log(`Per-run cap:              ${args.max === Infinity ? 'unlimited' : args.max}`);
  console.log('');
  console.log('By classification:');
  const cls = {};
  for (const f of flat) cls[f.candidate.classification] = (cls[f.candidate.classification] || 0) + 1;
  for (const [k, v] of Object.entries(cls).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${v}`);
  }
  console.log('');
  console.log('Sample (first 5 candidates):');
  for (const f of flat.slice(0, 5)) {
    console.log(`  archive ${f.candidate.id}  (${f.candidate.classification})`);
    console.log(`    ssot:      ${f.ssotEntry ? `${f.ssotEntry.mealType}@${f.ssotEntry.time}` : 'NONE'} — ${(f.ssotEntry?.title || '').slice(0, 70)}`);
    console.log(`    canonical: ${f.canonical.id} (${f.canonical.matchStrategy})`);
    console.log(`    candidate: ${f.candidate.mealType}@${f.candidate.time} — ${f.candidate.title.slice(0, 70)}`);
  }
  if (!args.apply) {
    console.log('');
    console.log('DRY RUN — no changes made. Re-run with --apply to perform the archive.');
  }
}

async function fetchPageForBackup(pageId) {
  // GET /pages/{id} returns the full page object including all properties.
  return notionRequest('GET', `/pages/${pageId}`, null);
}

async function archivePage(pageId) {
  return notionRequest('PATCH', `/pages/${pageId}`, { archived: true });
}

async function unarchivePage(pageId) {
  return notionRequest('PATCH', `/pages/${pageId}`, { archived: false });
}

const MAX_SCAN_AGE_MIN = 60;

async function applyMode(args) {
  const { scan, ageMin } = loadScan();

  // A stale scan describes a Notion state that may no longer exist — archiving
  // from it can hit the wrong pages. Refuse --apply unless explicitly overridden.
  if (args.apply && ageMin > MAX_SCAN_AGE_MIN && !args.allowStaleScan) {
    console.error(`Scan file is ${ageMin.toFixed(1)} min old (max ${MAX_SCAN_AGE_MIN} min for --apply).`);
    console.error('Re-run fuzzy_orphan_scan.js first, or pass --allow-stale-scan to override.');
    process.exit(2);
  }

  const { plan, flat, totalDeferred, reasonCounts } = buildPlan(scan, args);

  printPlan(plan, flat, args, ageMin);

  if (flat.length === 0) {
    console.log('Nothing to do.');
    return;
  }
  if (flat.length > HARD_RUN_CEILING) {
    console.error(`Plan size (${flat.length}) exceeds hard ceiling (${HARD_RUN_CEILING}). Use --max= to bound the run.`);
    process.exit(1);
  }
  if (totalDeferred > 0) {
    console.log(`\n  Deferred (will not be archived this run): ${totalDeferred}`);
  }
  console.log(`  Groups skipped — multi-SSoT collision:    ${reasonCounts.skipped_multi_ssot}`);
  console.log(`  Groups skipped — no SSoT canonical:       ${reasonCounts.no_ssot_canonical}`);
  console.log(`  Candidates skipped — canonical swap risk: ${reasonCounts.skipped_canonical_swap}`);

  if (!args.apply) return;

  // Prepare backup file
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `${stamp}.json`);
  const backup = {
    createdAt: new Date().toISOString(),
    sourceScan: SCAN_PATH,
    sourceScanGeneratedAt: scan.scannedAt,
    args: { max: args.max === Infinity ? null : args.max, perGroupMax: args.perGroupMax },
    pages: [] // populated as we go
  };
  // Touch the file so its existence is visible even if backup fetch crashes mid-stream
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup file: ${backupPath}`);
  console.log('');

  let archived = 0;
  let backupFailed = 0;
  let archiveFailed = 0;
  const log = [];

  for (let i = 0; i < flat.length; i++) {
    const f = flat[i];
    const pageId = f.candidate.id;
    const idx = `[${i + 1}/${flat.length}]`;

    // 1) Backup
    let pageData;
    try {
      pageData = await fetchPageForBackup(pageId);
    } catch (e) {
      console.error(`${idx} BACKUP FAILED ${pageId}: ${e.message} — SKIPPING archive for this page`);
      backupFailed++;
      log.push({ pageId, step: 'backup', status: 'error', error: e.message });
      await sleep(350);
      continue;
    }

    backup.pages.push({
      pageId,
      groupKey: f.groupKey,
      classification: f.candidate.classification,
      canonicalId: f.canonical.id,
      ssotIso: f.ssotEntry?.iso || null,
      archivedAt: null, // filled after PATCH
      original: pageData
    });
    // Persist backup after every successful fetch so a crash leaves us with
    // an up-to-date file pointing at every page we've touched.
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

    await sleep(350); // courtesy delay between Notion calls

    // 2) Archive
    try {
      await archivePage(pageId);
      const last = backup.pages[backup.pages.length - 1];
      last.archivedAt = new Date().toISOString();
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      archived++;
      console.log(`${idx} archived ${pageId}  (${f.candidate.classification})`);
      log.push({ pageId, step: 'archive', status: 'ok' });
    } catch (e) {
      console.error(`${idx} ARCHIVE FAILED ${pageId}: ${e.message}`);
      archiveFailed++;
      log.push({ pageId, step: 'archive', status: 'error', error: e.message });
    }

    await sleep(350);
  }

  console.log('');
  console.log('=== Apply complete ===');
  console.log(`Archived:        ${archived}`);
  console.log(`Backup failures: ${backupFailed}`);
  console.log(`Archive failures: ${archiveFailed}`);
  console.log(`Backup file:     ${backupPath}`);
  console.log('');
  console.log('Restore command (un-archives every page in the backup):');
  console.log(`  node scripts/health-sync/fuzzy_orphan_apply.js --restore=${path.relative('/Users/javier/.openclaw/workspace', backupPath)}`);
}

async function restoreMode(restorePath) {
  const absPath = path.isAbsolute(restorePath)
    ? restorePath
    : path.join('/Users/javier/.openclaw/workspace', restorePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Backup file not found: ${absPath}`);
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const toRestore = backup.pages.filter(p => p.archivedAt);
  console.log(`Backup file: ${absPath}`);
  console.log(`Pages to restore (un-archive): ${toRestore.length}`);
  if (toRestore.length === 0) {
    console.log('Nothing to restore.');
    return;
  }

  let ok = 0, failed = 0;
  for (let i = 0; i < toRestore.length; i++) {
    const p = toRestore[i];
    const idx = `[${i + 1}/${toRestore.length}]`;
    try {
      await unarchivePage(p.pageId);
      ok++;
      console.log(`${idx} restored ${p.pageId}  (was: ${p.classification})`);
    } catch (e) {
      failed++;
      console.error(`${idx} RESTORE FAILED ${p.pageId}: ${e.message}`);
    }
    await sleep(350);
  }

  console.log('');
  console.log(`Restored: ${ok}, failed: ${failed}`);
  console.log('Note: Notion permanently deletes archived pages ~30 days after archival.');
  console.log('If a restore failed with "Could not find page" — the page is gone.');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.restore) return restoreMode(args.restore);
  return applyMode(args);
}

main().catch(e => {
  console.error('[fuzzy_orphan_apply] fatal:', e.stack || e.message);
  process.exit(1);
});
