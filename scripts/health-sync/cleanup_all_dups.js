const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function notionPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: path,
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
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getBaseTitle(title) {
  // Strip (BG: ...) and (Pred: ...) and [📷]
  return title.replace(/\s*\(BG:.*?\)/g, '')
              .replace(/\s*\(Pred:.*?\)/g, '')
              .replace(/\s*\[📷\].*/g, '')
              .trim();
}

async function cleanup() {
  console.log('🧹 Running Deep Duplicate Cleanup...');
  
  const allPages = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const res = await notionPost('/v1/search', {
      query: '',
      start_cursor: cursor,
      filter: { property: 'object', value: 'page' },
      page_size: 100
    });
    
    if (!res.results) break;
    
    const dbPages = res.results.filter(p => p.parent?.database_id?.replace(/-/g, '') === DB_ID.replace(/-/g, ''));
    allPages.push(...dbPages);
    
    hasMore = res.has_more;
    cursor = res.next_cursor;
  }

  console.log(`Found ${allPages.length} total pages in database.`);

  const seen = new Map();
  const toArchive = [];

  for (const page of allPages) {
    const rawTitle = page.properties?.Entry?.title?.[0]?.plain_text || 'Untitled';
    const baseTitle = getBaseTitle(rawTitle);
    const date = page.properties?.Date?.date?.start;
    const key = `${date}|${baseTitle}`;

    if (seen.has(key)) {
      const existing = seen.get(key);
      const existingTitle = existing.properties?.Entry?.title?.[0]?.plain_text || '';
      
      // Heuristic: Keep the one with MORE data in the title (usually has Pred/BG)
      if (rawTitle.length > existingTitle.length) {
        toArchive.push(existing.id);
        seen.set(key, page);
      } else {
        toArchive.push(page.id);
      }
    } else {
      seen.set(key, page);
    }
  }

  console.log(`Identified ${toArchive.length} deep duplicates.`);

  for (const id of toArchive) {
    console.log(`Archiving duplicate: ${id}`);
    const data = JSON.stringify({ archived: true });
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: `/v1/pages/${id}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    await new Promise((resolve) => {
      const req = https.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.write(data);
      req.end();
    });
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('✅ Deep cleanup complete.');
}

cleanup().catch(console.error);
