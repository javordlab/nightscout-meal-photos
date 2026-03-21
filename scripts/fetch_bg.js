#!/usr/bin/env node
// fetch_bg.js - Fetch current BG from Nightscout
// Usage: node fetch_bg.js
// Returns: "117 mg/dL at 2026-03-21T10:04:00.000Z"

const https = require('https');

const NS_URL = 'p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const options = {
  hostname: NS_URL,
  path: '/api/v1/entries.json?count=1',
  headers: { 'api-secret': NS_SECRET }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const entries = JSON.parse(data);
      if (entries && entries.length > 0) {
        const entry = entries[0];
        console.log(`${entry.sgv} mg/dL at ${entry.dateString}`);
      } else {
        console.log('No BG data available');
      }
    } catch (e) {
      console.error('Error parsing response:', e.message);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Error fetching BG:', e.message);
  process.exit(1);
});

req.end();
