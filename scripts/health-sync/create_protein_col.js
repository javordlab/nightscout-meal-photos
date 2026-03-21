const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function run() {
  console.log('🏗️ Adding Protein (est) column to database schema...');
  const data = JSON.stringify({
    properties: {
      'Protein (est)': {
        number: {
          format: 'number'
        }
      }
    }
  });

  const options = {
    hostname: 'api.notion.com',
    port: 443,
    path: `/v1/databases/${DB_ID}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      const j = JSON.parse(d);
      if (res.statusCode === 200) {
         console.log('✅ Column created successfully.');
      } else {
         console.error('Failed:', j);
      }
    });
  });
  req.write(data);
  req.end();
}

run();
