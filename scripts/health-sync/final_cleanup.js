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
  // Get all pages by searching for specific terms
  const allPages = [];
  
  // Search for each duplicate
  const searches = [
    'Half apple', 'Mixed nuts', 'Smoked salmon', 'Metformin 500mg', 
    '90 minutes gardening', '3 hours heavy gardening', '20 minutes walk',
    'Half anti-acid', 'Half slice cheesecake'
  ];
  
  for (const term of searches) {
    const result = await notionSearch(term);
    const pages = result.results?.filter(p => !p.archived) || [];
    allPages.push(...pages);
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`Found ${allPages.length} total pages`);
  
  // Group by date + base title
  const byKey = {};
  allPages.forEach(p => {
    const title = p.properties?.Entry?.title?.[0]?.plain_text || 
                  p.properties?.title?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const baseTitle = title
      .replace(/\s*\(Pred:[^)]*\)\s*/g, '')
      .replace(/\s*\(BG:[^)]*\)\s*/g, '')
      .trim();
    const key = `${date}|${baseTitle}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ id: p.id, title, date, hasInfo: title.includes('Pred:') || title.includes('BG:') });
  });
  
  // Find duplicates
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`Found ${duplicates.length} duplicate groups`);
  
  // Archive the ones without Pred/BG
  let archived = 0;
  for (const [key, pages] of duplicates) {
    console.log(`\n${key}:`);
    pages.forEach((p, i) => console.log(`  [${i+1}] hasInfo:${p.hasInfo} | ${p.title.slice(0, 60)}`));
    
    // Find the one with info
    const withInfo = pages.find(p => p.hasInfo);
    const withoutInfo = pages.filter(p => !p.hasInfo);
    
    if (withInfo) {
      console.log(`  Keeping: ${withInfo.title.slice(0, 60)}`);
      for (const p of withoutInfo) {
        console.log(`  Archiving: ${p.title.slice(0, 60)}`);
        await notionArchive(p.id);
        archived++;
        await new Promise(r => setTimeout(r, 300));
      }
    } else {
      // No info on any, keep first, archive rest
      console.log(`  Keeping: ${pages[0].title.slice(0, 60)}`);
      for (let i = 1; i < pages.length; i++) {
        console.log(`  Archiving: ${pages[i].title.slice(0, 60)}`);
        await notionArchive(pages[i].id);
        archived++;
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  
  console.log(`\nArchived ${archived} duplicates`);
}

main().catch(console.error);
