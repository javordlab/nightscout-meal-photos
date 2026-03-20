const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const BASE_URL = "https://javordlab.github.io/nightscout-meal-photos/uploads";

// Map old broken URLs to new GitHub-hosted URLs
const URL_MAP = {
  'https://iili.io/70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg': `${BASE_URL}/70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg`,
  'https://iili.io/d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg': `${BASE_URL}/d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg`,
  'https://iili.io/f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg': `${BASE_URL}/f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg`,
  'https://iili.io/c01f80a4-aafd-48c8-801b-72d73bc822d6.jpg': `${BASE_URL}/c01f80a4-aafd-48c8-801b-72d73bc822d6.jpg`,
  'https://iili.io/4a293f8a-2283-4c49-923b-5260d4e858fe.jpg': `${BASE_URL}/4a293f8a-2283-4c49-923b-5260d4e858fe.jpg`,
  'https://iili.io/28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg': `${BASE_URL}/28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg`,
  'https://iili.io/35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg': `${BASE_URL}/35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg`,
  'https://iili.io/4169eba5-b2a4-4d1e-9074-2c81e117627a.jpg': `${BASE_URL}/4169eba5-b2a4-4d1e-9074-2c81e117627a.jpg`,
  'https://iili.io/1bcae232-3858-47cc-8556-529a3c5f04e1.jpg': `${BASE_URL}/1bcae232-3858-47cc-8556-529a3c5f04e1.jpg`,
  'https://iili.io/30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg': `${BASE_URL}/30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg`,
  'https://iili.io/4d20a8e3-3a1a-487f-b1bd-1b711874d816.jpg': `${BASE_URL}/4d20a8e3-3a1a-487f-b1bd-1b711874d816.jpg`,
  'https://iili.io/d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg': `${BASE_URL}/d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg`,
  'https://iili.io/51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg': `${BASE_URL}/51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg`,
  'https://iili.io/3c0ba392-d087-4351-bdc9-0b62242e6899.jpg': `${BASE_URL}/3c0ba392-d087-4351-bdc9-0b62242e6899.jpg`,
  'https://iili.io/d5afb3ee-eff2-4281-a355-34796d217b29.jpg': `${BASE_URL}/d5afb3ee-eff2-4281-a355-34796d217b29.jpg`,
  'https://iili.io/7c08586f-286c-4da4-8018-f2a66b64abf7.jpg': `${BASE_URL}/7c08586f-286c-4da4-8018-f2a66b64abf7.jpg`,
  'https://iili.io/e06b4b8a-ffd9-4f21-848b-ff2ebc7603b9.jpg': `${BASE_URL}/e06b4b8a-ffd9-4f21-848b-ff2ebc7603b9.jpg`,
  'https://iili.io/7e08c360-7b67-4b12-88cf-012bacd4a479.jpg': `${BASE_URL}/7e08c360-7b67-4b12-88cf-012bacd4a479.jpg`,
  'https://iili.io/f35236b3-6f01-4e14-9fb0-0a2e95f4eaa1.jpg': `${BASE_URL}/f35236b3-6f01-4e14-9fb0-0a2e95f4eaa1.jpg`
};

async function notionRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
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

    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve(d); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Fetching Notion entries to update...');
  
  // Query all entries
  let entries = [];
  let cursor = undefined;
  
  do {
    const query = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, 
      cursor ? { start_cursor: cursor } : {}
    );
    entries.push(...(query.results || []));
    cursor = query.next_cursor;
  } while (cursor);
  
  console.log(`Found ${entries.length} total entries`);
  
  let updated = 0;
  
  for (const entry of entries) {
    const photoUrl = entry.properties.Photo?.url;
    if (!photoUrl) continue;
    
    const newUrl = URL_MAP[photoUrl];
    if (!newUrl) continue;
    
    console.log(`Updating: ${entry.properties.Entry?.title?.[0]?.plain_text?.substring(0, 50)}...`);
    
    await notionRequest("PATCH", `/pages/${entry.id}`, {
      properties: {
        "Photo": { url: newUrl }
      }
    });
    
    updated++;
  }
  
  console.log(`\nUpdated ${updated} entries in Notion`);
}

main().catch(console.error);
