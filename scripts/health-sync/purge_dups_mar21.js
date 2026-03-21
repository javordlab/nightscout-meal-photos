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

async function run() {
  console.log('🧹 Fetching all March 21 entries...');
  const res = await notionPost(`/v1/databases/${DB_ID}/query`, {
    filter: {
      property: 'Date',
      date: {
        on_or_after: '2026-03-21'
      }
    }
  });

  const pages = res.results;
  console.log(`Found ${pages.length} entries for today.`);

  const seenKeys = new Set();

  for (const page of pages) {
    const title = page.properties?.Entry?.title?.[0]?.plain_text || '';
    const date = page.properties?.Date?.date?.start || '';
    
    // Logic: 
    // 1. Keep the most detailed lunch
    // 2. Keep one of each med
    // 3. Keep one breakfast
    // 4. Archive everything else.

    let keep = false;
    if (title.includes('Protein: 17g')) keep = true;
    if (title === 'Breakfast: 2 boiled eggs, 1 slice white bread, 1 small guava') keep = true;
    if (title.includes('Lisinopril') && !seenKeys.has('lisinopril')) { keep = true; seenKeys.add('lisinopril'); }
    if (title.includes('Rosuvastatin') && !seenKeys.has('rosuvastatin')) { keep = true; seenKeys.add('rosuvastatin'); }
    if (title.includes('90 minutes gardening') && !seenKeys.has('gardening')) { keep = true; seenKeys.add('gardening'); }
    
    // Special handling for the "15 minutes walk" - we only want ONE.
    if (title === '15 minutes walk' && !seenKeys.has('walk')) {
       keep = true;
       seenKeys.add('walk');
    }

    if (!keep) {
      console.log(`Archiving duplicate: ${title} (${date})`);
      const data = JSON.stringify({ archived: true });
      const options = {
        hostname: 'api.notion.com',
        port: 443,
        path: `/v1/pages/${page.id}`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Notion-Version': '2025-09-03',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };
      await new Promise(r => {
        const req = https.request(options, (res) => { res.on('end', r); res.on('data', ()=>{}); });
        req.write(data);
        req.end();
      });
    } else {
      console.log(`Keeping: ${title}`);
    }
  }
}

run().catch(console.error);
