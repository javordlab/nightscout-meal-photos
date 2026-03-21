#!/usr/bin/env node
// repair_health_sync.js - Phase 4: repair discrepancies found by audit
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const AUDIT_REPORT_PATH = path.join(WORKSPACE, 'data', 'health_sync_audit_report.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'repair.log.jsonl');

const { loadSyncState, saveSyncState, getEntry, upsertEntry } = require('./sync_state');

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

async function main(options = {}) {
  if (!fs.existsSync(AUDIT_REPORT_PATH)) {
    console.error('No audit report found. Run audit_health_sync.js first.');
    process.exit(1);
  }

  const audit = JSON.parse(fs.readFileSync(AUDIT_REPORT_PATH, 'utf8'));
  const state = loadSyncState(SYNC_STATE_PATH);
  const dryRun = options.dryRun || false;

  const repairs = {
    cleanedStaleNsLinks: 0,
    cleanedStaleNotionLinks: 0,
    cleanedStaleGalleryLinks: 0,
    markedForOutcomes: 0,
    errors: []
  };

  for (const disc of audit.discrepancies || []) {
    for (const issue of disc.issues) {
      switch (issue.type) {
        case 'ns_treatment_missing':
          if (!dryRun) {
            const entry = getEntry(state, disc.entryKey);
            if (entry?.nightscout) {
              delete entry.nightscout;
              repairs.cleanedStaleNsLinks++;
              log({ op: 'clean_stale_ns', entryKey: disc.entryKey, treatmentId: issue.treatmentId });
            }
          } else {
            repairs.cleanedStaleNsLinks++;
          }
          break;

        case 'notion_page_missing':
          if (!dryRun) {
            const entry = getEntry(state, disc.entryKey);
            if (entry?.notion) {
              delete entry.notion;
              repairs.cleanedStaleNotionLinks++;
              log({ op: 'clean_stale_notion', entryKey: disc.entryKey, pageId: issue.pageId });
            }
          } else {
            repairs.cleanedStaleNotionLinks++;
          }
          break;

        case 'gallery_item_missing':
          if (!dryRun) {
            const entry = getEntry(state, disc.entryKey);
            if (entry?.gallery) {
              delete entry.gallery;
              repairs.cleanedStaleGalleryLinks++;
              log({ op: 'clean_stale_gallery', entryKey: disc.entryKey, galleryId: issue.galleryId });
            }
          } else {
            repairs.cleanedStaleGalleryLinks++;
          }
          break;

        case 'ns_duplicate':
          // Log for manual review - auto-deletion is risky
          log({ op: 'ns_duplicate_found', entryKey: disc.entryKey, count: issue.count, ids: issue.ids });
          break;

        case 'outcomes_not_backfilled':
          // Mark for backfill - actual backfill runs separately
          if (!dryRun) {
            upsertEntry(state, disc.entryKey, { needs_outcome_backfill: true });
            repairs.markedForOutcomes++;
            log({ op: 'mark_for_outcomes', entryKey: disc.entryKey });
          } else {
            repairs.markedForOutcomes++;
          }
          break;

        default:
          // Other issues require manual intervention or are warnings
          break;
      }
    }
  }

  if (!dryRun) {
    saveSyncState(SYNC_STATE_PATH, state);
  }

  console.log(JSON.stringify(repairs, null, 2));
  return repairs;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  main({ dryRun }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
