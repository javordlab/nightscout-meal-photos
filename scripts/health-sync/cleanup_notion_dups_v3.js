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

async function notionPatch(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: path,
      method: 'PATCH',
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

async function cleanup() {
  console.log('🧹 Fetching entries via Search API (more reliable)...');
  const res = await notionPost('/v1/search', {
    query: '',
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  });

  if (!res.results) {
    console.error('Search failed:', res);
    return;
  }

  const entries = res.results.filter(p => p.parent?.database_id?.replace(/-/g, '') === DB_ID.replace(/-/g, ''));
  console.log(`Found ${entries.length} pages in target database.`);

  const seen = new Map();
  const toArchive = [];

  for (const page of entries) {
    const title = page.properties?.Entry?.title?.[0]?.plain_text || 'Untitled';
    const date = page.properties?.Date?.date?.start;
    const key = `${date}|${title}`;

    if (seen.has(key)) {
      const existing = seen.get(key);
      const existingScore = (existing.properties?.Photo?.url ? 1 : 0) + (existing.properties?.['Carbs (est)']?.number ? 1 : 0);
      const currentScore = (page.properties?.Photo?.url ? 1 : 0) + (page.properties?.['Carbs (est)']?.number ? 1 : 0);

      // Keep the one that was edited LAST (usually has the backfilled outcome)
      if (currentScore > existingScore) {
        toArchive.push(existing.id);
        seen.set(key, page);
      } else {
        toArchive.push(page.id);
      }
    } else {
      seen.set(key, page);
    }
  }

  console.log(`Identified ${toArchive.length} duplicates to archive.`);

  for (const id of toArchive) {
     console.log(`Archiving: ${id}`);
     await notionPatch(`/v1/pages/${id}`, { archived: true });
     await new Promise(r => setTimeout(r, 200));
  }

  console.log('✅ Cleanup complete.');
}

cleanup().catch(console.error);
