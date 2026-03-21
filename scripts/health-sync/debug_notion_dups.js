const https = require('https');
const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

const data = JSON.stringify({
  filter: {
    property: 'Date',
    date: { on_or_after: '2026-03-20' }
  },
  sorts: [{ property: 'Date', direction: 'descending' }]
});

const options = {
  method: 'POST',
  hostname: 'api.notion.com',
  path: `/v1/databases/${NOTION_DB_ID}/query`,
  headers: {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2025-09-03',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    const result = JSON.parse(body);
    const entries = (result.results || []).map(p => ({
      id: p.id,
      date: p.properties.Date?.date?.start,
      title: p.properties.Entry?.title?.[0]?.plain_text,
      category: p.properties.Category?.select?.name
    }));
    
    // Find duplicates by title+date
    const seen = new Map();
    const duplicates = [];
    for (const e of entries) {
      const key = `${e.date}|${e.title}`;
      if (seen.has(key)) {
        duplicates.push({ first: seen.get(key), duplicate: e });
      } else {
        seen.set(key, e);
      }
    }
    
    console.log('Total entries:', entries.length);
    console.log('Duplicates:', JSON.stringify(duplicates, null, 2));
  });
});

req.on('error', e => console.log('Error:', e.message));
req.write(data);
req.end();
