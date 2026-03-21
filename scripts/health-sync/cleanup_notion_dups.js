const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1${path}`;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function cleanup() {
  console.log('🧹 Fetching entries for cleanup...');
  // We fetch a larger page size to catch the duplicates
  const res = await notionRequest('POST', `/databases/${DB_ID}/query`, {
    page_size: 100,
    filter: {
      date: {
        on_or_after: '2026-03-19'
      }
    }
  });

  if (!res.results) {
    console.error('Failed to fetch results:', res);
    return;
  }

  const entries = res.results;
  console.log(`Found ${entries.length} potential entries.`);

  const seen = new Map();
  const toArchive = [];

  for (const page of entries) {
    const title = page.properties?.Entry?.title?.[0]?.plain_text || 'Untitled';
    const date = page.properties?.Date?.date?.start;
    const key = `${date}|${title}`;

    if (seen.has(key)) {
      const existing = seen.get(key);
      // Logic: Keep the one with more data (carbs/cals/photo)
      const existingScore = (existing.properties?.Photo?.url ? 1 : 0) + (existing.properties?.['Carbs (est)']?.number ? 1 : 0);
      const currentScore = (page.properties?.Photo?.url ? 1 : 0) + (page.properties?.['Carbs (est)']?.number ? 1 : 0);

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
    await notionRequest('PATCH', `/pages/${id}`, { archived: true });
    // Throttling
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('✅ Cleanup finished.');
}

cleanup().catch(console.error);
