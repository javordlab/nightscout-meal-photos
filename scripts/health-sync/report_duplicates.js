#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const REPORT_PATH = path.join(WORKSPACE, 'data', 'health_sync_duplicates_report.json');

function main() {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const groups = new Map();

  for (const entry of normalized.entries || []) {
    if (!groups.has(entry.entryKey)) groups.set(entry.entryKey, []);
    groups.get(entry.entryKey).push({
      line: entry.source.line,
      timestamp: entry.timestamp,
      title: entry.title,
      photoUrls: entry.photoUrls
    });
  }

  const duplicates = [];
  for (const [entryKey, entries] of groups.entries()) {
    if (entries.length > 1) {
      duplicates.push({ entryKey, count: entries.length, entries });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    duplicateGroups: duplicates.length,
    duplicates
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Duplicate report complete. duplicateGroups=${duplicates.length}`);
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
