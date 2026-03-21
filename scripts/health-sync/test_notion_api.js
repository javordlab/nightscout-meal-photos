const https = require('https');
const NOTION_KEY = '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';

function notionGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03'
      }
    };
    
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const dbId = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
  
  console.log('Fetching database info...');
  const info = await notionGet(`/v1/databases/${dbId}`);
  console.log('Info result:', info.object || info.status, info.id ? 'ID present' : 'no ID');
  if (info.error) console.log('Error:', info.error);
  
  // Now try query with POST
  console.log('\nTrying database query with POST...');
  const query = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ page_size: 10 });
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/databases/${dbId}/query`,
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
        try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  
  console.log('Query result:', query.object || query.status);
  if (query.results) console.log('Count:', query.results.length);
  if (query.error) console.log('Error:', JSON.stringify(query.error, null, 2));
  console.log('Full query response:', JSON.stringify(query, null, 2).slice(0, 1000));
}

main().catch(console.error);
