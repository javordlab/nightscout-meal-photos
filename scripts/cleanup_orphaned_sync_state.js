#!/usr/bin/env node
// cleanup_orphaned_sync_state.js - Remove orphaned entries from old key format

const fs = require('fs');
const path = require('path');

const SYNC_STATE_PATH = path.join(__dirname, '..', 'data', 'sync_state.json');
const NORMALIZED_PATH = path.join(__dirname, '..', 'data', 'health_log.normalized.json');

function cleanup() {
  console.log('🧹 Cleaning up orphaned sync state entries...\n');
  
  const state = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  
  const validKeys = new Set(normalized.entries.map(e => e.entryKey));
  const beforeCount = Object.keys(state.entries).length;
  let removed = 0;
  
  for (const key of Object.keys(state.entries)) {
    if (!validKeys.has(key)) {
      delete state.entries[key];
      removed++;
    }
  }
  
  const afterCount = Object.keys(state.entries).length;
  
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
  
  console.log(`Removed ${removed} orphaned entries`);
  console.log(`Before: ${beforeCount}, After: ${afterCount}\n`);
  console.log('✅ Cleanup complete!\n');
}

cleanup();
