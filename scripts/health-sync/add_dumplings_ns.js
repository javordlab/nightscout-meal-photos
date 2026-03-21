const https = require('https');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const treatment = {
  eventType: 'Meal Bolus',
  created_at: '2026-03-21T01:45:00.000Z', // 6:45 PM PDT
  carbs: 55,
  protein: 450,
  notes: 'Dinner: Four steamed dumplings with braised meat, sautéed vegetable hash, and dipping sauce 📷 https://iili.io/qeh3woG.jpg'
};

const data = JSON.stringify(treatment);
const options = {
  method: 'POST',
  headers: {
    'api-secret': NS_SECRET,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(`${NS_URL}/api/v1/treatments.json`, options, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', d);
  });
});

req.on('error', e => console.log('Error:', e.message));
req.write(data);
req.end();
