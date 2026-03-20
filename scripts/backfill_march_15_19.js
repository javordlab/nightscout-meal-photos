const https = require('https');

const NOTION_KEY = "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";
const DATA_SOURCE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";

async function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = ''; res.on('data', (c) => data += c); res.on('end', () => resolve(JSON.parse(data || '[]')));
    });
  });
}

async function postJson(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(url, options, (res) => { let body = ''; res.on('data', (c) => body += c); res.on('end', () => resolve(JSON.parse(body || '{}'))); });
    req.write(data); req.end();
  });
}

async function patchJson(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'PATCH', headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(url, options, (res) => { let body = ''; res.on('data', (c) => body += c); res.on('end', () => resolve(JSON.parse(body || '{}'))); });
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
  console.log('Starting March 15-19 Impact Backfill...');
  const nsEntries = await fetchJson(`${NS_URL}/api/v1/entries.json?count=5000`);
  
  // Fetch all Food entries from March 15 onwards
  let allFood = [];
  let cursor = undefined;
  do {
    const data = await postJson(`https://api.notion.com/v1/databases/${DATA_SOURCE_ID}/query`, { 
      filter: { 
        and: [
          { property: 'Category', select: { equals: 'Food' } },
          { property: 'Date', date: { on_or_after: '2026-03-15' } }
        ]
      },
      start_cursor: cursor,
      page_size: 100
    });
    if (!data.results) break;
    allFood.push(...data.results);
    cursor = data.next_cursor;
  } while (cursor);

  console.log(`Found ${allFood.length} Food entries from March 15+`);

  for (const item of allFood) {
    if (item.archived) continue;
    const props = item.properties;
    
    const titleText = props.Entry.title[0]?.plain_text;
    const dateStr = props.Date.date.start;
    
    // Skip if already has outcome data
    if (props['2hr Peak BG']?.number && props['Pre-Meal BG']?.number) {
      console.log(`Skipping (already has data): ${titleText.substring(0, 40)}`);
      continue;
    }

    const updatePayload = { properties: {} };

    // Get real peak data
    const preBg = getBgAt(nsEntries, dateStr);
    const { peakBg, peakTime } = getPeak2Hr(nsEntries, dateStr);
    
    if (preBg && peakBg && peakTime) {
      const delta = peakBg - preBg;
      const timeToPeak = Math.round((new Date(peakTime) - new Date(dateStr)) / (1000 * 60));
      
      updatePayload.properties['Pre-Meal BG'] = { number: preBg };
      updatePayload.properties['2hr Peak BG'] = { number: peakBg };
      updatePayload.properties['BG Delta'] = { number: delta };
      updatePayload.properties['Peak Time'] = { date: { start: peakTime } };
      updatePayload.properties['Time to Peak (min)'] = { number: timeToPeak };
      
      // Calculate variances if predictions exist
      const predPeakBg = props['Predicted Peak BG']?.number;
      const predPeakTimeStr = props['Predicted Peak Time']?.date?.start;
      
      if (predPeakBg != null) {
        const bgVar = peakBg - predPeakBg;
        updatePayload.properties['Peak BG Delta'] = { number: bgVar };
        
        if (predPeakTimeStr) {
          const predDate = new Date(predPeakTimeStr);
          const peakDate = new Date(peakTime);
          const timeVar = Math.round((peakDate - predDate) / (1000 * 60));
          updatePayload.properties['Peak Time Delta (min)'] = { number: timeVar };
        }
      }

      console.log(`✓ Updated '${titleText.substring(0, 40)}': Pre ${preBg}, Peak ${peakBg} (${delta > 0 ? '+' : ''}${delta}), Time ${timeToPeak}min`);
      await patchJson(`https://api.notion.com/v1/pages/${item.id}`, updatePayload);
    } else {
      console.log(`✗ No data for '${titleText.substring(0, 40)}': pre=${preBg}, peak=${peakBg}`);
    }
  }
  
  console.log('Backfill Complete.');
}
run();
