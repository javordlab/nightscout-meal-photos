const https = require('https');
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const options = {
  headers: { 'api-secret': NS_SECRET }
};

https.get(`${NS_URL}/api/v1/treatments.json?count=30`, options, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const j = JSON.parse(data);
    const withKey = j.filter(t => t.notes && t.notes.includes('[entry_key:'));
    console.log('Treatments with entry_key:', withKey.length);
    withKey.slice(0, 10).forEach(t => {
      const m = t.notes.match(/\[entry_key:([^\]]+)\]/);
      console.log(`  ${t._id.slice(0, 8)} | ${m?.[1].slice(0, 30)}...`);
    });
  });
}).on('error', e => console.log('Error:', e.message));
