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
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

  const payload = {
    filter: {
      and: [
        { property: "Category", select: { equals: "Food" } },
        { property: "Date", date: { on_or_after: dateStr } }
      ]
    }
  };

  const data = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, payload);
  
  const dailyTotals = {};
  data.results.forEach(item => {
    const dateProp = item.properties.Date.date;
    if (!dateProp) return;
    const date = dateProp.start.split('T')[0];
    const cal = item.properties["Calories (est)"].number || 0;
    if (!dailyTotals[date]) dailyTotals[date] = 0;
    dailyTotals[date] += cal;
  });

  const last7Days = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    last7Days.push({ date: ds, cal: dailyTotals[ds] || 0 });
  }

  console.log(JSON.stringify(last7Days, null, 2));
}

main().catch(console.error);
