const https = require('https');

const NOTION_KEY = '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';

// The "ghost" duplicates from March 24 with the +7h offset
const PAGES_TO_DELETE = [
  '32e85ec7-0668-8134-b61e-ed8b601426b7', // Snack at 22:45 (Ghost of 15:45)
  '32d85ec7-0668-8146-9092-eed4dff3cfec', // Snack at 22:42 (Ghost of 15:42)
  '32d85ec7-0668-81c5-bc73-d763fa62de6c'  // Lunch at 19:46 (Ghost of 12:46)
];

function notionArchive(pageId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ archived: true });
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`Archived ${pageId}: ${res.statusCode}`);
        resolve(res.statusCode);
      });
    });
    req.on('error', (e) => {
      console.error(`Error archiving ${pageId}: ${e.message}`);
      resolve(0);
    });
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Archiving ${PAGES_TO_DELETE.length} ghost duplicate pages from March 24...\n`);
  for (const pageId of PAGES_TO_DELETE) {
    await notionArchive(pageId);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('\nDone.');
}

main().catch(console.error);
