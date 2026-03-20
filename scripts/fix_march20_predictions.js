#!/usr/bin/env node
/**
 * Fix March 20 Notion entries - Predicted Peak BG must be NUMBER, not text
 */

const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

// Parse prediction ranges to single numbers (use midpoint)
const entries = [
  {
    date: '2026-03-20T09:04:00.000-07:00',
    carbs: 25,
    cals: 300,
    predPeak: 150,  // midpoint of 140-160
    predTime: '2026-03-20T10:45:00.000-07:00'  // midpoint of 10:40-11:10
  },
  {
    date: '2026-03-20T09:14:00.000-07:00',
    carbs: 5.5,
    cals: 205,
    predPeak: 155,  // midpoint of 150-160
    predTime: '2026-03-20T11:00:00.000-07:00'
  },
  {
    date: '2026-03-20T13:16:00.000-07:00',
    carbs: 22,
    cals: 290,
    predPeak: 190,  // midpoint of 180-200
    predTime: '2026-03-20T15:00:00.000-07:00'  // midpoint of 2:45-3:15
  },
  {
    date: '2026-03-20T13:17:00.000-07:00',
    carbs: 13,
    cals: 50,
    predPeak: 115,  // midpoint of 110-120
    predTime: '2026-03-20T14:45:00.000-07:00'  // 2:45 PM
  }
];

async function findPage(date) {
  const data = JSON.stringify({
    filter: {
      property: 'Date',
      date: { equals: date }
    }
  });

  const options = {
    hostname: 'api.notion.com',
    path: `/v1/databases/${DATABASE_ID}/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result.results?.[0]?.id);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function updatePage(pageId, entry) {
  const data = JSON.stringify({
    properties: {
      'Carbs (g)': { number: entry.carbs },
      'Calories': { number: entry.cals },
      'Predicted Peak BG': { number: entry.predPeak },
      'Predicted Peak Time': { date: { start: entry.predTime } }
    }
  });

  const options = {
    hostname: 'api.notion.com',
    path: `/v1/pages/${pageId}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Fixing March 20 entries with NUMBER predictions...\n');
  
  for (const entry of entries) {
    process.stdout.write(`${entry.date}... `);
    try {
      const pageId = await findPage(entry.date);
      if (!pageId) {
        console.log('NOT FOUND');
        continue;
      }
      await updatePage(pageId, entry);
      console.log('UPDATED (Peak=' + entry.predPeak + ', Time=' + entry.predTime + ')');
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  
  console.log('\nDone! Now run backfill to populate actual peaks.');
}

main();
