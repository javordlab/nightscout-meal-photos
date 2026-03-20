const https = require('https');

const NOTION_KEY = "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";

// Duplicate IDs to delete (the -07:00 timezone versions)
const duplicateIds = [
  "32985ec7-0668-8195-9cdb-de0b20416e17",  // March 15 meatballs -07:00
  "32985ec7-0668-811d-ac8e-d973cfdadcd2",  // March 14 dessert -07:00
  "32985ec7-0668-812d-b93c-e2975b63f07b",  // March 14 dinner -07:00
  "32985ec7-0668-817c-9e05-c84c391d09eb",  // March 14 lunch -07:00
  "32985ec7-0668-8199-8577-f8acc3c412cb",  // March 14 breakfast -07:00
  "32985ec7-0668-811d-ae7a-d464e3af0782",  // March 13 dinner -07:00
  "32985ec7-0668-8138-9b87-e9230993177d",  // March 13 lunch -07:00
  "32985ec7-0668-8107-9c63-e1ad13cf9856",  // March 13 snack -07:00
  "32985ec7-0668-81ed-9054-cd66f10909f2",  // March 13 breakfast -07:00
  "32985ec7-0668-8191-8a1e-db6b30ed5553",  // March 08 cake -07:00
  "32985ec7-0668-818e-981f-e436a592cd4a"   // March 08 prosciutto -07:00
];

async function notionRequest(method, endpoint) {
  return new Promise((resolve) => {
    const options = {
      method,
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28'
      }
    };
    https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); }
      });
    }).on('error', () => resolve({})).end();
  });
}

async function archivePage(pageId) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ archived: true });
    const options = {
      method: 'PATCH',
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
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
  console.log(`Deleting ${duplicateIds.length} duplicate entries...\n`);
  
  for (const id of duplicateIds) {
    process.stdout.write(`Archiving ${id.substring(0, 20)}... `);
    const result = await archivePage(id);
    if (result.archived) {
      console.log('✅');
    } else if (result.status === 404) {
      console.log('⚠️ Already deleted');
    } else {
      console.log(`❌ ${result.message || 'Failed'}`);
    }
    // Small delay
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('\nDone. Regenerate gallery data to see changes.');
}

main();
