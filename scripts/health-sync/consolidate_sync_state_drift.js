#!/usr/bin/env node
// consolidate_sync_state_drift.js — one-time + maintenance sweep for entry_key drift.
//
// Problem (2026-06-10): sync_state.json is keyed by content-hash entry_key. Normal
// SSoT edits (title rewrites, "(cont.)" merges, retro-timestamp notes) change the
// hash, so radial_dispatcher upserts a NEW record per revision and never prunes the
// old one. Result: ~485 stale sibling records, each pair sharing a notion.page_id —
// the source of the daily 9:10 AM "Sync Audit Gap" alert (264 false collisions +
// ~220 false missing-link warnings).
//
// What it does, per (timestamp, user, category) group of sync_state records:
//   - exactly 1 normalized SSoT entry in the group → that entry's key is the
//     canonical target. Merge NS/Notion/gallery IDs + outcomes flag from stale
//     siblings into the target record, then DELETE the siblings.
//   - 0 normalized entries (pure-orphan group, e.g. entry re-timestamped later)
//     → delete a record ONLY if its notion.page_id or nightscout.treatment_id is
//     also held by a canonical record elsewhere (proves it's a drift remnant of an
//     entry that still exists). Other orphans are left untouched and reported.
//   - ≥2 normalized entries (ambiguous attribution) → skip, report.
//   - Conflicting live IDs within a group (two different page_ids / treatment_ids
//     and the target already holds one) → no deletion for that group, report.
//
// Dry-run by default. --apply writes (after backing up sync_state.json).
// Report always written to data/sync_state_consolidation_report.json.
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NOTION_KEY = process.env.NOTION_KEY || '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';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const REPORT_PATH = path.join(WORKSPACE, 'data', 'sync_state_consolidation_report.json');

const { loadSyncState, saveSyncState } = require('./sync_state');

function groupKey(ts, user, category) {
  return `${ts}|${user}|${category}`;
}

function normalizeNotionIso(iso) {
  return (iso || '').replace(/\.\d+/, '');
}

