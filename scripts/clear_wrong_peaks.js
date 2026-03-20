#!/usr/bin/env node
/**
 * Clear wrong Peak BG values from March 20 Notion entries
 * These should be empty until actual peaks are measured
 */

const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

const entries = [
  '2026-03-20T09:04:00.000-07:00',
  '2026-03-20T09:14:00.000-07:00', 
  '2026-03-20T13:16:00.000-07:00',
  '2026-03-20T13:17:00.000-07:00'
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

async function clearPeak(pageId) {
  const data = JSON.stringify({
    properties: {
      'Peak BG': { number: null },
      'Time to Peak (min)': { number: null },
      'BG Delta': { number: null }
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
  console.log('Clearing wrong Peak BG values from March 20 entries...\n');
  
  for (const date of entries) {
    process.stdout.write(`${date}... `);
    try {
      const pageId = await findPage(date);
      if (!pageId) {
        console.log('NOT FOUND');
        continue;
      }
      await clearPeak(pageId);
      console.log('CLEARED');
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  
  console.log('\nDone! Peak BG values cleared.');
  console.log('Actual peaks will be backfilled after ~3 hours from meal time.');
}

main();
