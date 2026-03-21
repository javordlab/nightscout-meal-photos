const https = require('https');

const NOTION_KEY = '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';

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

// Based on browser view, archive the duplicates (the ones WITHOUT Pred/BG info)
// Keep the ones WITH Pred/BG info
const PAGES_TO_ARCHIVE = [
  // These are the pages WITHOUT (Pred: ...) that are duplicates
  '32a85ec7-0668-8176-a0a9-d0efc880631b', // Breakfast (archived already)
  // Need to find the others
];

async function main() {
  // List of page IDs from the browser view to check
  const pageIds = [
    // Protein ball
    '32a85ec7-0668-81cf-be8a-e8a37fa5274c', 
    // Half apple
    '32a85ec7-0668-8117-9993-f6bad20241c6',
    // Mixed nuts  
    '32a85ec7-0668-81db-a664-f8f620dea288',
    // Breakfast
    '32a85ec7-0668-8176-a0a9-d0efc880631b',
    // Lisinopril March 20
    '32a85ec7-0668-8129-8cbd-fabc526a5a4e',
    // 15 min walk
    '32a85ec7-0668-81ad-892a-d0b7f41466ff',
    // 90 min gardening
    '32a85ec7-0668-81a3-bd84-e5c6b6298ede',
    // 3 hr gardening  
    '32a85ec7-0668-812f-8b07-d21160474f06',
  ];
  
  console.log('Checking pages...');
  for (const id of pageIds) {
    try {
      const page = await getPage(id);
      if (page.object === 'page') {
        const title = page.properties?.title?.title?.[0]?.plain_text || 
                      page.properties?.Entry?.title?.[0]?.plain_text || 'no title';
        const date = page.properties?.Date?.date?.start || 'no date';
        console.log(`\n${id}:`);
        console.log(`  ${date} | ${title.slice(0, 60)}`);
        console.log(`  archived: ${page.archived}`);
        
        // If no Pred/BG info, archive it
        if (!page.archived && !title.includes('Pred:') && !title.includes('BG:')) {
          console.log(`  -> Archiving...`);
          await notionArchive(id);
        }
      }
    } catch (e) {
      console.log(`${id}: error - ${e.message}`);
    }
  }
  console.log('\nDone');
}

main().catch(console.error);
