const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';

async function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
          try {
              resolve(JSON.parse(data));
          } catch(e) {
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
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
          try {
              resolve(JSON.parse(responseBody));
          } catch(e) {
              resolve({});
          }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28'
  };

  console.log("Fetching ALL food entries with photos from Notion...");
  const notionData = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: "Category", select: { equals: "Food" } },
        { property: "Photo", url: { is_not_empty: true } }
      ]
    }
  }, notionHeaders);

  console.log(`Found ${notionData.results.length} total entries with photos.`);

  console.log("Fetching treatments from Nightscout (last 1000)...");
  const nsTreatments = await fetchJson(`${NS_URL}/api/v1/treatments.json?count=1000`, { 'api-secret': SECRET });

  for (const item of notionData.results) {
    const props = item.properties;
    const dateStr = props.Date.date.start;
    const photoUrl = props.Photo.url;
    const entryTitle = props.Entry.title[0].text.content;
    const carbs = props["Carbs (est)"].number || 0;

    const targetTime = new Date(dateStr).getTime();
    let match = nsTreatments.find(t => {
        const tTime = new Date(t.created_at).getTime();
        return Math.abs(tTime - targetTime) < 15 * 60 * 1000;
    });

    const newNotes = `${entryTitle}. 📷 ${photoUrl}`;

    if (match) {
        if (!match.notes || !match.notes.includes(photoUrl) || match.eventType !== "Meal Bolus") {
            console.log(`Updating treatment for ${entryTitle} (${dateStr})...`);
            const payload = {
                ...match,
                eventType: "Meal Bolus",
                notes: newNotes,
                carbs: carbs,
                enteredBy: "Javordclaw"
            };
            
            const putData = JSON.stringify(payload);
            const putOptions = {
                method: 'PUT',
                headers: {
                    'api-secret': SECRET,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(putData)
                }
            };
            const putReq = https.request(`${NS_URL}/api/v1/treatments.json`, putOptions, () => {});
            putReq.write(putData);
            putReq.end();
            await new Promise(r => setTimeout(r, 1000));
        }
    } else {
        console.log(`Creating missing treatment for ${entryTitle} (${dateStr})...`);
        const payload = {
            enteredBy: "Javordclaw",
            eventType: "Meal Bolus",
            carbs: carbs,
            notes: newNotes,
            created_at: dateStr
        };
        await postJson(`${NS_URL}/api/v1/treatments.json`, payload, { 'api-secret': SECRET });
        await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log("Full sync complete.");
}

main().catch(console.error);
