const https = require('https');

const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

function notionRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function nsRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${NS_URL}${endpoint}`;
    const options = {
      headers: { 'api-secret': NS_SECRET }
    };
    https.get(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '[]')); } catch { resolve([]); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Recent Notion Entries ===');
  const notionResult = await notionRequest(`/databases/${NOTION_DB_ID}/query`, {
    page_size: 20,
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  
  const entries = (notionResult.results || []).map(p => ({
    id: p.id,
    date: p.properties.Date?.date?.start,
    title: p.properties.Entry?.title?.[0]?.plain_text,
    category: p.properties.Category?.select?.name,
    mealType: p.properties['Meal Type']?.select?.name
  }));
  
  // Find duplicates by title+date
  const seen = new Map();
  const duplicates = [];
  for (const e of entries) {
    const key = `${e.date}|${e.title}`;
    if (seen.has(key)) {
      duplicates.push({ first: seen.get(key), duplicate: e });
    } else {
      seen.set(key, e);
    }
  }
  
  console.log('Total recent entries:', entries.length);
  console.log('\nEntries:');
  entries.slice(0, 10).forEach(e => {
    console.log(`  ${e.date} | ${e.title?.slice(0, 40)}... | ${e.id.slice(0, 8)}...`);
  });
  
  if (duplicates.length > 0) {
    console.log('\n=== DUPLICATES FOUND ===');
    duplicates.forEach(d => {
      console.log(`\nOriginal: ${d.first.id}`);
      console.log(`Duplicate: ${d.duplicate.id}`);
      console.log(`Title: ${d.first.title}`);
    });
  }
  
  console.log('\n=== Recent Nightscout Treatments ===');
  const treatments = await nsRequest('/api/v1/treatments.json?count=50');
  const recentTreatments = treatments
    .filter(t => t.created_at && t.created_at.startsWith('2026-03'))
    .slice(0, 15);
  
  console.log('Recent treatments:', recentTreatments.length);
  recentTreatments.forEach(t => {
    const time = new Date(t.created_at).toISOString();
    const notes = t.notes?.slice(0, 40) || 'no notes';
    console.log(`  ${time} | ${t.eventType} | ${notes}... | ${t._id?.slice(0, 8)}...`);
  });
}

main().catch(console.error);
