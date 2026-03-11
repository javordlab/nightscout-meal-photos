const https = require('https');

const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";

async function nsRequest(method, endpoint, body = null) {
  const url = `${NIGHTSCOUT_URL}${endpoint}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'api-secret': NIGHTSCOUT_SECRET,
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(url, options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve(d); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const entries = [
  { iso: "2026-03-10T10:22:00-07:00", text: "Snack: Small handful of goji berries [📷](https://iili.io/q5dLMCX.jpg)", carbs: 12, cals: 110 },
  { iso: "2026-03-10T10:05:00-07:00", text: "Breakfast: Cheese, prosciutto, bread, kiwi, and milk (~35g carbs, ~380 kcal)", carbs: 35, cals: 380 }
];

async function main() {
  for (const e of entries) {
    console.log(`Backfilling missing NS: ${e.iso}`);
    await nsRequest("POST", "/api/v1/treatments.json", {
      enteredBy: "Javordclaw-SyncGuard",
      eventType: "Meal Bolus",
      carbs: e.carbs,
      notes: `${e.text} (~${e.carbs}g carbs, ~${e.cals} kcal)`,
      created_at: e.iso
    });
  }
  console.log("Backfill complete.");
}
main();
