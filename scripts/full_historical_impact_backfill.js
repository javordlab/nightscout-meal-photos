const https = require('https');
const fs = require('fs');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
          try {
              resolve(JSON.parse(data));
          } catch(e) {
              console.error("Failed to parse response for", url);
              resolve([]);
          }
      });
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
      res.on('end', () => resolve(JSON.parse(responseBody)));
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
      res.on('end', () => resolve(JSON.parse(responseBody)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getBgAt(entries, mealTime) {
  const target = new Date(mealTime).getTime();
  let closest = null;
  let minDiff = 25 * 60 * 1000; // 25 mins
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
  const end = start + 3.5 * 60 * 60 * 1000;
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
  let notionItems = [];
  let hasMore = true;
  let nextCursor = null;
  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28'
  };

  while (hasMore) {
    const payload = { page_size: 100 };
    if (nextCursor) payload.start_cursor = nextCursor;
    const data = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, payload, notionHeaders);
    notionItems = notionItems.concat(data.results);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;
  }

  console.log(`Auditing ${notionItems.length} Notion items...`);

  // Group missing items by date to minimize NS queries
  const itemsToFix = notionItems.filter(item => {
    const props = item.properties;
    return (props.Category && props.Category.select && props.Category.select.name === "Food") &&
           (props['BG Delta'] ? props['BG Delta'].number === null : true);
  });

  console.log(`Found ${itemsToFix.length} items needing impact data.`);

  for (const item of itemsToFix) {
    const props = item.properties;
    const dateStr = props.Date.date.start;
    const dateQuery = dateStr.split('T')[0];
    const nextDay = new Date(new Date(dateQuery).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`Fetching data for ${dateQuery} and ${nextDay}...`);
    // Query both days to cover UTC rollover
    const [entries1, entries2] = await Promise.all([
        fetchJson(`${NS_URL}/api/v1/entries.json?find[dateString][$regex]=${dateQuery}&count=1000`),
        fetchJson(`${NS_URL}/api/v1/entries.json?find[dateString][$regex]=${nextDay}&count=1000`)
    ]);
    const entries = [...entries1, ...entries2];

    const preBg = getBgAt(entries, dateStr);
    const { peakBg, peakTime } = getPeak2Hr(entries, dateStr);

    const entryTitle = props.Entry && props.Entry.title ? props.Entry.title : [];
    const titleText = entryTitle.length > 0 ? (entryTitle[0].text ? entryTitle[0].text.content : (entryTitle[0].plain_text || "Untitled")) : "Untitled";

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
      await new Promise(r => setTimeout(r, 250));
    } else {
        console.log(`Could not find sensor data for '${titleText}' (${dateStr}): Pre ${preBg}, Peak ${peakBg}`);
    }
  }
  console.log("Full backfill complete.");
}

main().catch(console.error);
