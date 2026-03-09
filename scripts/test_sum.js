const https = require('https');
const fs = require('fs');

const NOTION_KEY = fs.readFileSync('/Users/javier/.config/notion/api_key', 'utf8').trim();
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => resolve(JSON.parse(responseBody)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const data = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
          { property: "Category", select: { equals: "Food" } },
          { property: "Date", date: { on_or_after: "2026-03-08T00:00:00-07:00" } }
      ]
    }
  });

  console.log(`Found ${data.results.length} items.`);
  let sum = 0;
  data.results.forEach(r => {
      const cal = r.properties["Calories (est)"].number || 0;
      console.log(`${r.properties.Entry.title[0].text.content} | ${cal} | ${r.properties.Date.date.start}`);
      sum += cal;
  });
  console.log(`Total: ${sum}`);
}

main().catch(console.error);
