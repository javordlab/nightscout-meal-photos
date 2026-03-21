const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function notionPost(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: path,
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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.write(data);
    req.end();
  });
}

async function archive(id) {
  const data = JSON.stringify({ archived: true });
  const options = {
    hostname: 'api.notion.com',
    port: 443,
    path: `/v1/pages/${id}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  return new Promise(r => {
    const req = https.request(options, (res) => res.on('end', r));
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('🧹 Purging all March 21 entries to reset today...');
  
  const searchRes = await notionPost('/v1/search', {
    query: 'March 21',
    filter: { property: 'object', value: 'page' }
  });

  const pages = searchRes.results.filter(p => p.parent?.database_id?.replace(/-/g, '') === DB_ID.replace(/-/g, ''));
  
  for (const page of pages) {
    console.log(`Archiving: ${page.id}`);
    await archive(page.id);
  }

  console.log('✨ Re-creating today entries...');

  const entries = [
    {
      title: 'Lunch: Smoked salmon on bread with avocado and apple wedges (BG: 140 mg/dL ➡️) (Pred: 180-200 mg/dL @ 2:45-3:15 PM) (Protein: 17g)',
      date: '2026-03-21T13:21:00-07:00',
      carbs: 33,
      cals: 300,
      protein: 17,
      mealType: 'Lunch',
      photo: 'https://iili.io/qvI0E6Q.jpg'
    },
    {
      title: 'Breakfast: 2 boiled eggs, 1 slice white bread, 1 small guava',
      date: '2026-03-21T10:03:00-07:00',
      carbs: 21,
      cals: 245,
      protein: 12,
      mealType: 'Breakfast',
      photo: 'https://iili.io/qkQfYYl.jpg'
    },
    { title: 'Rosuvastatin 10mg (Scheduled)', date: '2026-03-21T09:05:00-07:00', category: 'Medication' },
    { title: 'Lisinopril 10mg (Scheduled)', date: '2026-03-21T09:00:00-07:00', category: 'Medication' },
    { title: '90 minutes gardening', date: '2026-03-21T12:31:00-07:00', category: 'Activity' },
    { title: '15 minutes walk', date: '2026-03-21T10:56:00-07:00', category: 'Activity' }
  ];

  for (const e of entries) {
    const props = {
      Entry: { title: [{ text: { content: e.title } }] },
      Date: { date: { start: e.date } },
      User: { select: { name: 'Maria Dennis' } },
      Category: { select: { name: e.category || 'Food' } }
    };
    if (e.carbs) props['Carbs (est)'] = { number: e.carbs };
    if (e.cals) props['Calories (est)'] = { number: e.cals };
    if (e.protein) props['Protein (est)'] = { number: e.protein };
    if (e.mealType) props['Meal Type'] = { select: { name: e.mealType } };
    if (e.photo) props['Photo'] = { url: e.photo };

    const createOptions = {
      hostname: 'api.notion.com',
      port: 443,
      path: '/v1/pages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify({ parent: { database_id: DB_ID }, properties: props }))
      }
    };
    await new Promise(r => {
      const req = https.request(createOptions, (res) => res.on('end', r));
      req.write(JSON.stringify({ parent: { database_id: DB_ID }, properties: props }));
      req.end();
    });
    console.log(`Created: ${e.title}`);
  }
  
  console.log('✅ Fresh start complete.');
}

run().catch(console.error);
