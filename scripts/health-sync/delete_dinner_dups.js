const https = require('https');

const NOTION_KEY = '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';

// Get all pages with "Dinner" in title
function notionSearchAll(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, filter: { value: 'page', property: 'object' }, page_size: 100 });
    const options = {
      hostname: 'api.notion.com',
      path: '/v1/search',
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
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function notionArchive(pageId) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ archived: true });
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      res.on('end', () => resolve(res.statusCode));
      res.on('data', () => {});
    });
    req.on('error', () => resolve(0));
    req.write(data);
    req.end();
  });
}

async function main() {
  const result = await notionSearchAll('Dinner');
  
  // Group by timestamp
  const byTime = {};
  result.results?.forEach(p => {
    if (p.archived) return;
    const date = p.properties?.Date?.date?.start;
    const title = p.properties?.title?.title?.[0]?.plain_text || 
                  p.properties?.Entry?.title?.[0]?.plain_text || '';
    
    if (!byTime[date]) byTime[date] = [];
    byTime[date].push({ id: p.id, title });
  });
  
  console.log('Dinner entries by timestamp:');
  Object.entries(byTime).forEach(([time, pages]) => {
    console.log(`\n${time}: ${pages.length} pages`);
    pages.forEach((p, i) => console.log(`  [${i+1}] ${p.id}`));
  });
  
  // Archive duplicates - keep first for each timestamp
  const toArchive = [];
  Object.entries(byTime).forEach(([time, pages]) => {
    if (pages.length > 1) {
      toArchive.push(...pages.slice(1).map(p => p.id));
    }
  });
  
  console.log(`\n\nArchiving ${toArchive.length} duplicates...`);
  for (const id of toArchive) {
    await notionArchive(id);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Done');
}

main().catch(console.error);
