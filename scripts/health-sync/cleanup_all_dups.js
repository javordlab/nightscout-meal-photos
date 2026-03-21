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
  // Get all pages
  const result = await notionSearch('');
  
  // Filter for March 19-21, not archived
  const pages = result.results?.filter(p => {
    const date = p.properties?.Date?.date?.start;
    return (date?.startsWith('2026-03-19') || date?.startsWith('2026-03-20') || date?.startsWith('2026-03-21')) && !p.archived;
  }) || [];
  
  console.log(`Found ${pages.length} active pages from March 19-21`);
  
  // Group by date + base title (removing Pred/BG)
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
    byKey[key].push({ id: p.id, title, hasPred: title.includes('Pred:'), hasBG: title.includes('BG:') });
  });
  
  // Find duplicates
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`\nFound ${duplicates.length} duplicate groups`);
  
  // Archive the ones without Pred/BG
  let archived = 0;
  for (const [key, pages] of duplicates) {
    console.log(`\n${key}:`);
    pages.forEach((p, i) => {
      console.log(`  [${i+1}] Pred:${p.hasPred} BG:${p.hasBG} | ${p.title.slice(0, 60)}`);
    });
    
    // Keep the one with most info, archive others
    const toKeep = pages.reduce((best, p) => {
      const pScore = (p.hasPred ? 2 : 0) + (p.hasBG ? 1 : 0) + p.title.length;
      const bScore = (best.hasPred ? 2 : 0) + (best.hasBG ? 1 : 0) + best.title.length;
      return pScore > bScore ? p : best;
    });
    
    console.log(`  Keeping: ${toKeep.title.slice(0, 60)}`);
    
    for (const p of pages) {
      if (p.id !== toKeep.id) {
        console.log(`  Archiving: ${p.title.slice(0, 60)}`);
        await notionArchive(p.id);
        archived++;
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  
  console.log(`\nArchived ${archived} duplicates`);
  
  // Show remaining unique
  console.log('\nRemaining unique entries:');
  Object.entries(byKey).forEach(([key, pages]) => {
    const remaining = pages.filter(p => !p.archived);
    if (remaining.length > 0) {
      console.log(`  1x | ${key}`);
    }
  });
}

main().catch(console.error);
