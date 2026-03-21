const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function run() {
  console.log('🏗️ Re-creating the FINAL lunch entry...');
  const props = {
    Entry: { title: [{ text: { content: 'Lunch: Smoked salmon on bread with avocado and apple wedges (BG: 140 mg/dL ➡️) (Pred: 180-200 mg/dL @ 2:45-3:15 PM) (Protein: 17g)' } }] },
    Date: { date: { start: '2026-03-21T13:21:00-07:00' } },
    User: { select: { name: 'Maria Dennis' } },
    Category: { select: { name: 'Food' } },
    'Meal Type': { select: { name: 'Lunch' } },
    'Carbs (est)': { number: 33 },
    'Calories (est)': { number: 300 },
    'Photo': { url: 'https://iili.io/qvI0E6Q.jpg' }
  };

  const data = JSON.stringify({ parent: { database_id: DB_ID }, properties: props });
  const options = {
    hostname: 'api.notion.com',
    port: 443,
    path: '/v1/pages',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
       console.log('Status:', res.statusCode);
       console.log('Response:', d);
    });
  });
  req.write(data);
  req.end();
}

run();
