const https = require('https');
const NIGHTSCOUT_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NIGHTSCOUT_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";

function nsRequest(method, endpoint) {
  const url = `${NIGHTSCOUT_URL}${endpoint}`;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'api-secret': NIGHTSCOUT_SECRET,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(url, options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.end();
  });
}

async function test() {
  const iso = "2026-03-14T09:55:00-07:00";
  const cleanText = "Breakfast: 2 fried eggs on 1 slice of toast";
  const endpoint = `/api/v1/treatments.json?find[created_at]=${iso}&find[notes][$regex]=${encodeURIComponent(cleanText.substring(0, 20))}&count=1`;
  console.log("Testing endpoint:", endpoint);
  const resp = await nsRequest("GET", endpoint);
  console.log("Response:", resp);
  try {
    const json = JSON.parse(resp);
    console.log("Is Array:", Array.isArray(json));
  } catch (e) {
    console.log("Not JSON");
  }
}
test();
