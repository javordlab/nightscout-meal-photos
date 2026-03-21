const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: path,
      method: method,
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
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('🔍 Locating correct lunch entry...');
  const res = await notionRequest('POST', `/v1/databases/${DB_ID}/query`, {
    filter: {
      property: 'Entry',
      title: {
        contains: 'Lunch: Smoked salmon'
      }
    }
  });

  if (!res.results || res.results.length === 0) {
    console.error('Correct lunch entry not found!');
    return;
  }

  const pageId = res.results[0].id;
  console.log(`Found ID: ${pageId}`);

  console.log('💎 Patching macros and protein column...');
  const updateRes = await notionRequest('PATCH', `/v1/pages/${pageId}`, {
    properties: {
      'Carbs (est)': { number: 33 },
      'Calories (est)': { number: 300 },
      'Protein (est)': { number: 17 }
    }
  });

  if (updateRes.id) {
    console.log('✅ Update successful.');
    console.log('Final properties:', JSON.stringify(updateRes.properties, null, 2));
  } else {
    console.error('Update failed:', updateRes);
  }
}

run().catch(console.error);
