const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function postJson(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

async function run() {
  const response = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: 'Category', select: { equals: 'Food' } },
        { property: 'Date', date: { on_or_after: '2026-03-01' } }
      ]
    }
  });

  if (response.results) {
    const output = response.results
      .filter(page => page.properties['Carbs (est)']?.number && !page.properties['Predicted Peak BG']?.number)
      .map(page => {
        const props = page.properties;
        return {
          id: page.id,
          title: props.Entry.title[0]?.plain_text,
          date: props.Date.date.start,
          carbs: props['Carbs (est)']?.number
        };
      });
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(JSON.stringify(response, null, 2));
  }
}
run();
