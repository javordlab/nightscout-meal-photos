const https = require('https');

const NOTION_KEY = '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';

function notionSearch(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, page_size: 100 });
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

function getBaseTitle(title) {
  // Remove (Pred: ...) and (BG: ...) from title to get base
  return title
    .replace(/\s*\(Pred:[^)]*\)\s*/g, '')
    .replace(/\s*\(BG:[^)]*\)\s*/g, '')
    .replace(/\s*\(BG:[^)]*estimated\)\s*/g, '')
    .trim();
}

async function main() {
  // Search for all March 19-21 entries
  const queries = ['2026-03-19', '2026-03-20', '2026-03-21'];
  const allPages = [];
  
  for (const query of queries) {
    const result = await notionSearch(query);
    const pages = result.results?.filter(p => {
      const date = p.properties?.Date?.date?.start;
      return (date?.startsWith('2026-03-19') || date?.startsWith('2026-03-20') || date?.startsWith('2026-03-21')) && !p.archived;
    }) || [];
    allPages.push(...pages);
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`Found ${allPages.length} pages from March 19-21`);
  
  // Group by date + base title (without Pred/BG)
  const byKey = {};
  allPages.forEach(p => {
    const title = p.properties?.Entry?.title?.[0]?.plain_text || 
                  p.properties?.title?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const baseTitle = getBaseTitle(title);
    const key = `${date}|${baseTitle}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ id: p.id, title, date });
  });
  
  // Find duplicates
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`\nFound ${duplicates.length} duplicate groups`);
  
  // Show duplicates
  duplicates.forEach(([key, pages]) => {
    console.log(`\n${key}:`);
    pages.forEach((p, i) => console.log(`  [${i+1}] ${p.title.slice(0, 60)}`));
  });
  
  // Archive duplicates - keep the one with most info (longer title usually has Pred)
  let archived = 0;
  for (const [key, pages] of duplicates) {
    // Sort by title length (longer = more info), keep last/longest
    pages.sort((a, b) => a.title.length - b.title.length);
    
    console.log(`\n${key}:`);
    console.log(`  Keeping: ${pages[pages.length-1].title.slice(0, 60)}`);
    
    for (let i = 0; i < pages.length - 1; i++) {
      console.log(`  Archiving: ${pages[i].title.slice(0, 60)}`);
      await notionArchive(pages[i].id);
      archived++;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  console.log(`\n\nArchived ${archived} duplicates`);
}

main().catch(console.error);
