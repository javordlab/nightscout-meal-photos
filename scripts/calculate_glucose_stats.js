const https = require('https');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";

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

function calculateGMI(avg) {
  // GMI (%) = 3.31 + 0.02392 * [average glucose in mg/dL]
  return (3.31 + (0.02392 * avg)).toFixed(1);
}

async function main() {
  try {
    // 1. Last 24 Hours
    const entries24h = await fetchJson(`${NS_URL}/api/v1/entries.json?count=300`);
    const now = Date.now();
    const last24h = entries24h.filter(e => e.date > (now - 24 * 60 * 60 * 1000) && e.sgv);
    
    const count24h = last24h.length;
    const sum24h = last24h.reduce((s, e) => s + e.sgv, 0);
    const avg24h = count24h > 0 ? sum24h / count24h : 0;
    
    const inRange = last24h.filter(e => e.sgv >= 70 && e.sgv <= 180).length;
    const tir24h = count24h > 0 ? (inRange / count24h * 100).toFixed(0) : 0;
    const gmi24h = avg24h > 0 ? calculateGMI(avg24h) : "N/A";

    // 2. 14-day rolling (approx 4032 entries for 14 days at 5m intervals)
    const entries14d = await fetchJson(`${NS_URL}/api/v1/entries.json?count=4500`);
    const last14d = entries14d.filter(e => e.date > (now - 14 * 24 * 60 * 60 * 1000) && e.sgv);
    const count14d = last14d.length;
    const sum14d = last14d.reduce((s, e) => s + e.sgv, 0);
    const avg14d = count14d > 0 ? sum14d / count14d : 0;
    const gmi14d = avg14d > 0 ? calculateGMI(avg14d) : "N/A";

    console.log(JSON.stringify({
      last24h: {
        avg: avg24h.toFixed(0),
        tir: tir24h,
        gmi: gmi24h
      },
      rolling14d: {
        gmi: gmi14d
      }
    }, null, 2));

  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
