const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const NOTION_KEY = execSync('cat ~/.config/notion/api_key').toString().trim();
const NOTION_VERSION = "2022-06-28";
const DATA_SOURCE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        ...headers
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          reject(new Error("Failed to parse: " + responseBody));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function patchJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        ...headers
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          reject(new Error("Failed to parse: " + responseBody));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getBgAt(entries, mealTime) {
  const target = new Date(mealTime).getTime();
  let closest = null;
  let minDiff = 30 * 60 * 1000; // Increased search window
  for (const e of entries) {
    const mills = e.date || e.mills; // Use date or mills
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

async function main() {
  const nsEntries = await fetchJson(`${NS_URL}/api/v1/entries.json?count=2000`);
  
  let notionItems = [];
  let hasMore = true;
  let nextCursor = null;
  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Notion-Version': NOTION_VERSION
  };

  while (hasMore) {
    const payload = { page_size: 100 };
    if (nextCursor) payload.start_cursor = nextCursor;
    const data = await postJson(`https://api.notion.com/v1/databases/${DATA_SOURCE_ID}/query`, payload, notionHeaders);
    if (!data.results) {
        console.log("Error querying Notion:", data);
        break;
    }
    notionItems = notionItems.concat(data.results);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;
  }

  console.log(`Checking ${notionItems.length} Notion items...`);

  for (const item of notionItems) {
    const props = item.properties;
    if (!props) {
        console.log("Item missing properties:", item.id);
        continue;
    }
    // console.log("Props:", Object.keys(props));
    const category = (props.Category && props.Category.select) ? props.Category.select.name : null;
    if (category !== "Food") {
        // console.log(`Skipping '${item.id}': Not Food (${category})`);
        continue;
    }

    const bgDeltaProp = props['BG Delta'] ? props['BG Delta'].number : null;
    const dateStr = (props.Date && props.Date.date) ? props.Date.date.start : null;
    const entryTitle = props.Entry && props.Entry.title ? props.Entry.title : [];
    const titleText = entryTitle.length > 0 ? (entryTitle[0].text ? (entryTitle[0].text.content || "Untitled") : (entryTitle[0].plain_text || "Untitled")) : "Untitled";

    if (bgDeltaProp !== null) {
      console.log(`Skipping '${titleText}' (${dateStr}): Already has BG Delta: ${bgDeltaProp}`);
      continue;
    }

    if (!dateStr) {
      console.log(`Skipping '${titleText}': Missing Date`);
      continue;
    }
    const mealDate = new Date(dateStr);
    const now = new Date();
    // Only process if at least 3.5 hours have passed to ensure we have the full peak window
    if (now - mealDate < 3.5 * 60 * 60 * 1000) {
        console.log(`Waiting for peak window to close for '${titleText}' (${dateStr})...`);
        continue;
    }

    const preBg = getBgAt(nsEntries, dateStr);
    const { peakBg, peakTime } = getPeak2Hr(nsEntries, dateStr);

    if (preBg && peakBg) {
      const delta = peakBg - preBg;
      const mealDate = new Date(dateStr);
      const peakDate = new Date(peakTime);
      const timeToPeak = Math.round((peakDate - mealDate) / (1000 * 60));

      const updatePayload = {
        properties: {
          'Pre-Meal BG': { number: preBg },
          '2hr Peak BG': { number: peakBg },
          'BG Delta': { number: delta },
          'Peak Time': { date: { start: peakTime } },
          'Time to Peak (min)': { number: timeToPeak }
        }
      };

      console.log(`Updating '${titleText}' (${dateStr}): Pre ${preBg}, Peak ${peakBg}, Delta ${delta}`);
      await patchJson(`https://api.notion.com/v1/pages/${item.id}`, updatePayload, notionHeaders);
    } else {
        console.log(`Still skipping '${titleText}' (${dateStr}): Pre ${preBg}, Peak ${peakBg}`);
    }
  }
}

main().catch(console.error);
