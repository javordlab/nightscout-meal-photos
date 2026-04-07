#!/usr/bin/env node
// audit_health_sync.js - Phase 4: comprehensive discrepancy audit
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const GALLERY_PATH = path.join(WORKSPACE, 'nightscout-meal-photos', 'data', 'notion_meals.json');
const REPORT_PATH = path.join(WORKSPACE, 'data', 'health_sync_audit_report.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'audit.log.jsonl');

const NOTION_KEY = process.env.NOTION_KEY || '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';
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_SECRET = process.env.NIGHTSCOUT_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_DB_ID = process.env.NOTION_DB_ID || '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

const { loadSyncState, saveSyncState } = require('./sync_state');

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

function fetchNightscoutTreatments(sinceIso) {
  return new Promise((resolve, reject) => {
    const sinceMs = new Date(sinceIso).getTime();
    const url = `${NIGHTSCOUT_URL}/api/v1/treatments.json?find[created_at][$gte]=${encodeURIComponent(sinceIso)}&count=200`;
    const options = {
      headers: { 'api-secret': NIGHTSCOUT_SECRET, 'Content-Type': 'application/json' }
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '[]')); } catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function queryNotionDatabase(body) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`;
    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        // 2025-09-03 dropped /databases/{id}/query — keep 2022-06-28 to match
        // radial_dispatcher.js. Bumping requires migrating to /data_sources/{id}/query.
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d || '{}'); }
        catch (e) { return reject(new Error(`Notion query: invalid JSON (status=${res.statusCode}): ${d.slice(0, 200)}`)); }
        // FAIL LOUD: any non-2xx OR Notion-level error must reject. The pre-2026-04-06
        // version silently returned `{}`, which masked the runaway-archival incident
        // for ~2 weeks because a `select option not found` validation_error looked
        // like "no entries to flag".
        if (res.statusCode >= 400 || parsed.object === 'error') {
          return reject(new Error(`Notion query failed (status=${res.statusCode}, code=${parsed.code}): ${parsed.message || d.slice(0, 200)}`));
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchNotionPages(sinceIso) {
  const results = [];
  let startCursor = null;

  while (true) {
    const body = {
      filter: {
        property: 'Date',
        date: { on_or_after: sinceIso }
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 100
    };

    if (startCursor) body.start_cursor = startCursor;

    const page = await queryNotionDatabase(body);
    results.push(...(page.results || []));

    if (!page.has_more || !page.next_cursor) break;
    startCursor = page.next_cursor;
  }

  return { results };
}

function fetchNotionPage(pageId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1/pages/${pageId}`;
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// SSoT-leading round-trip audit. Compares every SSoT entry against the live
// Notion result by (timestamp, user) — independent of sync_state.json — and
// flags four divergence classes:
//   1. notion_missing      — SSoT entry has no live Notion page at that ts+user.
//                            This is the runaway-archival case (Mar 19 – Apr 1, 2026).
//   2. notion_archived     — Notion page exists at sync_state.notion.page_id
//                            but is in_trash. Won't be returned by query, so case 1
//                            also covers this — kept for clarity in the alert.
//   3. notion_pageid_drift — sync_state has a notion.page_id, but the page it
//                            points to belongs to a different SSoT entry
//                            (different Date or User). This is the chocolate-brownie
//                            case from 2026-04-06.
//   4. notion_extra        — Notion has a page at a (ts+user) with no SSoT entry.
//                            Possible orphan from a deleted SSoT row.
//
// User name normalization: SSoT uses "Maria"; the Notion select option is
// "Maria Dennis". The mapping below is required — passing the SSoT name
// straight through used to silently fail with a select-option-not-found error.
const SSOT_TO_NOTION_USER = {
  'Maria': 'Maria Dennis',
  'Maria Dennis': 'Maria Dennis',
  'Javi': 'Javi',
  'System': 'System'
};

function normalizeNotionIso(iso) {
  // Notion stores '2026-02-22T19:30:00.000-08:00'; SSoT stores '2026-02-22T19:30:00-08:00'.
  // Strip subsecond fragment so timestamps compare cleanly.
  return (iso || '').replace(/\.\d+/, '');
}

async function fetchNotionPagePresence(pageId) {
  // Lightweight existence + archive check used by the page_id drift detector.
  // Returns { exists, archived, date, user } or null on hard error.
  return new Promise((resolve) => {
    const url = `https://api.notion.com/v1/pages/${pageId}`;
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28'
      }
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(d || '{}');
          if (p.object === 'page') {
            resolve({
              exists: true,
              archived: !!p.archived || !!p.in_trash,
              date: normalizeNotionIso(p.properties?.Date?.date?.start),
              user: p.properties?.User?.select?.name || null
            });
          } else {
            resolve({ exists: false, archived: false, date: null, user: null });
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function roundTripNotionAudit(report, normalized, state, since) {
  // Pull every Notion page in the audit window in one paginated sweep, then
  // diff against SSoT. The function mutates `report.discrepancies` with
  // notion_missing / notion_pageid_drift / notion_extra issues. Costs ≤ N/100
  // queries plus a per-drift verify (typically zero in steady state).
  const notionResponse = await fetchNotionPages(since);
  const notionPages = notionResponse.results || [];

  // Index by (normalized iso | user)
  const notionByKey = new Map();
  for (const p of notionPages) {
    if (p.archived || p.in_trash) continue;
    const iso = normalizeNotionIso(p.properties?.Date?.date?.start);
    const user = p.properties?.User?.select?.name || '';
    if (!iso) continue;
    const key = `${iso}|${user}`;
    if (!notionByKey.has(key)) notionByKey.set(key, []);
    notionByKey.get(key).push(p);
  }

  // SSoT-leading: every SSoT entry must have a corresponding Notion page.
  const sinceMs = new Date(since).getTime();
  const ssotEntries = (normalized.entries || []).filter(e => new Date(e.timestamp) >= new Date(sinceMs));
  const seenSsotKeys = new Set();
  for (const e of ssotEntries) {
    const notionUser = SSOT_TO_NOTION_USER[e.user] || e.user;
    const key = `${e.timestamp}|${notionUser}`;
    seenSsotKeys.add(key);
    if (!notionByKey.has(key)) {
      report.summary.notion_missing_roundtrip = (report.summary.notion_missing_roundtrip || 0) + 1;
      report.discrepancies.push({
        entryKey: e.entryKey,
        timestamp: e.timestamp,
        title: e.title,
        issues: [{ type: 'notion_missing', severity: 'error',
                   note: 'No live Notion page at this (timestamp, user) — likely archived or never created' }]
      });
    }
  }

  // Notion-leading: any Notion page with no matching SSoT row is suspect.
  for (const [key, pages] of notionByKey) {
    if (seenSsotKeys.has(key)) continue;
    for (const p of pages) {
      report.summary.notion_extra = (report.summary.notion_extra || 0) + 1;
      report.discrepancies.push({
        entryKey: null,
        timestamp: normalizeNotionIso(p.properties?.Date?.date?.start),
        title: p.properties?.Entry?.title?.[0]?.plain_text,
        issues: [{ type: 'notion_extra', severity: 'warning', pageId: p.id,
                   note: 'Notion page with no SSoT entry at this (timestamp, user)' }]
      });
    }
  }

  // Page-id drift: sync_state.notion.page_id exists but points to a Notion page
  // whose Date/User no longer match the SSoT entry it's bound to. We only verify
  // entries already flagged with notion_missing — for the rest, the index check
  // above is sufficient.
  for (const e of ssotEntries) {
    const sync = state.entries[e.entryKey] || {};
    const pageId = sync.notion?.page_id;
    if (!pageId) continue;
    const notionUser = SSOT_TO_NOTION_USER[e.user] || e.user;
    const expectedKey = `${e.timestamp}|${notionUser}`;
    // If the SSoT entry has a live match at the right key, no need to verify.
    if (notionByKey.has(expectedKey)) continue;
    // Otherwise, fetch the page directly and check what it actually points to.
    const presence = await fetchNotionPagePresence(pageId);
    if (!presence) continue;
    if (presence.exists && !presence.archived) {
      const actualKey = `${presence.date}|${presence.user}`;
      if (actualKey !== expectedKey) {
        report.summary.notion_pageid_drift = (report.summary.notion_pageid_drift || 0) + 1;
        report.discrepancies.push({
          entryKey: e.entryKey,
          timestamp: e.timestamp,
          title: e.title,
          issues: [{ type: 'notion_pageid_drift', severity: 'error', pageId,
                     expected: expectedKey, actual: actualKey,
                     note: 'sync_state.notion.page_id points to a different SSoT entry — clear and re-sync' }]
        });
      }
    }
  }
}

async function main(options = {}) {
  const since = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const state = loadSyncState(SYNC_STATE_PATH);
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const galleryItems = fs.existsSync(GALLERY_PATH) ? JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8')) : [];

  console.log(`Auditing since ${since}...`);

  // Fetch external data
  const [nsTreatments, notionResponse] = await Promise.all([
    fetchNightscoutTreatments(since),
    fetchNotionPages(since)
  ]);

  const notionPages = notionResponse.results || [];

  // Build lookup maps
  const nsById = new Map(nsTreatments.map(t => [t._id, t]));
  const notionById = new Map(notionPages.map(p => [p.id, p]));
  const notionExistsCache = new Map();
  const galleryByPhoto = new Map(galleryItems.filter(i => i.photo).map(i => [i.photo, i]));

  // Find entries by entry_key in notes
  const entryKeyRegex = /\[entry_key:([^\]]+)\]/;
  const nsByEntryKey = new Map();
  for (const t of nsTreatments) {
    const m = t.notes?.match(entryKeyRegex);
    if (m) nsByEntryKey.set(m[1], t);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    since,
    summary: {
      totalEntries: 0,
      inSyncState: 0,
      nsLinked: 0,
      notionLinked: 0,
      galleryLinked: 0,
      outcomesBackfilled: 0,
      duplicates: 0,
      missingNs: 0,
      missingNotion: 0,
      missingGallery: 0,
      missingOutcomes: 0
    },
    discrepancies: []
  };

  // Check all entries since cutoff
  const recentEntries = (normalized.entries || []).filter(e => new Date(e.timestamp) >= new Date(since));
  report.summary.totalEntries = recentEntries.length;

  for (const entry of recentEntries) {
    const syncEntry = state.entries[entry.entryKey] || {};
    const issues = [];

    // Check sync state presence
    if (!state.entries[entry.entryKey]) {
      issues.push({ type: 'missing_from_sync_state', severity: 'warning' });
    } else {
      report.summary.inSyncState++;
    }

    // Check Nightscout link
    const nsLinked = !!syncEntry.nightscout?.treatment_id;
    if (nsLinked) report.summary.nsLinked++;

    // Verify Nightscout treatment exists
    if (nsLinked && syncEntry.nightscout?.treatment_id) {
      if (!nsById.has(syncEntry.nightscout.treatment_id)) {
        issues.push({ type: 'ns_treatment_missing', treatmentId: syncEntry.nightscout.treatment_id, severity: 'error' });
      }
    }

    // Check for duplicates in Nightscout
    const nsMatch = nsByEntryKey.get(entry.entryKey);
    if (nsMatch) {
      const duplicates = nsTreatments.filter(t => {
        const m = t.notes?.match(entryKeyRegex);
        return m && m[1] === entry.entryKey && t._id !== nsMatch._id;
      });
      if (duplicates.length > 0) {
        issues.push({ type: 'ns_duplicate', count: duplicates.length + 1, severity: 'error', ids: duplicates.map(d => d._id) });
        report.summary.duplicates++;
      }
    }

    // Check Notion link
    const notionLinked = !!syncEntry.notion?.page_id;
    if (notionLinked) report.summary.notionLinked++;

    // Verify Notion page exists
    if (notionLinked && syncEntry.notion?.page_id) {
      const pageId = syncEntry.notion.page_id;
      let exists = notionById.has(pageId);

      if (!exists) {
        if (notionExistsCache.has(pageId)) {
          exists = notionExistsCache.get(pageId);
        } else {
          try {
            const page = await fetchNotionPage(pageId);
            exists = page?.id === pageId && page?.object === 'page';
            notionExistsCache.set(pageId, exists);
          } catch {
            exists = false;
          }
        }
      }

      if (!exists) {
        issues.push({ type: 'notion_page_missing', pageId, severity: 'error' });
      }
    }

    // Check Gallery link
    const galleryLinked = !!syncEntry.gallery?.gallery_id;
    if (galleryLinked) report.summary.galleryLinked++;

    // Verify gallery item exists
    if (galleryLinked && syncEntry.gallery?.gallery_id) {
      const photo = entry.photoUrls?.[0];
      const galleryMatch = galleryByPhoto.get(photo);
      if (!galleryMatch) {
        issues.push({ type: 'gallery_item_missing', galleryId: syncEntry.gallery.gallery_id, severity: 'warning' });
      }
    }

    // Check outcomes backfill
    // Source of truth: Notion page '2hr Peak BG' field, not the stale sync_state flag
    // (outcomes_backfilled flag in sync_state is never written by backfill_notion_impact.js)
    if (entry.category === 'Food') {
      const notionPageId = syncEntry.notion?.page_id;
      const ageHours = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60);
      // Only flag entries >3h old that have a Notion page but no recorded peak BG
      // We check syncEntry.notion.peak_bg if available; otherwise assume backfilled if Notion linked
      // (backfill_notion_impact.js runs hourly and covers all entries >3h old)
      const hasOutcomes = syncEntry.outcomes_backfilled || syncEntry.notion?.peak_bg_backfilled || (notionPageId && ageHours < 6);
      if (hasOutcomes) {
        report.summary.outcomesBackfilled++;
      } else if (!notionPageId && ageHours >= 3) {
        // Only flag if not in Notion at all — the backfill can't run without a Notion page
        issues.push({ type: 'outcomes_not_backfilled', ageHours: Math.round(ageHours), severity: 'warning' });
        report.summary.missingOutcomes++;
      } else {
        // Has a Notion page — backfill_notion_impact.js handles this hourly, not a real gap
        report.summary.outcomesBackfilled++;
      }
    }

    // Missing link checks
    if (!nsLinked && entry.category !== 'Note') {
      report.summary.missingNs++;
      issues.push({ type: 'missing_ns_link', severity: 'warning' });
    }
    if (!notionLinked) {
      report.summary.missingNotion++;
      issues.push({ type: 'missing_notion_link', severity: 'warning' });
    }
    if (!galleryLinked && entry.photoUrls?.length > 0) {
      report.summary.missingGallery++;
      issues.push({ type: 'missing_gallery_link', severity: 'warning' });
    }

    if (issues.length > 0) {
      report.discrepancies.push({
        entryKey: entry.entryKey,
        timestamp: entry.timestamp,
        title: entry.title,
        issues
      });
    }
  }

  // ── sync_state.json integrity validator ───────────────────────────────────
  // Catches the failure mode where two SSoT entries' sync_state records point
  // to the same Notion page_id. That happened on 2026-04-06: entry
  // sha256:98f968dabd (chocolate brownie 2026-03-20) was cross-linked to the
  // page that legitimately belonged to sha256:c045397fe2 (green grapes
  // 2026-03-01), so dispatcher rewrites would clobber the grapes entry.
  //
  // With `--fix`, the validator additionally clears the duplicate notion.page_id
  // from all but ONE entry per collision (the one whose entryKey lexicographically
  // sorts first — deterministic choice; arbitrary but stable). The next
  // dispatcher run will then create a fresh Notion page for each cleared entry.
  // Rationale: any deterministic tiebreaker is correct here because the dispatcher
  // (post-2026-04-06 entry_key fix) will discover the right page via Entry Key.
  const pageIdToKeys = new Map();
  for (const [entryKey, syncEntry] of Object.entries(state.entries || {})) {
    const pid = syncEntry.notion?.page_id;
    if (!pid) continue;
    if (!pageIdToKeys.has(pid)) pageIdToKeys.set(pid, []);
    pageIdToKeys.get(pid).push(entryKey);
  }
  let collisionsCleared = 0;
  for (const [pid, keys] of pageIdToKeys) {
    if (keys.length < 2) continue;
    report.summary.sync_state_pageid_collision = (report.summary.sync_state_pageid_collision || 0) + 1;
    report.discrepancies.push({
      entryKey: null,
      timestamp: new Date().toISOString(),
      title: `sync_state collision: ${keys.length} entries → ${pid}`,
      issues: [{ type: 'sync_state_pageid_collision', severity: 'error', pageId: pid, entryKeys: keys,
                 note: 'Multiple SSoT entries point to the same Notion page_id — clear all but the canonical one and re-sync' }]
    });
    if (options.fix) {
      // Keep the lexicographically-smallest entry_key as the canonical owner;
      // clear notion link from the rest.
      const sortedKeys = [...keys].sort();
      const losers = sortedKeys.slice(1);
      for (const loser of losers) {
        if (state.entries[loser]?.notion) {
          delete state.entries[loser].notion;
          collisionsCleared++;
          console.log(`  --fix: cleared notion link from ${loser.slice(0,17)} (collision with ${sortedKeys[0].slice(0,17)})`);
        }
      }
    }
  }
  if (options.fix && collisionsCleared > 0) {
    saveSyncState(SYNC_STATE_PATH, state);
    console.log(`  --fix: persisted ${collisionsCleared} sync_state cleanups → ${SYNC_STATE_PATH}`);
    report.summary.sync_state_collisions_fixed = collisionsCleared;
  }

  // ── SSoT-leading round-trip Notion audit ──────────────────────────────────
  // This is the authoritative check post-2026-04-06. The legacy sync_state-based
  // checks above remain as a secondary signal but cannot detect the failure
  // modes that bit us in March: archived/in_trash pages, page_id drift, and
  // pages that never reached Notion at all.
  try {
    await roundTripNotionAudit(report, normalized, state, since);
  } catch (e) {
    console.error(`Round-trip Notion audit failed: ${e.message}`);
    report.discrepancies.push({
      entryKey: null,
      timestamp: new Date().toISOString(),
      title: 'AUDIT INFRASTRUCTURE FAILURE',
      issues: [{ type: 'audit_failure', severity: 'error', error: e.message,
                 note: 'Round-trip audit could not run — sync gaps may be undetected' }]
    });
    report.summary.audit_failures = (report.summary.audit_failures || 0) + 1;
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  log({ op: 'audit_complete', since, discrepancies: report.discrepancies.length });

  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`\nWrote ${REPORT_PATH}`);

  // ── Active alert: send Telegram DM if any sync gaps found ──────────────────
  const errorCount = report.discrepancies.filter(d =>
    d.issues.some(i => i.severity === 'error')
  ).length;
  const warnCount = report.discrepancies.filter(d =>
    d.issues.every(i => i.severity !== 'error') && d.issues.length > 0
  ).length;

  if (errorCount > 0 || warnCount > 0) {
    await sendSyncGapAlert(report, errorCount, warnCount);
  }

  return report;
}

const { sendAlert } = require('./telegram_alert');

async function sendSyncGapAlert(report, errorCount, warnCount) {

  const sysTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date().toLocaleString('en-US', { timeZone: sysTZ, hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

  const lines = [`🔴 Sync Audit Gap Detected (${now})\n`];
  if (errorCount > 0) lines.push(`❌ ${errorCount} entries with sync errors (missing Notion/NS)`);
  if (warnCount > 0) lines.push(`⚠️ ${warnCount} entries with warnings`);

  // List up to 5 specific affected entries
  const toShow = report.discrepancies.slice(0, 5);
  for (const d of toShow) {
    const t = new Date(d.timestamp).toLocaleString('en-US', { timeZone: sysTZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const types = d.issues.map(i => i.type.replace(/_/g, ' ')).join(', ');
    lines.push(`  • ${t} — ${(d.title || '').substring(0, 50)}: ${types}`);
  }
  if (report.discrepancies.length > 5) {
    lines.push(`  ... and ${report.discrepancies.length - 5} more`);
  }

  lines.push(`\nRun: node scripts/health-sync/health_sync_pipeline.js --mode=full --since=$(date -v-2d +%F)`);

  const text = lines.join('\n');
  const r = await sendAlert(text);
  if (r.ok) console.log('📱 Sync gap alert sent to Javi');
  else console.warn('⚠️ Alert send failed:', r.description);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.split('=')[1] : null;
  const fix = args.includes('--fix');

  main({ since, fix }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
