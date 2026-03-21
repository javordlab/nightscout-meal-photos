#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');

const NIGHTSCOUT_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const { loadSyncState, saveSyncState, upsertEntry } = require('./sync_state');

function nsRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${NIGHTSCOUT_URL}${endpoint}`;
    const options = {
      method: 'GET',
      headers: {
        'api-secret': NIGHTSCOUT_SECRET,
        'Content-Type': 'application/json'
      }
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

async function main() {
  const state = loadSyncState(SYNC_STATE_PATH);
  const entries = Object.entries(state.entries);

  // Find entries missing nightscout treatment_id but having notion page_id
  const missingNs = entries.filter(([key, entry]) => {
    return !entry.nightscout?.treatment_id && entry.notion?.page_id;
  });

  console.log(`Found ${missingNs.length} entries with Notion but no Nightscout link`);

  // Query Nightscout for recent treatments (last 48 hours)
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const treatments = await nsRequest(`/api/v1/treatments.json?find[created_at][$gte]=${since}&count=200`);

  console.log(`Fetched ${treatments.length} treatments from Nightscout`);

  // Match by entry_key in notes
  const entryKeyRegex = /\[entry_key:([^\]]+)\]/;
  let matched = 0;

  for (const [entryKey, entry] of missingNs) {
    const match = treatments.find(t => {
      const m = t.notes?.match(entryKeyRegex);
      return m && m[1] === entryKey;
    });

    if (match) {
      upsertEntry(state, entryKey, {
        nightscout: {
          treatment_id: match._id,
          last_synced_at: new Date().toISOString()
        }
      });
      matched++;
      console.log(`Matched: ${entryKey.slice(0, 20)}... -> ${match._id}`);
    }
  }

  saveSyncState(SYNC_STATE_PATH, state);
  console.log(`Backfilled ${matched} treatment IDs`);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
