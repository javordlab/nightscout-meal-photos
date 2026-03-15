const https = require('https');

const NOTION_KEY = "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";

async function deletePage(id) {
  return new Promise((resolve) => {
    const options = {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(`https://api.notion.com/v1/pages/${id}`, options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.write(JSON.stringify({ archived: true }));
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

const idsToDelete = [
  '32485ec70668810881d0fa9a49ac2fde',
  '32485ec7066881f8b4e3f9bd2bdcef35',
  '32485ec7066881b4bf75f9a3a84102cb'
];

async function run() {
  for (const id of idsToDelete) {
    console.log('Deleting:', id);
    const res = await deletePage(id);
    if (res.error) console.error('  Error:', res.error);
    else console.log('  Archived');
  }
}
run();
