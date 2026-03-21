const https = require('https');

const NOTION_KEY = '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';

// Page IDs to archive (duplicates based on browser view)
// Keeping first occurrence, archiving rest
const TO_ARCHIVE = [
  // Rosuvastatin March 21 9:05 AM - keep first, archive 3
  '32a85ec7-0668-81fb-bba3-f195092cae25', // wait, this is dinner
  // Let me query properly first
];

function notionQueryAll() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ 
      page_size: 100,
      filter: {
        property: 'Date',
        date: {
          on_or_after: '2026-03-19'
        }
      }
    });
    const options = {
      hostname: 'api.notion.com',
      path: '/v1/databases/31685ec7-0668-813e-8b9e-c5b4d5d70fa5/query',
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
        try { resolve(JSON.parse(d)); } catch { resolve({}); }
      });
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
  console.log('Querying Notion database...');
  const result = await notionQueryAll();
  
  if (result.error) {
    console.log('Error:', result.error);
    return;
  }
  
  const entries = result.results || [];
  console.log(`Found ${entries.length} entries`);
  
  // Group by date+title
  const byKey = {};
  entries.forEach(p => {
    if (p.archived) return;
    const title = p.properties?.Entry?.title?.[0]?.plain_text || 
                  p.properties?.title?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const key = `${date}|${title}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ id: p.id, title, date });
  });
  
  // Find duplicates
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`\nFound ${duplicates.length} duplicate groups`);
  
  // Archive duplicates (keep first)
  let archived = 0;
  for (const [key, pages] of duplicates) {
    console.log(`\n${key}:`);
    console.log(`  Keeping: ${pages[0].id}`);
    for (let i = 1; i < pages.length; i++) {
      console.log(`  Archiving: ${pages[i].id}`);
      await notionArchive(pages[i].id);
      archived++;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  console.log(`\nArchived ${archived} duplicate pages`);
}

main().catch(console.error);
