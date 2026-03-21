const https = require('https');

const NOTION_KEY = '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';

async function notionRequest(method, path, body) {
  return new Promise((resolve) => {
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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('🔍 Locating ACTIVE lunch entry...');
  const search = await notionRequest('POST', '/v1/search', { query: 'salmon' });
  const activePage = search.results.find(p => !p.archived && (p.properties?.Entry?.title?.[0]?.plain_text || '').includes('Lunch'));

  if (!activePage) {
    console.error('No active lunch page found!');
    return;
  }

  console.log(`Found active page: ${activePage.id}`);
  
  const update = await notionRequest('PATCH', `/v1/pages/${activePage.id}`, {
    properties: {
      'Carbs (est)': { number: 33 },
      'Calories (est)': { number: 300 },
      'Protein (est)': { number: 17 }
    }
  });

  if (update.id) {
    console.log('✅ Updated Carbs:', update.properties['Carbs (est)'].number);
    console.log('✅ Updated Cals:', update.properties['Calories (est)'].number);
    console.log('✅ Updated Protein:', update.properties['Protein (est)'].number);
  }
}

run();
