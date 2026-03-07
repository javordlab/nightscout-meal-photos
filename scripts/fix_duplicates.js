const https = require('https');

const NOTION_KEY = "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";
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

async function archivePage(pageId) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ archived: true });
        const options = {
            method: 'PATCH',
            hostname: 'api.notion.com',
            path: `/v1/pages/${pageId}`,
            headers: {
                'Authorization': `Bearer ${NOTION_KEY}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(options, (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
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
          { property: "Date", date: { on_or_after: "2026-03-06", on_or_before: "2026-03-06" } }
      ]
    }
  });

  const strawberries = data.results.filter(r => {
      const title = r.properties.Entry.title[0]?.text?.content || "";
      return title.toLowerCase().includes("strawberries");
  });

  console.log(`Found ${strawberries.length} strawberry entries for March 6th.`);
  
  strawberries.forEach(s => {
      console.log(`${s.id} | ${s.properties.Entry.title[0].text.content} | ${s.properties["Meal Type"].select.name}`);
  });

  if (strawberries.length > 1) {
      // Keep the one that is "Dinner" or has more detailed info
      const toKeep = strawberries.find(s => s.properties["Meal Type"].select.name === "Dinner") || strawberries[0];
      const toDelete = strawberries.filter(s => s.id !== toKeep.id);
      
      for (const item of toDelete) {
          console.log(`Archiving duplicate strawberry entry: ${item.id}`);
          await archivePage(item.id);
      }
  }
}

main().catch(console.error);
