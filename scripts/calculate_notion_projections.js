const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function postJson(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

async function patchJson(id, props) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ properties: props });
    const options = {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(`https://api.notion.com/v1/pages/${id}`, options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Starting Projections Audit...');

  // Retroactive window: last 7 days in America/Los_Angeles business context
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const onOrAfter = sevenDaysAgo.toISOString().slice(0, 10);

  const response = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: 'Category', select: { equals: 'Food' } },
        { property: 'Date', date: { on_or_after: onOrAfter } }
      ]
    }
  });

  if (!response.results) {
    console.error('Failed to fetch data:', response);
    return;
  }

  for (const page of response.results) {
    const props = page.properties;
    const carbs = props['Carbs (est)']?.number;
    const currentPred = props['Predicted Peak BG']?.number;
    const title = props.Entry.title[0]?.plain_text;
    const date = props.Date.date.start;

    if (currentPred == null) {
      const carbsForCalc = Number.isFinite(carbs) ? carbs : 0;

      // Logic: Baseline 120 + 3.5 per carb, capped at 300
      let predictedBg = Math.round(120 + (carbsForCalc * 3.5));
      if (predictedBg > 300) predictedBg = 300;

      // Time logic: +105 mins default
      const mealTime = new Date(date);
      const peakTime = new Date(mealTime.getTime() + 105 * 60 * 1000);

      console.log(`Calculating projection for '${title}' (${carbsForCalc}g): ${predictedBg} mg/dL`);

      await patchJson(page.id, {
        'Predicted Peak BG': { number: predictedBg },
        'Predicted Peak Time': { date: { start: peakTime.toISOString() } }
      });
    }
  }
  console.log('Projections Audit Complete.');
}
run();
