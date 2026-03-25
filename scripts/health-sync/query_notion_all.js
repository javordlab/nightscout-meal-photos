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
        'Notion-Version': '2022-06-28',
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
          if (parsed.error) {
            console.log('API Error:', parsed);
          }
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
  // Try to get database info first
  const dbInfo = await notionRequest('/databases/31685ec7-0668-813e-8b9e-c5b4d5d70fa5', null, 'GET');
  console.log('Database info:', JSON.stringify({
    title: dbInfo.title?.[0]?.plain_text,
    id: dbInfo.id,
    url: dbInfo.url
  }, null, 2));
  
  console.log('\nQuerying with no filter (sorted desc)...');
  const result = await notionRequest('/databases/31685ec7-0668-813e-8b9e-c5b4d5d70fa5/query', {
    page_size: 100,
    sorts: [
      { property: 'Date', direction: 'descending' }
    ]
  });
  
  console.log('Total results:', result.results?.length || 0);
  console.log('Has more:', result.has_more);
  
  if (result.results && result.results.length > 0) {
    console.log('\nRecent entries:');
    result.results.slice(0, 20).forEach(p => {
      const date = p.properties?.Date?.date?.start;
      const title = p.properties?.Entry?.title?.[0]?.plain_text;
      const user = p.properties?.User?.select?.name || 'Unknown';
      const category = p.properties?.Category?.select?.name || 'Unknown';
      console.log(`  ${date} | ${category.slice(0, 4)} | ${user.slice(0, 5)} | ${title?.slice(0, 40)} | ${p.id}`);
    });
    
    // Check for duplicates
    const byTitleDate = {};
    const duplicates = [];
    result.results.forEach(p => {
      const date = p.properties?.Date?.date?.start;
      const title = p.properties?.Entry?.title?.[0]?.plain_text;
      const user = p.properties?.User?.select?.name || 'Unknown';
      const key = `${date}|${user}|${title}`;
      if (byTitleDate[key]) {
        duplicates.push({ first: byTitleDate[key], duplicate: p, key });
      } else {
        byTitleDate[key] = p;
      }
    });
    
    if (duplicates.length > 0) {
      console.log('\n=== DUPLICATES ===');
      duplicates.forEach(d => {
        console.log(`\nTitle: ${d.first.properties?.Entry?.title?.[0]?.plain_text}`);
        console.log(`First:  ${d.first.id} | ${d.first.properties?.Date?.date?.start}`);
        console.log(`Dup:    ${d.duplicate.id} | ${d.duplicate.properties?.Date?.date?.start}`);
      });
    }
  }
}

main().catch(console.error);
