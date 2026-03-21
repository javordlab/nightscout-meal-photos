const https = require('https');

const NOTION_KEY = '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';

async function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: path,
      method: method,
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

async function run() {
  console.log('🔍 Searching for the page with title containing salmon...');
  const res = await notionRequest('POST', '/v1/search', {
    query: 'salmon'
  });

  const page = res.results.find(p => {
     const title = p.properties?.Entry?.title?.[0]?.plain_text || '';
     return title.includes('Lunch: Smoked salmon');
  });

  if (!page) {
    console.error('Page not found!');
    return;
  }

  console.log(`Found page ID: ${page.id}`);
  
  console.log('💎 Updating columns...');
  const patchRes = await notionRequest('PATCH', `/v1/pages/${page.id}`, {
    properties: {
      'Carbs (est)': { number: 33 },
      'Calories (est)': { number: 300 },
      'Protein (est)': { number: 17 }
    }
  });

  if (patchRes.id) {
    console.log('✅ Update successful.');
  } else {
    console.error('Update failed:', patchRes);
  }
}

run().catch(console.error);
