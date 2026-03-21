const https = require('https');

const NOTION_KEY = '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';

const PAGES_TO_ARCHIVE = [
  // March 18 walk - keep 32a85ec7-0668-811d-a0b3-ee72eca767be (first)
  '32a85ec7-0668-81c6-b3ed-f561048b91bc',
  '32a85ec7-0668-812f-8b07-d21160474f06',
  // March 14 Qigong - keep 32585ec7-0668-81a1-94fa-e4c2706c1115
  '32485ec7-0668-8196-89be-c169b2decc99'
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
      res.on('end', () => resolve(res.statusCode));
      res.on('data', () => {});
    });
    req.on('error', () => resolve(0));
    req.write(data);
    req.end();
  });
}

async function main() {
  for (const id of PAGES_TO_ARCHIVE) {
    await notionArchive(id);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Done');
}

main();
