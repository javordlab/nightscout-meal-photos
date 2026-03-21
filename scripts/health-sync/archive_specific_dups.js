const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function notionPost(path, body) {
  return new Promise((resolve, reject) => {
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
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); }
      });
    });
    req.on('error', reject);
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
    const req = https.request(options, (res) => { res.on('end', r); res.on('data', ()=>{}); });
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('🧹 Searching for specific duplicates...');
  
  // These are the specific IDs from the visual snapshot that are duplicates
  const duplicates = [
    '32a85ec7-0668-81cf-be8a-e8a37fa5274c', // Lunch placeholder at 8:21 PM
    '32a85ec7-0668-81a9-849a-e4ced0827c58', // Duplicate Avocado Toast at 1:21 PM
    '32a85ec7-0668-8134-a823-f27d34142266', // Duplicate Avocado Toast at 1:21 PM
    '32985ec7-0668-816a-b025-f994b29788a6', // Duplicate Avocado Toast at 1:21 PM
    '32a85ec7-0668-81bc-b984-e2dd08617cb7', // Duplicate walk at 10:56 AM
    '32a85ec7-0668-815d-accd-fd3417566e25', // Duplicate walk at 10:56 AM
    '32885ec7-0668-8185-9d37-ddc2acab57a4', // Duplicate walk at 10:56 AM
    '32a85ec7-0668-81b1-b60c-f72cae484602', // Duplicate Rosuvastatin
    '32a85ec7-0668-8193-ac9b-cd59051fb1bf'  // Duplicate Lisinopril
  ];

  for (const id of duplicates) {
    console.log(`Archiving: ${id}`);
    await archive(id);
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('✅ Specific duplicates archived.');
}

run().catch(console.error);
