const https = require('https');

const NOTION_KEY = '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';

async function archive(id) {
  const data = JSON.stringify({ archived: true });
  const options = {
    hostname: 'api.notion.com',
    port: 443,
    path: `/v1/pages/${id}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  return new Promise(r => {
    const req = https.request(options, (res) => { res.on('end', r); res.on('data', ()=>{}); });
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('🧹 Final surgical purge of the 3 redundant lunch entries...');
  
  // These IDs are from the visual check
  const toDelete = [
    '32a85ec7-0668-8121-8146-ef9f1853e571', // The "Photo received" one
    '32a85ec7-0668-8129-8cbd-fabc526a5a4e', // The "Snack: Avocado toast" one
    '32a85ec7-0668-810a-ad22-d63b9ca1352a'  // Any other hidden dup
  ];

  for (const id of toDelete) {
    console.log(`Archiving: ${id}`);
    await archive(id);
  }
  
  console.log('✅ Redundant lunch entries archived.');
}

run().catch(console.error);
