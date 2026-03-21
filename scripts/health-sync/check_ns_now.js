const https = require('https');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const options = { headers: { 'api-secret': NS_SECRET } };

https.get(`${NS_URL}/api/v1/treatments.json?find[created_at][$gte]=2026-03-21&count=20`, options, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(data);
      console.log('March 21 treatments:', j.length);
      j.forEach(t => {
        const utc = new Date(t.created_at).toISOString();
        const pdt = new Date(t.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        console.log(`  PDT: ${pdt} | UTC: ${utc}`);
        console.log(`       ${t.notes?.slice(0, 60)}...`);
      });
    } catch(e) {
      console.log('Error parsing:', e.message);
      console.log('Raw:', data.slice(0, 200));
    }
  });
}).on('error', e => console.log('Request error:', e.message));
