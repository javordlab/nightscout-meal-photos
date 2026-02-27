const https = require('https');

const options = {
  hostname: 'p01--sefi--s66fclg7g2lm.code.run',
  path: '/api/v1/entries/current.json',
  method: 'GET',
  headers: {
    'api-secret': 'b3170e23f45df7738434cd8be9cd79d86a6d0f01',
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.length > 0) {
        const entry = json[0];
        process.stdout.write(`${entry.sgv} mg/dL (${entry.direction})`);
      } else {
        process.stdout.write('No entries found');
      }
    } catch (e) {
      process.stderr.write('Parse error: ' + e.message);
    }
  });
});

req.on('error', (e) => { process.stderr.write('Request error: ' + e.message); });
req.end();
