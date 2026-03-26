#!/usr/bin/env node
/**
 * backfill_ns_entry_keys.js
 *
 * Two-phase NS cleanup:
 *  Phase 1 — Deduplicate: find groups of NS entries at the same timestamp with
 *             the same content (no entry_key token). Keep oldest, delete rest.
 *  Phase 2 — Backfill:   for each surviving entry still missing [entry_key:],
 *             match it to the normalized health_log and PATCH in the correct token.
 *
 * Safe to re-run. Use --dry-run to preview without writes.
 */

const https = require('https');
const path  = require('path');

const NS_URL       = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET    = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NS_ENTERED_BY = 'Javordclaw-SSoT';
const NORMALIZED_PATH = path.join(__dirname, '../../data/health_log.normalized.json');

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('[DRY RUN MODE — no writes will be made]\n');

// ── HTTP helpers ────────────────────────────────────────────────────────────

function nsReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(NS_URL + urlPath);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts   = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'api-secret':   NS_SECRET,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data || 'null')); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Text normalizer (strips metadata tokens for comparison) ─────────────────

function norm(text) {
  return String(text || '')
    .replace(/\[entry_key:[^\]]+\]/g, '')
    .replace(/📷\s*https?:\/\/\S+/g, '')
    .replace(/\(BG:[^)]*\)/g, '')
    .replace(/\(Pred:[^)]*\)/g, '')
    .replace(/\(Protein:[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── Fetch all NS treatments ──────────────────────────────────────────────
  console.log('Fetching NS treatments from 2026-01-01...');
  const all = await nsReq('GET', '/api/v1/treatments.json?count=2000&find%5Bcreated_at%5D%5B%24gte%5D=2026-01-01');
  if (!Array.isArray(all)) { console.error('NS fetch failed:', all); process.exit(1); }

  const javord = all.filter(t => t.enteredBy === NS_ENTERED_BY);
  const missing = javord.filter(t => !(t.notes || '').includes('[entry_key:'));
  console.log(`NS total: ${all.length} | Javordclaw: ${javord.length} | Missing key token: ${missing.length}\n`);

  // ── Phase 1: Deduplicate ─────────────────────────────────────────────────
  console.log('=== Phase 1: Deduplication ===');

  // Group by (created_at rounded to minute) + normalized notes
  const groups = new Map();
  for (const t of missing) {
    const tsMin = t.created_at ? t.created_at.slice(0, 16) : 'unknown';  // "2026-03-14T21:15"
    const key   = `${tsMin}||${norm(t.notes).slice(0, 60)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  let deleted = 0, deduped = 0;
  const survivors = [];   // one per group after dedup

  for (const [groupKey, entries] of groups) {
    if (entries.length === 1) {
      survivors.push(entries[0]);
      continue;
    }

    // Sort by created_at ascending → keep oldest
    entries.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const canonical = entries[0];
    const dupes     = entries.slice(1);

    console.log(`  [DEDUP] ${canonical.created_at} | "${(canonical.notes||'').slice(0,50)}" — keeping 1, deleting ${dupes.length}`);

    for (const dupe of dupes) {
      if (!DRY_RUN) {
        await nsReq('DELETE', `/api/v1/treatments/${dupe._id}`);
        await sleep(100);
      }
      deleted++;
    }
    survivors.push(canonical);
    deduped++;
  }

  console.log(`\nDedup done: ${deduped} groups deduplicated, ${deleted} duplicates deleted.\n`);

  // ── Phase 2: Backfill entry_key tokens ──────────────────────────────────
  console.log('=== Phase 2: Backfill entry_key tokens ===');

  const raw        = require(NORMALIZED_PATH);
  const normalized = raw.entries || [];
  console.log(`Normalized health_log entries: ${normalized.length}\n`);

  let patched = 0, noMatch = 0;

  for (const ns of survivors) {
    const nsTs   = new Date(ns.created_at).getTime();
    const nsNorm = norm(ns.notes).slice(0, 60);

    // Find candidates within ±6 min
    const candidates = normalized.filter(e => {
      const eTs = new Date(e.timestamp).getTime();
      return Math.abs(eTs - nsTs) <= 6 * 60 * 1000;
    });

    // Pick best match by leading-word overlap
    let match = null, bestLen = 0;
    for (const c of candidates) {
      const cNorm = norm(c.title).slice(0, 60);
      const overlap = nsNorm.length > 0 && cNorm.length > 0 &&
        (cNorm.includes(nsNorm.slice(0, 20)) || nsNorm.includes(cNorm.slice(0, 20)));
      const len = cNorm.length;
      if (overlap && len > bestLen) { bestLen = len; match = c; }
    }

    // Fallback: closest timestamp within ±90s
    if (!match) {
      match = candidates
        .filter(e => Math.abs(new Date(e.timestamp).getTime() - nsTs) <= 90 * 1000)
        .sort((a, b) => Math.abs(new Date(a.timestamp).getTime() - nsTs) - Math.abs(new Date(b.timestamp).getTime() - nsTs))[0] || null;
    }

    if (!match || !match.entryKey) {
      console.log(`  [NO MATCH] ${ns.created_at} | "${(ns.notes||'').slice(0,70)}"`);
      noMatch++;
      continue;
    }

    const newNotes = `${(ns.notes || '').trim()} [entry_key:${match.entryKey}]`;
    console.log(`  [PATCH] ${ns.created_at} | key=${match.entryKey.slice(0,16)}... | "${(ns.notes||'').slice(0,50)}"`);

    if (!DRY_RUN) {
      await nsReq('PUT', '/api/v1/treatments.json', { ...ns, notes: newNotes });
      await sleep(150);
    }
    patched++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Phase 1 — Duplicates deleted: ${deleted} (across ${deduped} groups)`);
  console.log(`Phase 2 — Entry keys backfilled: ${patched} | No match: ${noMatch}`);
  if (DRY_RUN) console.log('\n[DRY RUN — no actual writes were made]');
}

main().catch(e => { console.error(e); process.exit(1); });
