const https = require('https');
const fs = require('fs');

const NOTION_KEY = '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';

const PAGES_TO_DELETE = [
  // Smoked salmon - keep 32985ec7-0668-81ff-98b3-eded76ed9693
  '32a85ec7-0668-81ef-969b-df75918f1db2',
  '32a85ec7-0668-8176-a0a9-d0efc880631b',
  // Prosciutto - keep 32985ec7-0668-8188-a5f2-eea831899b56
  '32a85ec7-0668-81d4-8dfd-f6fd3cd31fd5',
  '32a85ec7-0668-8125-ac04-de97280375f2',
  // Mixed nuts - keep 32985ec7-0668-8158-9ae9-f26d94d7a024
  '32a85ec7-0668-81fa-8a9e-f84d3e1e22b4',
  '32a85ec7-0668-8182-a6b3-cc245c010b44',
  // Half apple - keep 32985ec7-0668-81dd-aa9c-fa89dcaeb479
  '32a85ec7-0668-81e6-9f38-ccd4b888b474',
  '32a85ec7-0668-81e0-a007-da99815bd520',
  // Protein ball - keep 32a85ec7-0668-8113-bc76-f9caf8f6e053
  '32a85ec7-0668-81bf-bc64-db23558b1890',
  '32a85ec7-0668-8116-9d71-f6ee11a260d8'
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
        'Notion-Version': '2025-09-03',
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
      console.log(`Error archiving ${pageId}: ${e.message}`);
      resolve(0);
    });
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Archiving ${PAGES_TO_DELETE.length} duplicate pages...\n`);
  
  for (const pageId of PAGES_TO_DELETE) {
    await notionArchive(pageId);
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('\nDone.');
}

main().catch(console.error);
