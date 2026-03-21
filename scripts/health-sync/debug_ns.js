const https = require('https');
const NIGHTSCOUT_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const payload = {
  enteredBy: 'test',
  eventType: 'Note',
  notes: 'Test entry [entry_key:test]',
  created_at: '2026-03-21T07:00:00-07:00'
};

const data = JSON.stringify(payload);
const options = {
  method: 'POST',
  headers: {
    'api-secret': NIGHTSCOUT_SECRET,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(NIGHTSCOUT_URL + '/api/v1/treatments.json', options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body preview:', body.substring(0, 500));
    try {
      const j = JSON.parse(body);
      console.log('Parsed type:', typeof j);
      if (Array.isArray(j)) {
        console.log('Is array, length:', j.length);
        console.log('First item:', JSON.stringify(j[0], null, 2).substring(0, 500));
      } else {
        console.log('Full response:', JSON.stringify(j, null, 2).substring(0, 500));
      }
    } catch (e) {
      console.log('Parse error:', e.message);
    }
  });
});

req.on('error', e => console.log('Request error:', e.message));
req.write(data);
req.end();
