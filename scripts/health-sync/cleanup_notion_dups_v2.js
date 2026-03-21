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

async function main() {
  // Search for all March 19-21 entries
  const queries = ['Rosuvastatin', 'Lisinopril', 'Protein ball', 'Half apple', 'Prosciutto', 'Mixed nuts', 'Smoked salmon', 'walk uphill', 'Pork and rice'];
  
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
  
  // Group by date+title
  const byKey = {};
  allPages.forEach(p => {
    const title = p.properties?.Entry?.title?.[0]?.plain_text || 
                  p.properties?.title?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const key = `${date}|${title}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(p);
  });
  
  // Find duplicates
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`\nFound ${duplicates.length} duplicate groups`);
  
  // Archive duplicates
  let archived = 0;
  for (const [key, pages] of duplicates) {
    console.log(`\n${key}:`);
    console.log(`  ${pages.length} copies`);
    console.log(`  Keeping: ${pages[0].id}`);
    
    for (let i = 1; i < pages.length; i++) {
      console.log(`  Archiving: ${pages[i].id}`);
      await notionArchive(pages[i].id);
      archived++;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  console.log(`\n\nArchived ${archived} duplicates`);
  
  // Show remaining unique entries
  console.log('\nUnique entries after cleanup:');
  Object.entries(byKey).forEach(([key, pages]) => {
    console.log(`  1x | ${key}`);
  });
}

main().catch(console.error);
