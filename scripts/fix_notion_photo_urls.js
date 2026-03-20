const https = require('https');
const fs = require('fs');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

// URL mapping: old broken → new working
const urlMap = {
  'https://iili.io/7c08586f-286c-4da4-8018-f2a66b64abf7.jpg': 'https://iili.io/qN1tOZl.jpg',
  'https://iili.io/d5afb3ee-eff2-4281-a355-34796d217b29.jpg': 'https://iili.io/qN1tmcF.jpg',
  'https://iili.io/51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg': 'https://iili.io/qN1DgiN.jpg',
  'https://iili.io/70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg': 'https://iili.io/qN1b25u.jpg',
  'https://iili.io/d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg': 'https://iili.io/qN1bHg9.jpg',
  'https://iili.io/f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg': 'https://iili.io/qN1DyfS.jpg'
};

async function notionRequest(method, endpoint, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        ...(data && { 'Content-Type': 'application/json' })
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); }
      });
    }).on('error', () => resolve({})).end(data);
  });
}

async function main() {
  // Get all Food entries with photos
  let allEntries = [];
  let cursor = undefined;
  do {
    const response = await notionRequest('POST', `/databases/${DATABASE_ID}/query`, {
      filter: { and: [
        { property: 'Category', select: { equals: 'Food' } },
        { property: 'Photo', url: { is_not_empty: true } }
      ] },
      page_size: 100,
      start_cursor: cursor
    });
    if (!response.results) break;
    allEntries.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);

  console.log(`Found ${allEntries.length} entries with photos.\n`);

  // Update broken URLs
  let updated = 0;
  for (const entry of allEntries) {
    const photo = entry.properties.Photo?.url;
    if (urlMap[photo]) {
      const title = entry.properties.Entry?.title?.[0]?.plain_text || 'Untitled';
      console.log(`Updating: ${title.substring(0, 40)}...`);
      console.log(`  ${photo.substring(0, 50)}... → ${urlMap[photo]}`);
      
      await notionRequest('PATCH', `/pages/${entry.id}`, {
        properties: { Photo: { url: urlMap[photo] } }
      });
      
      updated++;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n✅ Updated ${updated} entries in Notion`);
}

main().catch(console.error);
