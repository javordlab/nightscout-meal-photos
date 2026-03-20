#!/usr/bin/env node
/**
 * Backfill March 20 entries specifically
 */

const https = require('https');

const NOTION_KEY = "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";
const DATA_SOURCE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NS_SECRET_HASH = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";

async function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { headers };
    if (url.includes('code.run') && !headers['api-secret']) {
      options.headers = { ...options.headers, 'api-secret': NS_SECRET_HASH };
    }
    https.get(url, options, (res) => {
      let data = ''; 
      res.on('data', (c) => data += c); 
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '[]'));
        } catch (e) {
          console.error(`Error parsing JSON from ${url}:`, e.message);
          resolve([]);
        }
      });
    }).on('error', reject);
  });
}

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(url, options, (res) => { 
      let body = ''; 
      res.on('data', (c) => body += c); 
      res.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function patchJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'PATCH', headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(url, options, (res) => { 
      let body = ''; 
      res.on('data', (c) => body += c); 
      res.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function getBgAt(entries, mealTime) {
  const target = new Date(mealTime).getTime();
  let closest = null;
  let minDiff = 30 * 60 * 1000;
  for (const e of entries) {
    const mills = e.date || e.mills;
    const diff = Math.abs(mills - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = e;
    }
  }
  return closest ? closest.sgv : null;
}

function getPeak2Hr(entries, mealTime) {
  const start = new Date(mealTime).getTime();
  const end = start + 3 * 60 * 60 * 1000;
  let peakBg = 0;
  let peakTimeMs = null;
  for (const e of entries) {
    const mills = e.date || e.mills;
    if (mills >= start && mills <= end) {
      if (e.sgv > peakBg) {
        peakBg = e.sgv;
        peakTimeMs = mills;
      }
    }
  }
  return { peakBg: peakBg > 0 ? peakBg : null, peakTime: peakTimeMs ? new Date(peakTimeMs).toISOString() : null };
}

async function run() {
  console.log('Backfilling March 20 entries...');
  const nsEntries = await fetchJson(`${NS_URL}/api/v1/entries.json?count=5000`);
  console.log(`Fetched ${nsEntries.length} Nightscout entries`);
  
  // Get March 20 food entries
  const data = await postJson(`https://api.notion.com/v1/databases/${DATA_SOURCE_ID}/query`, { 
    filter: { 
      and: [
        { property: 'Date', date: { on_or_after: '2026-03-20' } },
        { property: 'Date', date: { before: '2026-03-21' } }
      ]
    }
  });

  console.log(`Found ${data.results?.length || 0} March 20 entries`);

  for (const item of data.results || []) {
    if (item.archived) continue;
    const props = item.properties;
    if (props.Category?.select?.name !== 'Food') continue;
    
    const titleText = props.Entry?.title?.[0]?.plain_text;
    const dateStr = props.Date?.date?.start;
    
    console.log(`\nProcessing: ${titleText}`);
    console.log(`  Date: ${dateStr}`);
    
    const preBg = getBgAt(nsEntries, dateStr);
    const { peakBg, peakTime } = getPeak2Hr(nsEntries, dateStr);
    
    console.log(`  Pre-meal BG: ${preBg || 'N/A'}`);
    console.log(`  Peak BG: ${peakBg || 'N/A'} @ ${peakTime || 'N/A'}`);
    
    if (preBg && peakBg) {
      const delta = peakBg - preBg;
      const timeToPeak = Math.round((new Date(peakTime) - new Date(dateStr)) / (1000 * 60));
      
      const updatePayload = {
        properties: {
          'Pre-Meal BG': { number: preBg },
          '2hr Peak BG': { number: peakBg },
          'BG Delta': { number: delta },
          'Peak Time': { date: { start: peakTime } },
          'Time to Peak (min)': { number: timeToPeak }
        }
      };
      
      // Calculate variance
      const predPeakBg = props['Predicted Peak BG']?.number;
      if (predPeakBg != null) {
        updatePayload.properties['Peak BG Delta'] = { number: peakBg - predPeakBg };
      }
      
      await patchJson(`https://api.notion.com/v1/pages/${item.id}`, updatePayload);
      console.log('  UPDATED');
    } else {
      console.log('  NO GLUCOSE DATA');
    }
  }
  console.log('\nDone!');
}
run();
