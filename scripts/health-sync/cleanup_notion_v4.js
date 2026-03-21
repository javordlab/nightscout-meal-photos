const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

// Hardcoded list of page IDs to archive (duplicates from browser view)
// These are the pages that should be archived, keeping the one with most info
const TO_ARCHIVE = [
  // Protein ball - archive the one without Pred, keep with Pred
  // Need to find these IDs
];

function getPage(pageId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03'
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
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

// From browser view, these are the page IDs I can see
const DUPLICATE_GROUPS = [
  // Protein ball - March 20 4:13 PM
  {
    keep: '32a85ec7-0668-8176-a0a9-d0efc880631b', // with Pred
    archive: ['32985ec7-0668-8188-a5f2-eea831899b56'] // without Pred - wait this might be prosciutto
  },
  // Let me query individual pages
];

async function main() {
  // Query a known page to see if I can access them
  const testIds = [
    '32a85ec7-0668-8176-a0a9-d0efc880631b', // Protein ball from browser
    '32a85ec7-0668-81e4-97fb-e1e2ac9c789b', // Dinner 2:00 AM
    '32a85ec7-0668-81fb-bba3-f195092cae25', // Dinner 1:45 AM
  ];
  
  for (const id of testIds) {
    const page = await getPage(id);
    console.log(`\n${id}:`);
    console.log('  object:', page.object);
    if (page.object === 'page') {
      const title = page.properties?.title?.title?.[0]?.plain_text || 
                    page.properties?.Entry?.title?.[0]?.plain_text || 'no title';
      const date = page.properties?.Date?.date?.start || 'no date';
      console.log('  title:', title.slice(0, 60));
      console.log('  date:', date);
      console.log('  archived:', page.archived);
    } else {
      console.log('  error:', page.status || page.error);
    }
  }
}

main().catch(console.error);
