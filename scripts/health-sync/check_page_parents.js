const https = require('https');
const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

function notionRequest(endpoint, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      method,
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

async function main() {
  const testIds = [
    '32a85ec7-0668-81e8-92d8-c20af7379cd3',
    '32a85ec7-0668-810f-b5da-d175f3b9cde3',
    '32985ec7-0668-8188-a5f2-eea831899b56' // The one that shows in search
  ];
  
  console.log('Checking page parents:');
  for (const id of testIds) {
    const page = await notionRequest(`/pages/${id}`, null, 'GET');
    console.log(`\n${id}:`);
    console.log(`  Parent: ${JSON.stringify(page.parent)}`);
    console.log(`  Title: ${page.properties?.title?.title?.[0]?.plain_text || page.properties?.Entry?.title?.[0]?.plain_text}`);
  }
  
  // Now try the database query again with specific filter
  console.log('\n\nQuerying database with date filter for March 20+:');
  const result = await notionRequest(`/databases/${NOTION_DB_ID}/query`, {
    filter: {
      property: 'Date',
      date: {
        on_or_after: '2026-03-20'
      }
    },
    page_size: 100
  });
  
  console.log('Results:', result.results?.length || 0);
  if (result.results && result.results.length > 0) {
    result.results.slice(0, 5).forEach(p => {
      console.log(`  ${p.id} | ${p.properties?.Date?.date?.start} | ${p.properties?.Entry?.title?.[0]?.plain_text?.slice(0, 40)}`);
    });
  } else {
    console.log('No results - checking error:', result.error || 'none');
    console.log('Full result:', JSON.stringify(result, null, 2).slice(0, 500));
  }
}

main().catch(console.error);
