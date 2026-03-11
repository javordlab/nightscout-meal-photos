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
        try {
          resolve(JSON.parse(d || "{}"));
        } catch (e) {
          resolve(d);
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log("Checking Nightscout for null eventType food entries...");
  const treatments = await nsRequest("GET", "/api/v1/treatments.json?find[eventType][$exists]=false&count=50");
  
  if (!Array.isArray(treatments)) {
      console.log("No treatments found or error fetching treatments.");
      return;
  }

  const foodTreatments = treatments.filter(t => t.carbs > 0 || (t.notes && t.notes.toLowerCase().includes("food")));
  
  if (foodTreatments.length === 0) {
    console.log("No null eventType food entries found.");
  } else {
    for (const t of foodTreatments) {
      console.log(`Fixing treatment ${t._id}: setting eventType to 'Meal Bolus'`);
      await nsRequest("PUT", `/api/v1/treatments.json`, {
        _id: t._id,
        eventType: "Meal Bolus"
      });
    }
  }
}

main().catch(console.error);
