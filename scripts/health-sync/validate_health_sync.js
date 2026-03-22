#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { validateEntries } = require('./quality_gates');

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

function main(options = {}) {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const since = options.since ? new Date(options.since) : null;
  const scopedEntries = (normalized.entries || []).filter((entry) => {
    if (!since) return true;
    return new Date(entry.timestamp) >= since;
  });

  const report = validateEntries(scopedEntries);

  for (const entry of scopedEntries) {
    if (entry.photoUrls) {
      for (const photo of entry.photoUrls) {
        if (!isValidUrl(photo)) {
          report.errors.push({ entryKey: entry.entryKey, reason: 'invalid_photo_url', value: photo, title: entry.title });
        }
      }
    }
  }

  report.entryCount = scopedEntries.length;

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Validation complete. errors=${report.errors.length}, warnings=${report.warnings.length}`);
  console.log(`Wrote ${REPORT_PATH}`);

  if (options.failOnError && report.errors.length > 0) {
    throw new Error(`validation_failed:${report.errors.length}`);
  }

  return report;
}

if (require.main === module) {
  try {
    const sinceArg = process.argv.find(a => a.startsWith('--since='));
    const since = sinceArg ? sinceArg.split('=')[1] : null;
    main({
      failOnError: process.argv.includes('--fail-on-error'),
      since
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { main };
