const https = require('https');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const { loadSyncState, saveSyncState, upsertEntry } = require('./sync_state');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

function nsRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${NS_URL}${endpoint}`;
    const options = { headers: { 'api-secret': NS_SECRET } };
    https.get(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '[]')); } catch { resolve([]); }
      });
    }).on('error', reject);
  });
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function main() {
  const state = loadSyncState(SYNC_STATE_PATH);
  const entries = Object.entries(state.entries);
  
  // Get treatments from March 20-21
  const treatments = await nsRequest('/api/v1/treatments.json?find[created_at][$gte]=2026-03-20&count=100');
  
  console.log(`Found ${treatments.length} treatments`);
  console.log(`Found ${entries.length} sync state entries`);
  
  let matched = 0;
  
  for (const [entryKey, entry] of entries) {
    if (entry.nightscout?.treatment_id) continue; // Already linked
    
    // Find matching treatment by timestamp
    const entryTime = new Date(entry.timestamp).getTime();
    const match = treatments.find(t => {
      const tTime = new Date(t.created_at).getTime();
      const timeDiff = Math.abs(tTime - entryTime);
      return timeDiff < 60 * 1000; // Within 1 minute
    });
    
    if (match) {
      upsertEntry(state, entryKey, {
        nightscout: {
          treatment_id: match._id,
          last_synced_at: new Date().toISOString()
        }
      });
      matched++;
      console.log(`Matched: ${entry.title?.slice(0, 40)} -> ${match._id}`);
    }
  }
  
  saveSyncState(SYNC_STATE_PATH, state);
  console.log(`\nBackfilled ${matched} treatment IDs`);
}

main().catch(console.error);
