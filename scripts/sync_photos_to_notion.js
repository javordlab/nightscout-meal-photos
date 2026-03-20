const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

// Today's entries with photos
const entriesToUpdate = [
  {
    date: "2026-03-19T09:48:00-07:00",
    text: "Breakfast: Ciabatta bread (~60g), avocado (~75g), prosciutto (~15g, 1 slice), milk (~1 cup) (BG: 102 mg/dL Flat) (Pred: 140-155 mg/dL @ 11:15-11:45 AM)",
    photo: "https://iili.io/qN52xM7.jpg"
  },
  {
    date: "2026-03-19T13:55:00-07:00",
    text: "Lunch: 2 pork belly bao buns, green grapes, green tea (BG: 154 mg/dL Flat) (Pred: 180-200 mg/dL @ 3:30-4:00 PM; lowered due to 3hr pre-meal gardening)",
    photo: "https://iili.io/qN52onS.jpg"
  },
  {
    date: "2026-03-19T14:07:00-07:00",
    text: "Snack: 2 dried dragon fruit slices (BG: 152 mg/dL Flat)",
    photo: "https://iili.io/qN52Ct2.jpg"
  }
];

async function notionRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        ...(data && { 'Content-Type': 'application/json' })
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
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

async function main() {
  for (const entry of entriesToUpdate) {
    console.log(`Updating: ${entry.text.substring(0, 50)}...`);
    
    // Find the entry in Notion
    const notionQuery = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
      filter: { 
        and: [ 
            { property: "Date", date: { equals: entry.date } },
            { property: "Entry", title: { contains: entry.text.substring(0, 30) } }
        ] 
      }
    });
    
    const activeResults = (notionQuery.results || []).filter(r => !r.archived);
    
    if (activeResults.length === 0) {
      console.log(`  -> Entry not found, skipping`);
      continue;
    }
    
    const existing = activeResults[0];
    const existingPhoto = existing.properties.Photo?.url;
    
    if (existingPhoto === entry.photo) {
      console.log(`  -> Photo already set, skipping`);
      continue;
    }
    
    // Update with photo
    const updateBody = {
      properties: {
        "Photo": { url: entry.photo }
      }
    };
    
    await notionRequest("PATCH", `/pages/${existing.id}`, updateBody);
    console.log(`  -> Photo updated successfully`);
  }
  
  console.log("\nDone!");
}

main().catch(console.error);
