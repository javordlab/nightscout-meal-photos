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

const { loadSyncState } = require('./sync_state');

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

function fetchNotionPages(sinceIso) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`;
    const data = JSON.stringify({
      filter: {
        property: 'Date',
        date: { on_or_after: sinceIso }
      },
      sorts: [{ property: 'Date', direction: 'descending' }]
    });
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
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
    req.write(data);
    req.end();
  });
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
      if (!notionById.has(syncEntry.notion.page_id)) {
        issues.push({ type: 'notion_page_missing', pageId: syncEntry.notion.page_id, severity: 'error' });
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
    if (entry.category === 'Food') {
      if (syncEntry.outcomes_backfilled) {
        report.summary.outcomesBackfilled++;
      } else {
        const ageHours = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60);
        if (ageHours >= 3) {
          issues.push({ type: 'outcomes_not_backfilled', ageHours: Math.round(ageHours), severity: 'warning' });
          report.summary.missingOutcomes++;
        }
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

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  log({ op: 'audit_complete', since, discrepancies: report.discrepancies.length });

  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`\nWrote ${REPORT_PATH}`);

  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.split('=')[1] : null;

  main({ since }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
