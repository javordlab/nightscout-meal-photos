const https = require('https');
const fs = require('fs');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NS_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";
const TMP_DIR = "/Users/javier/.openclaw/workspace/tmp";

// Returns midnight (host timezone) for a given date offset from today (0 = today, -1 = yesterday)
function pdtMidnight(dayOffset = 0) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const today = fmt.format(new Date());
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() + dayOffset);
  const dateStr = fmt.format(d);
  // Parse as local midnight → UTC epoch
  return new Date(`${dateStr}T00:00:00`).getTime();
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'api-secret': NS_SECRET } };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '[]'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log("Refreshing glucose data files...");

    // Previous calendar day: midnight-to-midnight local time
    const dayStart = pdtMidnight(-1);
    const dayEnd   = pdtMidnight(0) - 1;
    console.log(`  -> Previous day window: ${new Date(dayStart).toISOString()} – ${new Date(dayEnd).toISOString()}`);

    const prevDayUrl = `${NS_URL}/api/v1/entries.json?find%5Bdate%5D%5B%24gte%5D=${dayStart}&find%5Bdate%5D%5B%24lte%5D=${dayEnd}&count=400`;
    const dataPrevDay = await fetchJson(prevDayUrl);
    fs.writeFileSync(`${TMP_DIR}/glucose_24h.json`, JSON.stringify(dataPrevDay));
    console.log(`  -> glucose_24h.json updated (${dataPrevDay.length} readings, prev day local).`);

    // 14d data
    const start14d = pdtMidnight(-13);
    const end14d   = pdtMidnight(0) - 1;
    const data14d = await fetchJson(`${NS_URL}/api/v1/entries.json?find%5Bdate%5D%5B%24gte%5D=${start14d}&find%5Bdate%5D%5B%24lte%5D=${end14d}&count=4500`);
    fs.writeFileSync(`${TMP_DIR}/glucose_14d.json`, JSON.stringify(data14d));
    console.log(`  -> glucose_14d.json updated (${data14d.length} readings, 14d local).`);

    console.log("Refresh complete.");
  } catch (error) {
    console.error("Error refreshing data:", error.message);
    process.exit(1);
  }
}

main();
