const https = require('https');
const fs = require('fs');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const TMP_DIR = "/Users/javier/.openclaw/workspace/tmp";

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
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
    
    // 24h data (approx 300 entries)
    const data24h = await fetchJson(`${NS_URL}/api/v1/entries.json?count=300`);
    fs.writeFileSync(`${TMP_DIR}/glucose_24h.json`, JSON.stringify(data24h));
    console.log("  -> glucose_24h.json updated.");

    // 14d data (approx 4000 entries)
    const data14d = await fetchJson(`${NS_URL}/api/v1/entries.json?count=4000`);
    fs.writeFileSync(`${TMP_DIR}/glucose_14d.json`, JSON.stringify(data14d));
    console.log("  -> glucose_14d.json updated.");

    console.log("Refresh complete.");
  } catch (error) {
    console.error("Error refreshing data:", error.message);
    process.exit(1);
  }
}

main();
