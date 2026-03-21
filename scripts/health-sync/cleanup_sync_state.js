const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data/sync_state.json');

function loadSyncState() {
  return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
}

function saveSyncState(state) {
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

function main() {
  const state = loadSyncState();
  const entries = Object.entries(state.entries);
  
  // Group by timestamp + title (normalized)
  const byKey = new Map();
  const duplicates = [];
  
  for (const [entryKey, entry] of entries) {
    const ts = entry.timestamp;
    const title = (entry.title || '').toLowerCase().trim();
    const key = `${ts}|${title}`;
    
    if (byKey.has(key)) {
      // This is a duplicate
      const existing = byKey.get(key);
      // Keep the one with meal_type prefix in title, or the one with more complete data
      const keepExisting = (existing.title || '').includes(':') && !(entry.title || '').includes(':');
      if (keepExisting) {
        duplicates.push({ remove: entryKey, keep: existing._key });
      } else {
        duplicates.push({ remove: existing._key, keep: entryKey });
        byKey.set(key, { ...entry, _key: entryKey });
      }
    } else {
      byKey.set(key, { ...entry, _key: entryKey });
    }
  }
  
  console.log(`Found ${duplicates.length} duplicates to remove`);
  
  // Remove duplicates
  for (const dup of duplicates) {
    console.log(`Removing: ${dup.remove.slice(0, 30)}... (keeping ${dup.keep.slice(0, 30)}...)`);
    delete state.entries[dup.remove];
  }
  
  saveSyncState(state);
  console.log(`\nCleaned up. Remaining entries: ${Object.keys(state.entries).length}`);
}

main();
