const https = require('https');
const NOTION_KEY = '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';

function notionRequest(path, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: path,
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
  const dbIdHyphenated = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
  const dbIdNoHyphens = dbIdHyphenated.replace(/-/g, '');
  
  console.log('Trying with hyphens:', dbIdHyphenated);
  const result1 = await notionRequest(`/v1/databases/${dbIdHyphenated}/query`, { page_size: 10 });
  console.log('Result:', result1.object || result1.error?.code || 'unknown');
  if (result1.results) console.log('  Count:', result1.results.length);
  
  console.log('\nTrying without hyphens:', dbIdNoHyphens);
  const result2 = await notionRequest(`/v1/databases/${dbIdNoHyphens}/query`, { page_size: 10 });
  console.log('Result:', result2.object || result2.error?.code || 'unknown');
  if (result2.results) console.log('  Count:', result2.results.length);
}

main().catch(console.error);
