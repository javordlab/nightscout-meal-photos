#!/usr/bin/env node
// validate_sync.js - Validates sync state integrity

const fs = require('fs');
const path = require('path');

const SYNC_STATE_PATH = path.join(__dirname, '..', 'data', 'sync_state.json');
const NORMALIZED_PATH = path.join(__dirname, '..', 'data', 'health_log.normalized.json');

function validate() {
  console.log('🔍 Validating sync state...\n');
  
  const state = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  
  let issues = [];
  let stats = {
    total: 0,
    withNotion: 0,
    withNightscout: 0,
    withBoth: 0,
    duplicates: 0
  };

  // Check for duplicates in normalized entries
  const seenKeys = new Set();
  for (const entry of normalized.entries) {
    if (seenKeys.has(entry.entryKey)) {
      issues.push(`Duplicate entry key: ${entry.entryKey}`);
      stats.duplicates++;
    }
    seenKeys.add(entry.entryKey);
  }

  // Validate sync state entries
  for (const [key, val] of Object.entries(state.entries)) {
    stats.total++;
    
    if (val.notion?.page_id) {
      stats.withNotion++;
    }
    if (val.nightscout?.treatment_id) {
      stats.withNightscout++;
    }
    if (val.notion?.page_id && val.nightscout?.treatment_id) {
      stats.withBoth++;
    }
    
    // Check for orphaned entries (have sync state but no matching log entry)
    if (!seenKeys.has(key)) {
      issues.push(`Orphaned sync state entry: ${key}`);
    }
  }

  console.log('📊 Statistics:');
  console.log(`  Total sync state entries: ${stats.total}`);
  console.log(`  With Notion page_id: ${stats.withNotion}`);
  console.log(`  With Nightscout treatment_id: ${stats.withNightscout}`);
  console.log(`  With both systems: ${stats.withBoth}`);
  console.log(`  Duplicates found: ${stats.duplicates}`);
  console.log();
  
  if (issues.length > 0) {
    console.log('❌ Issues found:');
    issues.forEach(issue => console.log(`  - ${issue}`));
    process.exit(1);
  }
  
  console.log('✅ Validation passed!\n');
}

validate();
