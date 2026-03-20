const https = require('https');
const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

// URL mapping: old broken local URL → new working iili.io URL
const urlMap = {
  'https://javordlab.github.io/nightscout-meal-photos/uploads/d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg': 'https://iili.io/qN1DsJn.jpg',
  'https://javordlab.github.io/nightscout-meal-photos/uploads/30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg': 'https://iili.io/qN1DZbf.jpg',
  'https://javordlab.github.io/nightscout-meal-photos/uploads/4169eba5-b2a4-4d1e-9074-2c81e117627a.jpg': 'https://iili.io/qNMtfDb.jpg',
  'https://javordlab.github.io/nightscout-meal-photos/uploads/35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg': 'https://iili.io/qN1DDx4.jpg',
  'https://javordlab.github.io/nightscout-meal-photos/uploads/28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg': 'https://iili.io/qN1DbWl.jpg',
  'https://javordlab.github.io/nightscout-meal-photos/uploads/4a293f8a-2283-4c49-923b-5260d4e858fe.jpg': 'https://iili.io/qNMtA5F.jpg'
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
