#!/usr/bin/env node
/**
 * Fix March 20 Notion entries - populate carbs, cals, and predicted fields
 */

const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

const entries = [
  {
    date: '2026-03-20T09:04:00.000-07:00',
    carbs: 25,
    cals: 300,
    predPeak: '140-160 mg/dL',
    predTime: '10:40-11:10 AM'
  },
  {
    date: '2026-03-20T09:14:00.000-07:00',
    carbs: 5.5,
    cals: 205,
    predPeak: '150-160 mg/dL',
    predTime: '11:00 AM'
  },
  {
    date: '2026-03-20T13:16:00.000-07:00',
    carbs: 22,
    cals: 290,
    predPeak: '180-200 mg/dL',
    predTime: '2:45-3:15 PM'
  },
  {
    date: '2026-03-20T13:17:00.000-07:00',
    carbs: 13,
    cals: 50,
    predPeak: '110-120 mg/dL',
    predTime: '2:45 PM'
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
      'Predicted Peak BG': { rich_text: [{ text: { content: entry.predPeak } }] },
      'Predicted Peak Time': { rich_text: [{ text: { content: entry.predTime } }] }
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
  console.log('Fixing March 20 entries in Notion...\n');
  
  for (const entry of entries) {
    process.stdout.write(`${entry.date}... `);
    try {
      const pageId = await findPage(entry.date);
      if (!pageId) {
        console.log('NOT FOUND');
        continue;
      }
      await updatePage(pageId, entry);
      console.log('UPDATED');
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  
  console.log('\nDone!');
}

main();
