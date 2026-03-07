const https = require('https');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const entries = await fetchJson(`${NS_URL}/api/v1/entries.json?count=10000`);
  console.log("Total entries:", entries.length);
  console.log("Earliest entry:", entries[entries.length-1].dateString, entries[entries.length-1].date);
  console.log("Latest entry:", entries[0].dateString, entries[0].date);

  const mealTime = "2026-02-26T09:31:00.000-08:00";
  const target = new Date(mealTime).getTime();
  console.log("Target Meal Time:", mealTime, target);
}

main();
