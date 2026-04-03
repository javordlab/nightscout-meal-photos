const https = require('https');
const fs = require('fs');

const NOTION_KEY = "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";
const DATA_SOURCE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NS_SECRET_HASH = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"; // SHA1 of JaviCare2026

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
          console.error('Response starts with:', data.substring(0, 100));
          reject(e);
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
          console.error(`Error parsing JSON from POST ${url}:`, e.message);
          console.error('Response starts with:', body.substring(0, 100));
          reject(e);
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
          console.error(`Error parsing JSON from PATCH ${url}:`, e.message);
          console.error('Response starts with:', body.substring(0, 100));
          reject(e);
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
  return { peakBg, peakTime: peakTimeMs ? new Date(peakTimeMs).toISOString() : null };
}

async function run() {
  console.log('Starting Impact Variance Audit...');
  // 576 = 48h of CGM at 5-min intervals; enough for any backfill window
  const nsEntries = await fetchJson(`${NS_URL}/api/v1/entries.json?count=576`);
  
  let results = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const res = await postJson(`https://api.notion.com/v1/databases/${DATA_SOURCE_ID}/query`, { 
      filter: { property: 'Date', date: { on_or_after: '2026-03-06' } },
      start_cursor: cursor
    });
    
    if (res.results) {
      results = results.concat(res.results);
    }
    hasMore = res.has_more;
    cursor = res.next_cursor;
    console.log(`Fetched ${results.length} entries from Notion...`);
  }

  for (const item of results) {
    if (item.archived) continue;
    const props = item.properties;
    if (props.Category.select.name !== 'Food') continue;
    
    const titleText = props.Entry.title[0]?.plain_text;
    const dateStr = props.Date.date.start;
    
    // MATURITY CHECK: Only process meals that are at least 3 hours old
    const mealTime = new Date(dateStr);
    const now = new Date();
    const ageInHours = (now - mealTime) / (1000 * 60 * 60);
    
    if (ageInHours < 3) {
      console.log(`Skipping '${titleText}' (${dateStr}): Too recent (age: ${ageInHours.toFixed(1)}h)`);
      continue;
    }

    const updatePayload = { properties: {} };

    // 1. Ensure real peak data is current
    let currentPeakBg = props['2hr Peak BG']?.number;
    let currentPeakTimeStr = props['Peak Time']?.date?.start;
    let currentPreBg = props['Pre-Meal BG']?.number;

    if (!currentPeakBg || !currentPreBg) {
        const preBg = getBgAt(nsEntries, dateStr);
        const { peakBg, peakTime } = getPeak2Hr(nsEntries, dateStr);
        if (preBg && peakBg) {
            currentPreBg = preBg;
            currentPeakBg = peakBg;
            currentPeakTimeStr = peakTime;
            const delta = peakBg - preBg;
            const timeToPeak = Math.round((new Date(peakTime) - new Date(dateStr)) / (1000 * 60));
            
            updatePayload.properties['Pre-Meal BG'] = { number: preBg };
            updatePayload.properties['2hr Peak BG'] = { number: peakBg };
            updatePayload.properties['BG Delta'] = { number: delta };
            updatePayload.properties['Peak Time'] = { date: { start: peakTime } };
            updatePayload.properties['Time to Peak (min)'] = { number: timeToPeak };
        }
    }

    // 2. Calculate Variances if predictions exist
    const predPeakBg = props['Predicted Peak BG']?.number;
    const predPeakTimeStr = props['Predicted Peak Time']?.date?.start;

    if (predPeakBg != null && currentPeakBg != null) {
      const bgVar = currentPeakBg - predPeakBg;
      updatePayload.properties['Peak BG Delta'] = { number: bgVar };
      
      if (currentPeakTimeStr && predPeakTimeStr) {
        const predDate = new Date(predPeakTimeStr);
        const peakDate = new Date(currentPeakTimeStr);
        const timeVar = Math.round((peakDate - predDate) / (1000 * 60));
        updatePayload.properties['Peak Time Delta (min)'] = { number: timeVar };
      }
    }

    if (Object.keys(updatePayload.properties).length > 0) {
        console.log(`Updating '${titleText}' (${dateStr}): Pre ${currentPreBg}, Peak ${currentPeakBg}`);
        await patchJson(`https://api.notion.com/v1/pages/${item.id}`, updatePayload);
    }
  }
  console.log('Variance Audit Complete.');
}
run();