// Same shape as audit_health_sync.js's presence check: live page + its Date/User.
function fetchNotionPagePresence(pageId) {
  return new Promise((resolve) => {
    const options = {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28' }
    };
    const req = https.request(`https://api.notion.com/v1/pages/${pageId}`, options, (res) => {
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
          } else resolve({ exists: false, archived: false, date: null, user: null });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Conflict groups hold ≥2 distinct page_ids (dup-page incidents: one page was
// usually archived later). Pick the unique LIVE page whose Date+User match the
// entry. Returns { winner } or { unresolved: reason, live: [...] }.
async function resolvePageConflict(candidateIds, ts, user) {
  const live = [];
  for (const pid of candidateIds) {
    const p = await fetchNotionPagePresence(pid);
    if (p === null) return { unresolved: 'notion_fetch_error', live: [] };
    if (p.exists && !p.archived && p.date === ts && p.user === user) live.push(pid);
  }
  if (live.length === 1) return { winner: live[0] };
  return { unresolved: live.length === 0 ? 'no_live_matching_page' : 'multiple_live_pages', live };
}

async function main({ apply }) {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const state = loadSyncState(SYNC_STATE_PATH);
  const records = state.entries;

  // Index normalized entries by (ts, user, category)
  const normByGroup = new Map();
  for (const e of normalized.entries || []) {
    const k = groupKey(e.timestamp, e.user, e.category);
    if (!normByGroup.has(k)) normByGroup.set(k, []);
    normByGroup.get(k).push(e);
  }

  // Group sync_state records the same way (key order = insertion order, so the
  // last record in a group is the most recently written — used as tiebreaker).
  const recByGroup = new Map();
  for (const [key, rec] of Object.entries(records)) {
    const k = groupKey(rec.timestamp, rec.user, rec.category);
    if (!recByGroup.has(k)) recByGroup.set(k, []);
    recByGroup.get(k).push([key, rec]);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    totals: { recordsBefore: Object.keys(records).length },
    merged: [],            // groups consolidated onto a canonical key
    deletions: [],         // every record deleted (with its IDs, for traceability)
    orphanRemnantsDeleted: [], // pass-2: cross-timestamp drift remnants
    orphansKept: [],       // pure orphans we did NOT touch
    ambiguousSkipped: [],  // ≥2 normalized entries in group
    conflicts: []          // disagreeing live IDs — no deletion performed
  };

  // ── Pass 1: consolidate drift siblings onto the canonical entry key ────────
  for (const [gk, recs] of recByGroup) {
    const normEntries = normByGroup.get(gk) || [];
    if (normEntries.length === 0) continue; // pass 2 handles orphan groups
    if (normEntries.length >= 2) {
      if (recs.length > normEntries.length) {
        report.ambiguousSkipped.push({ group: gk, syncRecords: recs.length, normalizedEntries: normEntries.length });
      }
      continue;
    }

    const canonical = normEntries[0].entryKey;
    const siblings = recs.filter(([k]) => k !== canonical);
    if (siblings.length === 0) continue; // already 1:1

    const target = records[canonical] || {
      timestamp: normEntries[0].timestamp,
      user: normEntries[0].user,
      category: normEntries[0].category,
      title: (normEntries[0].title || '').slice(0, 200)
    };

    let resolvedConflict = null;
    // Collect candidate IDs from siblings (last-written wins among siblings).
    const sibPageIds = [...new Set(siblings.map(([, r]) => r.notion?.page_id).filter(Boolean))];
    const sibNsIds = [...new Set(siblings.map(([, r]) => r.nightscout?.treatment_id).filter(Boolean))];

    const pageConflict = (sibPageIds.length > 1) ||
      (target.notion?.page_id && sibPageIds.length === 1 && sibPageIds[0] !== target.notion.page_id);
    const nsConflict = (sibNsIds.length > 1) ||
      (target.nightscout?.treatment_id && sibNsIds.length === 1 && sibNsIds[0] !== target.nightscout.treatment_id);

    if (nsConflict) {
      report.conflicts.push({
        group: gk, canonical, kind: 'nightscout',
        targetTreatmentId: target.nightscout?.treatment_id || null,
        siblingTreatmentIds: sibNsIds,
        siblings: siblings.map(([k]) => k)
      });
      continue; // report only — never delete when NS IDs disagree
    }

    if (pageConflict) {
      // Disagreeing page_ids = dup-page incident remnant. Ask Notion which one
      // is actually live for this (Date, User); that one wins.
      const candidates = [...new Set([target.notion?.page_id, ...sibPageIds].filter(Boolean))];
      const res = await resolvePageConflict(candidates, normEntries[0].timestamp, normEntries[0].user);
      if (!res.winner && res.unresolved === 'multiple_live_pages') {
        // Genuine live Notion duplicates. Consolidate sync_state onto the record
        // the dispatcher currently reads/writes (the canonical target if its page
        // is among the live ones, else the most recently written sibling's), and
        // surface the dupe set for a SEPARATE reviewed archival pass — this
        // script never archives Notion pages (see 2026-04-08 runaway-archival).
        const targetLive = target.notion?.page_id && res.live.includes(target.notion.page_id);
        res.winner = targetLive ? target.notion.page_id
          : res.live[res.live.length - 1];
        report.notionDupes = report.notionDupes || [];
        report.notionDupes.push({ group: gk, canonical, livePages: res.live, keptInSyncState: res.winner });
      }
      if (!res.winner) {
        report.conflicts.push({
          group: gk, canonical, kind: 'notion',
          reason: res.unresolved, livePages: res.live,
          targetPageId: target.notion?.page_id || null,
          siblingPageIds: sibPageIds,
          siblings: siblings.map(([k]) => k)
        });
        continue;
      }
      const srcRec = [target, ...siblings.map(([, r]) => r)]
        .filter(r => r.notion?.page_id === res.winner).pop();
      target.notion = { ...srcRec.notion };
      resolvedConflict = { winner: res.winner, losers: candidates.filter(c => c !== res.winner) };
    }

    // Merge: target's own fields win; fill gaps from the newest sibling.
    const newestSib = siblings[siblings.length - 1][1];
    if (!target.notion?.page_id && sibPageIds.length === 1) {
      const src = siblings.filter(([, r]) => r.notion?.page_id).pop()[1];
      target.notion = { ...src.notion };
    }
    if (!target.nightscout?.treatment_id && sibNsIds.length === 1) {
      const src = siblings.filter(([, r]) => r.nightscout?.treatment_id).pop()[1];
      target.nightscout = { ...src.nightscout };
    }
    if (!target.gallery?.gallery_id) {
      const src = siblings.filter(([, r]) => r.gallery?.gallery_id).pop();
      if (src) target.gallery = { ...src[1].gallery };
    }
    if (!target.outcomes_backfilled && siblings.some(([, r]) => r.outcomes_backfilled)) {
      target.outcomes_backfilled = true;
    }
    if ((!target.photo_urls || target.photo_urls.length === 0) && newestSib.photo_urls?.length) {
      target.photo_urls = newestSib.photo_urls;
    }
    if (!target.meal_type && newestSib.meal_type) target.meal_type = newestSib.meal_type;
    if (!target.content_hash && newestSib.content_hash) target.content_hash = newestSib.content_hash;

    records[canonical] = target;
    for (const [k, r] of siblings) {
      report.deletions.push({
        key: k, group: gk,
        page_id: r.notion?.page_id || null,
        treatment_id: r.nightscout?.treatment_id || null
      });
      delete records[k];
    }
    report.merged.push({ group: gk, canonical, siblingsDeleted: siblings.length, ...(resolvedConflict ? { resolvedPageConflict: resolvedConflict } : {}) });
  }

  // ── Pass 2: orphan groups (no SSoT entry at that ts/user/category) ─────────
  // A record here is a deletable drift remnant ONLY when its page_id or
  // treatment_id is also held by a surviving canonical record (i.e. the entry
  // was re-timestamped and lives on elsewhere). Anything else is left alone.
  const canonicalKeySet = new Set(
    (normalized.entries || []).map(e => e.entryKey).filter(k => records[k])
  );
  const livePageIds = new Set();
  const liveNsIds = new Set();
  for (const k of canonicalKeySet) {
    const r = records[k];
    if (r.notion?.page_id) livePageIds.add(r.notion.page_id);
    if (r.nightscout?.treatment_id) liveNsIds.add(r.nightscout.treatment_id);
  }
  for (const [gk, recs] of recByGroup) {
    if ((normByGroup.get(gk) || []).length > 0) continue;
    for (const [k, r] of recs) {
      if (!records[k]) continue; // already deleted in pass 1 (can't happen, but safe)
      const sharedPage = r.notion?.page_id && livePageIds.has(r.notion.page_id);
      const sharedNs = r.nightscout?.treatment_id && liveNsIds.has(r.nightscout.treatment_id);
      if (sharedPage || sharedNs) {
        report.orphanRemnantsDeleted.push({
          key: k, group: gk,
          page_id: r.notion?.page_id || null,
          treatment_id: r.nightscout?.treatment_id || null,
          sharedPage, sharedNs
        });
        delete records[k];
      } else {
        report.orphansKept.push({ key: k, group: gk, title: (r.title || '').slice(0, 50) });
      }
    }
  }

  report.totals.recordsAfter = Object.keys(records).length;
  report.totals.merged = report.merged.length;
  report.totals.deleted = report.deletions.length + report.orphanRemnantsDeleted.length;
  report.totals.orphansKept = report.orphansKept.length;
  report.totals.conflicts = report.conflicts.length;
  report.totals.notionDupePairs = (report.notionDupes || []).length;
  report.totals.ambiguousSkipped = report.ambiguousSkipped.length;

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  if (apply) {
    const backup = `${SYNC_STATE_PATH}.bak.${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
    fs.copyFileSync(SYNC_STATE_PATH, backup);
    saveSyncState(SYNC_STATE_PATH, state);
    console.log(`Backup: ${backup}`);
    console.log(`Wrote consolidated sync_state: ${report.totals.recordsBefore} → ${report.totals.recordsAfter} records`);
  } else {
    console.log('DRY RUN — no changes written.');
  }
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Report: ${REPORT_PATH}`);
}

if (require.main === module) {
  main({ apply: process.argv.includes('--apply') }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
