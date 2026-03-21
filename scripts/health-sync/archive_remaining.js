const https = require('https');

const NOTION_KEY = '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';

// Page IDs to archive - the ones WITHOUT Pred/BG info
const TO_ARCHIVE = [
  // Half apple - keep the one WITH Pred
  '32a85ec7-0668-8176-a0a9-d0efc880631b', // This is Breakfast actually, let me check
  // Need to find correct IDs
];

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

async function main() {
  // Based on browser view, these are the IDs I need to check
  const checkIds = [
    // Half apple
    { date: '2026-03-20T13:17:00', title: 'Half apple', pred: false },
    // Mixed nuts
    { date: '2026-03-20T09:14:00', title: 'Mixed nuts', pred: false },
    // Breakfast
    { date: '2026-03-20T09:04:00', title: 'Smoked salmon', pred: false },
    // 90 min gardening
    { date: '2026-03-19T16:09:00', title: '90 minutes', pred: false },
    // Metformin
    { date: '2026-03-19T09:48:00', title: 'Metformin', pred: false },
    // 3 hr gardening
    { date: '2026-03-19T10:30:00', title: '3 hours', pred: false },
    // 20 min walk
    { date: '2026-03-18T20:55:00', title: '20 minutes', pred: false },
  ];
  
  console.log('Need to search for these and archive ones without Pred/BG');
  console.log('Let me use the search API to find all pages and group them properly');
}

main().catch(console.error);
