const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function postJson(url, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const response = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    sorts: [
      {
        property: "Date",
        direction: "descending"
      }
    ],
    page_size: 10
  });

  if (response.results) {
    response.results.forEach(r => {
      const title = r.properties.Entry?.title[0]?.text?.content || "Untitled";
      const date = r.properties.Date?.date?.start;
      console.log(`${date} | ${title}`);
    });
  } else {
    console.log(JSON.stringify(response, null, 2));
  }
}

main().catch(console.error);