const https = require('https');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const options = { headers: { 'api-secret': NS_SECRET } };

https.get(`${NS_URL}/api/v1/treatments.json?find[created_at][$gte]=2026-03-20&count=100`, options, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const j = JSON.parse(data);
    
    // Look for entries around 8:16 and 11:15
    const suspect = j.filter(t => {
      const h = new Date(t.created_at).getUTCHours();
      const m = new Date(t.created_at).getUTCMinutes();
      return (h === 8 && m >= 10 && m <= 20) || (h === 11 && m >= 10 && m <= 20);
    });
    
    console.log('Suspect entries (around 8:16 and 11:15 UTC):');
    suspect.forEach(t => {
      const utc = new Date(t.created_at).toISOString();
      console.log(`  ${utc} | ${t.notes?.slice(0, 50)}`);
    });
    
    // Also show all entries from March 20-21
    console.log('\nAll March 20-21 entries:');
    j.filter(t => t.created_at && t.created_at.startsWith('2026-03-2')).forEach(t => {
      const utc = new Date(t.created_at).toISOString();
      console.log(`  ${utc} | ${t.eventType} | ${t.notes?.slice(0, 40)}`);
    });
  });
}).on('error', e => console.log('Error:', e.message));
