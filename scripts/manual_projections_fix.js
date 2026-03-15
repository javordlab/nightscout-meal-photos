const https = require('https');

const NOTION_KEY = "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";

async function patchJson(id, props) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ properties: props });
    const options = {
      hostname: 'api.notion.com', path: '/v1/pages/' + id.replace(/-/g, ''), method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => { 
      let body = ''; res.on('data', (c) => body += c); 
      res.on('end', () => resolve(JSON.parse(body || "{}"))); 
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data); req.end();
  });
}

const updates = [
  { id: '32385ec7066881829867fb4a1fdbe726', bg: 170, time: '2026-03-14T11:40:00.000-07:00' }, // Mar 14 Breakfast
  { id: '32385ec70668810ea149cc1626a6a46a', bg: 270, time: '2026-03-13T20:50:00.000-07:00' }, // Mar 13 Dinner
  { id: '32285ec7066881329888ca67e2e179d1', bg: 200, time: '2026-03-13T15:30:00.000-07:00' }, // Mar 13 Lunch
  { id: '32285ec70668813ca7d9c38d6e9342a1', bg: 175, time: '2026-03-13T12:02:00.000-07:00' }, // Mar 13 Breakfast
  { id: '32285ec7066881dab8aad30d71d30461', bg: 140, time: '2026-03-13T14:17:00.000-07:00' }, // Mar 13 Snack
  { id: '32285ec7066881199323f0691c9dfc30', bg: 240, time: '2026-03-12T20:45:00.000-07:00' }, // Mar 12 Dinner
  { id: '32285ec706688123af40ecf08842d089', bg: 160, time: '2026-03-12T20:30:00.000-07:00' }  // Mar 12 Dessert
];

async function run() {
  for (const u of updates) {
    console.log('Updating ID:', u.id);
    const res = await patchJson(u.id, {
      'Predicted Peak BG': { number: u.bg },
      'Predicted Peak Time': { date: { start: u.time } }
    });
    if (res.error) console.error('  Error:', res.error);
    else console.log('  Success');
  }
}
run();
