const https = require('https');

const NOTION_KEY = "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";

async function patchJson(id, props) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ properties: props });
    const options = {
      hostname: 'api.notion.com', path: '/v1/pages/' + id, method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => { 
      let body = ''; res.on('data', (c) => body += c); 
      res.on('end', () => {
          try { resolve(JSON.parse(body || "{}")); }
          catch (e) { resolve({ error: body }); }
      }); 
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data); req.end();
  });
}

const projections = [
  // Mar 6
  { id: '31b85ec70668813eb2eee01f27dc8544', bg: 179, time: '2026-03-06T12:30:00.000-08:00' }, // Breakfast
  { id: '31b85ec70668812abcd9ce1cb714d0e4', bg: 176, time: '2026-03-06T16:00:00.000-08:00' }, // Lunch
  { id: '31c85ec706688133bdecf61d1cb1f048', bg: 174, time: '2026-03-06T21:30:00.000-08:00' }, // Dinner
  { id: '31c85ec706688131b123eb04c5d4845e', bg: 189, time: '2026-03-06T22:00:00.000-08:00' }, // Dessert
  { id: '31c85ec7066881d6b14fcadd747a25c1', bg: 194, time: '2026-03-06T23:30:00.000-08:00' }, // Snack
  // Mar 7
  { id: '31c85ec7066881b9b460ccfacfcbe8aa', bg: 165, time: '2026-03-07T12:00:00.000-08:00' }, // Breakfast
  { id: '31c85ec706688125a1f5d74a5338405d', bg: 202, time: '2026-03-07T14:45:00.000-08:00' }, // Lunch
  { id: '31d85ec706688104a7d4d3fce014c186', bg: 174, time: '2026-03-07T18:15:00.000-08:00' }, // Snack
  { id: '31d85ec7066881c38d55d847d122e8aa', bg: 174, time: '2026-03-07T20:50:00.000-08:00' }, // Dinner
  { id: '31d85ec7066881d5ba94c010333cc691', bg: 229, time: '2026-03-07T21:30:00.000-08:00' }, // Dessert
  // Mar 8
  { id: '31e85ec7066881e69c48ca86014ec9b1', bg: 221, time: '2026-03-08T12:40:00.000-07:00' }, // Breakfast
  { id: '31e85ec7066881e49187ec9225911d61', bg: 221, time: '2026-03-08T21:30:00.000-07:00' }, // Dessert
  // Mar 9
  { id: '31e85ec7066881228aa5ee05e84875ab', bg: 171, time: '2026-03-09T11:55:00.000-07:00' }, // Breakfast
  { id: '31e85ec70668819c8560df620bc9e7f1', bg: 208, time: '2026-03-09T15:30:00.000-07:00' }, // Lunch
  { id: '31e85ec7066881929bc7ca0df4488886', bg: 146, time: '2026-03-09T17:58:00.000-07:00' }, // Snack
  { id: '31e85ec70668814d8954fb5174085f15', bg: 234, time: '2026-03-08T20:40:00.000-07:00' }  // Dinner (Logged Mar 8 evening)
];

async function run() {
  for (const p of projections) {
    console.log('Backfilling ID:', p.id);
    let success = false;
    let attempts = 0;
    while (!success && attempts < 3) {
      const res = await patchJson(p.id, {
        'Predicted Peak BG': { number: p.bg },
        'Predicted Peak Time': { date: { start: p.time } }
      });
      if (res.error) {
        console.error('  Error:', res.error);
        attempts++;
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log('  Success');
        success = true;
      }
    }
  }
}
run();
