const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

// Get pages by searching with the database ID as parent
function searchAllPages() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ 
      query: '',
      filter: { value: 'page', property: 'object' },
      page_size: 100 
    });
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
  const result = await searchAllPages();
  
  // Filter for pages from March 19-21 with database parent
  const pages = result.results?.filter(p => {
    const date = p.properties?.Date?.date?.start;
    const hasDbParent = p.parent?.database_id === DB_ID;
    return (date?.startsWith('2026-03-19') || date?.startsWith('2026-03-20') || date?.startsWith('2026-03-21')) && !p.archived;
  }) || [];
  
  console.log(`Found ${pages.length} pages from March 19-21`);
  
  // Group by date + base title
  const byKey = {};
  pages.forEach(p => {
    const title = p.properties?.title?.title?.[0]?.plain_text || 
                  p.properties?.Entry?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const baseTitle = title
      .replace(/\s*\(Pred:[^)]*\)\s*/g, '')
      .replace(/\s*\(BG:[^)]*\)\s*/g, '')
      .trim();
    const key = `${date}|${baseTitle}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ id: p.id, title, date });
  });
  
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`Duplicate groups: ${duplicates.length}`);
  
  // Show all entries
  console.log('\nAll entries:');
  Object.entries(byKey).forEach(([key, pages]) => {
    console.log(`\n${key}:`);
    pages.forEach((p, i) => console.log(`  [${i+1}] ${p.title.slice(0, 70)}`));
  });
  
  // Archive duplicates
  let archived = 0;
  for (const [key, pages] of duplicates) {
    pages.sort((a, b) => a.title.length - b.title.length);
    console.log(`\nArchiving for ${key}:`);
    for (let i = 0; i < pages.length - 1; i++) {
      console.log(`  -> ${pages[i].title.slice(0, 60)}`);
      await notionArchive(pages[i].id);
      archived++;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  console.log(`\nArchived ${archived} duplicates`);
}

main().catch(console.error);
