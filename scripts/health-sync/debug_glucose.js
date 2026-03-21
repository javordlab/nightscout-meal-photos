const https = require('https');
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const sinceMs = new Date('2026-03-20T08:00:00-07:00').getTime();
const url = `${NS_URL}/api/v1/entries.json?find[date][$gte]=${sinceMs}&count=5000`;

const options = { headers: { 'api-secret': NS_SECRET } };
https.get(url, options, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const j = JSON.parse(data);
    const target = new Date('2026-03-20T09:04:00-07:00').getTime();
    const near = j.filter(e => {
      const t = e.date || e.mills;
      return Math.abs(t - target) < 30 * 60 * 1000;
    }).slice(0, 5);
    console.log('Target:', new Date(target).toISOString());
    console.log('Near readings:', JSON.stringify(near.map(e => ({ t: new Date(e.date || e.mills).toISOString(), sgv: e.sgv })), null, 2));
  });
}).on('error', e => console.log('Error:', e.message));
