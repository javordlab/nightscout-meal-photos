const https = require('https');
const NOTION_KEY = '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';

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
        try { 
          const parsed = JSON.parse(d || '{}');
          resolve(parsed);
        } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Try searching for pages
  console.log('Searching for pages...');
  const searchResult = await notionRequest('/search', {
    query: '2026-03-20',
    filter: { value: 'page', property: 'object' }
  });
  
  console.log('Search results:', searchResult.results?.length || 0);
  
  if (searchResult.results && searchResult.results.length > 0) {
    searchResult.results.slice(0, 10).forEach(p => {
      console.log(`  ${p.id} | ${p.url} | archived: ${p.archived}`);
    });
  }
  
  // Check specific pages we think exist
  const testIds = [
    '32a85ec7-0668-81e8-92d8-c20af7379cd3',
    '32a85ec7-0668-810f-b5da-d175f3b9cde3'
  ];
  
  console.log('\nChecking specific pages:');
  for (const id of testIds) {
    const page = await notionRequest(`/pages/${id}`, null, 'GET');
    console.log(`  ${id}: ${page.object || 'not found'} | archived: ${page.archived} | ${page.url || 'no url'}`);
  }
}

main().catch(console.error);
