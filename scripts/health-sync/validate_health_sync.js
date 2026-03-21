#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const REPORT_PATH = path.join(WORKSPACE, 'data', 'health_sync_validation_report.json');

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function main() {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const report = {
    generatedAt: new Date().toISOString(),
    entryCount: normalized.entryCount || 0,
    errors: [],
    warnings: []
  };

  for (const entry of normalized.entries || []) {
    if (!entry.timestamp) {
      report.errors.push({ entryKey: entry.entryKey, reason: 'missing_timestamp', title: entry.title });
    }
    if (!entry.category) {
      report.errors.push({ entryKey: entry.entryKey, reason: 'missing_category', title: entry.title });
    }
    if (entry.photoUrls) {
      for (const photo of entry.photoUrls) {
        if (!isValidUrl(photo)) {
          report.errors.push({ entryKey: entry.entryKey, reason: 'invalid_photo_url', value: photo, title: entry.title });
        }
      }
    }
    if (entry.category === 'Food' && !entry.title) {
      report.errors.push({ entryKey: entry.entryKey, reason: 'missing_food_title', title: entry.title });
    }
    if (entry.category === 'Food' && entry.carbsEst == null) {
      report.warnings.push({ entryKey: entry.entryKey, reason: 'missing_carbs_estimate', title: entry.title });
    }
    if (entry.category === 'Food' && (!entry.photoUrls || entry.photoUrls.length === 0)) {
      report.warnings.push({ entryKey: entry.entryKey, reason: 'missing_photo_urls', title: entry.title });
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Validation complete. errors=${report.errors.length}, warnings=${report.warnings.length}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
