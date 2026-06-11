#!/usr/bin/env node
/**
 * fuzzy_orphan_scan.js — DRY-RUN ONLY. Finds Notion pages that look like
 * semantic duplicates of an SSoT entry but were missed by the strict
 * composite-key dedup in radial_dispatcher.js.
 *
 * Reads:
 *   - Notion DB (last N days, default 30) — non-archived pages
 *   - /Users/javier/.openclaw/workspace/data/health_log.normalized.json — SSoT
 *
 * Writes:
 *   - /Users/javier/.openclaw/workspace/tmp/fuzzy_orphans.json
 *   - Summary table to stdout
 *
 * Never PATCHes, never archives. Safe to run any time.
 *
 * Usage:
 *   node scripts/health-sync/fuzzy_orphan_scan.js [--days=30]
 */

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const NORMALIZED_PATH = '/Users/javier/.openclaw/workspace/data/health_log.normalized.json';
const OUT_PATH = '/Users/javier/.openclaw/workspace/tmp/fuzzy_orphans.json';

function parseArgs(argv) {
  const args = { days: 30 };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--days=(\d+)$/);
    if (m) args.days = parseInt(m[1], 10);
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
        try { resolve(JSON.parse(d || '{}')); }
        catch (e) { reject(new Error(`Notion parse error: ${e.message} body=${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Title-core stripper: removes Coach, BG, Pred, Protein/Carbs/Cals, cumulative,
// photo markdown, "(logged late)", "[photo: pending upload]". Lowercase + tidy
// whitespace. Preserves the meal description core.
function titleCore(raw) {
  if (!raw) return '';
  let t = String(raw);
  t = t.replace(/\[Coach:[^\]]*\]/gi, '');
  t = t.replace(/\[Cumulative[^\]]*\]/gi, '');
  t = t.replace(/\[photo[^\]]*\]\([^)]+\)/gi, '');
  t = t.replace(/\[photo:[^\]]*\]/gi, '');
  t = t.replace(/\[📷\]\([^)]+\)/gi, '');
  t = t.replace(/\(BG:[^)]*\)/gi, '');
  t = t.replace(/\(Pred:[^)]*\)/gi, '');
  t = t.replace(/\(Protein:[^)]*\)/gi, '');
  t = t.replace(/\(Carbs:[^)]*\)/gi, '');
  t = t.replace(/\(Cals:[^)]*\)/gi, '');
  t = t.replace(/\(logged late\)/gi, '');
  t = t.replace(/\s+/g, ' ').trim().toLowerCase();
  t = t.replace(/[“”]/g, '"').replace(/[’]/g, "'");
  // Strip the meal-type prefix so "Breakfast: X" matches "Lunch: X"
  t = t.replace(/^(breakfast|lunch|dinner|snack|dessert|meal|medication|exercise|activity):\s*/i, '');
  return t;
}

function loadSsot() {
  const raw = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  return (raw.entries || []).map(e => ({
    iso: e.timestamp,
    date: e.date,
    time: (e.time || '').slice(0, 5),
    user: e.user,
    category: e.category,
    mealType: e.mealType || '-',
    title: e.title || '',
    titleCore: titleCore(e.title || ''),
    entryKey: e.entryKey || null
  }));
}

async function fetchNotionPages(sinceDate) {
  const pages = [];
  let cursor = null;
  do {
    const r = await notionRequest('POST', `/databases/${NOTION_DB_ID}/query`, {
      filter: { property: 'Date', date: { on_or_after: sinceDate } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    if (r.object === 'error') throw new Error(`Notion API error: ${r.message}`);
    for (const p of (r.results || [])) {
      if (p.archived) continue;
      pages.push(p);
    }
    cursor = r.has_more ? r.next_cursor : null;
    if (cursor) await sleep(350); // courtesy delay for Notion rate limit
  } while (cursor);
  return pages;
}

function notionPageToRecord(p) {
  const dateStart = p.properties?.Date?.date?.start || '';
  const date = dateStart.slice(0, 10);
  const time = dateStart.slice(11, 16); // HH:MM
  const user = p.properties?.User?.select?.name || '';
  const cat  = p.properties?.Category?.select?.name || '';
  const meal = p.properties?.['Meal Type']?.select?.name || '-';
  const title = p.properties?.Entry?.title?.[0]?.plain_text || '';
  const entryKey = p.properties?.['Entry Key']?.rich_text?.[0]?.plain_text || '';
  return {
    id: p.id,
    createdTime: p.created_time,
    lastEditedTime: p.last_edited_time,
    date,
    time,
    user,
    category: cat,
    mealType: meal,
    title,
    titleCore: titleCore(title),
    entryKey: entryKey || null
  };
}

function ssotKey(s)  { return `${s.date}|${s.user}|${s.category}|${s.titleCore}`; }
function groupKey(p) { return `${p.date}|${p.user}|${p.category}|${p.titleCore}`; }

function pickCanonical(pages, ssotMatch) {
  // 1. Exact entry_key match
  if (ssotMatch?.entryKey) {
    const byKey = pages.find(p => p.entryKey === ssotMatch.entryKey);
    if (byKey) return { page: byKey, strategy: 'entry_key' };
  }
  // 2. Exact composite match (date+user+cat+mealType+time)
  if (ssotMatch) {
    const byComposite = pages.find(p =>
      p.mealType === ssotMatch.mealType && p.time === ssotMatch.time
    );
    if (byComposite) return { page: byComposite, strategy: 'composite' };
  }
  // 3. No canonical from SSoT — pick oldest as canonical, but flag it
  const sorted = [...pages].sort((a, b) => a.createdTime.localeCompare(b.createdTime));
  return { page: sorted[0], strategy: 'oldest_no_ssot' };
}

function classifyCandidate(cand, canonical, ssotMatch) {
  // Time drift (different HH:MM)
  if (cand.time !== canonical.time) {
    if (ssotMatch && cand.time === ssotMatch.time) {
      // Candidate IS the SSoT's time; canonical isn't. Swap is implied — report.
      return 'canonical_mismatch_swap';
    }
    return 'time_drift';
  }
  // MealType drift (same time, different mealType)
  if (cand.mealType !== canonical.mealType) {
    return 'mealtype_drift';
  }
  // Same time + same mealType + same title-core = pure title/Coach drift
  return 'coach_or_title_drift';
}

async function main() {
  const args = parseArgs(process.argv);
  const sinceDate = new Date(Date.now() - args.days * 86400 * 1000).toISOString().slice(0, 10);
  console.log(`[fuzzy_orphan_scan] window: last ${args.days} days (on_or_after ${sinceDate})`);

  console.log('[fuzzy_orphan_scan] loading SSoT...');
  const ssot = loadSsot();
  const ssotByLooseKey = new Map(); // date|user|cat|titleCore -> array of SSoT entries
  for (const s of ssot) {
    const k = ssotKey(s);
    if (!ssotByLooseKey.has(k)) ssotByLooseKey.set(k, []);
    ssotByLooseKey.get(k).push(s);
  }
  console.log(`[fuzzy_orphan_scan] SSoT: ${ssot.length} entries, ${ssotByLooseKey.size} distinct loose keys`);

  console.log('[fuzzy_orphan_scan] fetching Notion pages...');
  const pages = (await fetchNotionPages(sinceDate)).map(notionPageToRecord);
  console.log(`[fuzzy_orphan_scan] Notion: ${pages.length} non-archived pages in window`);

  // Group Notion pages by loose key (date+user+cat+titleCore — drops mealType+time)
  const groups = new Map();
  for (const p of pages) {
    const k = groupKey(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const dupeGroups = [];
  const byClassification = {};
  let totalCandidates = 0;
  let groupsNoSsot = 0;

  for (const [k, ps] of groups.entries()) {
    if (ps.length < 2) continue;
    const ssotMatches = ssotByLooseKey.get(k) || [];

    // If multiple SSoT entries share this loose key (legitimate cumulative meals
    // with multiple SSoT rows at different times), we can't safely call any
    // Notion page a duplicate — they may all be canonical.
    if (ssotMatches.length > 1) {
      dupeGroups.push({
        compositeLoose: k,
        pageCount: ps.length,
        skipped: true,
        skipReason: `multi_ssot_match (${ssotMatches.length} SSoT entries)`,
        ssotEntries: ssotMatches.map(s => ({
          iso: s.iso, mealType: s.mealType, time: s.time, title: s.title.slice(0, 80)
        })),
        pages: ps.map(p => ({
          id: p.id, time: p.time, mealType: p.mealType,
          createdTime: p.createdTime, lastEditedTime: p.lastEditedTime,
          title: p.title.slice(0, 80), entryKey: p.entryKey
        }))
      });
      continue;
    }

    const ssotMatch = ssotMatches[0] || null;
    if (!ssotMatch) groupsNoSsot++;

    const { page: canonical, strategy } = pickCanonical(ps, ssotMatch);
    const candidates = ps.filter(p => p.id !== canonical.id).map(p => {
      const cls = classifyCandidate(p, canonical, ssotMatch);
      byClassification[cls] = (byClassification[cls] || 0) + 1;
      totalCandidates++;
      return {
        id: p.id,
        time: p.time,
        mealType: p.mealType,
        createdTime: p.createdTime,
        lastEditedTime: p.lastEditedTime,
        title: p.title.slice(0, 120),
        entryKey: p.entryKey,
        classification: cls
      };
    });

    dupeGroups.push({
      compositeLoose: k,
      pageCount: ps.length,
      canonical: {
        id: canonical.id,
        time: canonical.time,
        mealType: canonical.mealType,
        createdTime: canonical.createdTime,
        title: canonical.title.slice(0, 120),
        entryKey: canonical.entryKey,
        matchStrategy: strategy
      },
      ssotEntry: ssotMatch ? {
        iso: ssotMatch.iso,
        mealType: ssotMatch.mealType,
        time: ssotMatch.time,
        title: ssotMatch.title.slice(0, 120),
        entryKey: ssotMatch.entryKey
      } : null,
      candidates
    });
  }

  // Sort: groups with no SSoT match first (most suspicious), then by candidate count desc
  dupeGroups.sort((a, b) => {
    const aNoSsot = a.skipped ? 2 : (a.ssotEntry ? 1 : 0);
    const bNoSsot = b.skipped ? 2 : (b.ssotEntry ? 1 : 0);
    if (aNoSsot !== bNoSsot) return aNoSsot - bNoSsot;
    return (b.candidates?.length || 0) - (a.candidates?.length || 0);
  });

  const out = {
    scannedAt: new Date().toISOString(),
    windowDays: args.days,
    sinceDate,
    totalNotionPages: pages.length,
    ssotEntries: ssot.length,
    groupsTotal: groups.size,
    groupsWithDupes: dupeGroups.length,
    groupsNoSsot,
    totalCandidatesForArchival: totalCandidates,
    byClassification,
    groups: dupeGroups
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  // Summary
  console.log('');
  console.log('=== Fuzzy Orphan Scan — DRY RUN ===');
  console.log(`Window:                 last ${args.days} days (>= ${sinceDate})`);
  console.log(`Notion pages scanned:   ${pages.length}`);
  console.log(`SSoT entries loaded:    ${ssot.length}`);
  console.log(`Groups with dupes:      ${dupeGroups.length}`);
  console.log(`  - skipped (multi-SSoT): ${dupeGroups.filter(g => g.skipped).length}`);
  console.log(`  - no SSoT canonical:    ${groupsNoSsot}`);
  console.log(`Candidate dupes total:  ${totalCandidates}`);
  console.log('By classification:');
  for (const [k, v] of Object.entries(byClassification).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${v}`);
  }
  console.log('');
  console.log(`Full report: ${OUT_PATH}`);
  console.log('No archival performed. Review the JSON before approving any cleanup.');

  // Top 10 fattest groups for quick eyeballing
  console.log('');
  console.log('Top 10 groups by candidate count:');
  const top = dupeGroups.filter(g => !g.skipped).slice(0, 10);
  for (const g of top) {
    const ssotTag = g.ssotEntry ? `ssot=${g.ssotEntry.mealType}@${g.ssotEntry.time}` : 'NO-SSOT';
    console.log(`  [${(g.candidates?.length || 0).toString().padStart(2)} dupes] ${ssotTag.padEnd(22)} ${g.compositeLoose.slice(0, 100)}`);
  }
}

main().catch(e => {
  console.error('[fuzzy_orphan_scan] fatal:', e.stack || e.message);
  process.exit(1);
});
