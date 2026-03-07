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

async function patchJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'PATCH',
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
    filter: { property: "Category", select: { equals: "Food" } }
  });
  
  console.log(`Auditing ${data.results.length} food entries...`);
  
  for (const item of data.results) {
    const props = item.properties;
    const title = props.Entry.title[0].text.content;
    const dateStr = props.Date.date.start;
    const hour = parseInt(dateStr.split('T')[1].substring(0, 2));
    
    let mealType = "";
    if (hour >= 5 && hour < 11) mealType = "Breakfast";
    else if (hour >= 11 && hour < 16) mealType = "Lunch";
    else if (hour >= 16 && hour < 21) mealType = "Dinner";
    else mealType = "Snack";
    
    // Override common snack times or names
    if (title.toLowerCase().includes("snack") || title.toLowerCase().includes("cookie") || title.toLowerCase().includes("nuts")) {
      mealType = "Snack";
    }

    let newTitle = title;
    if (!title.startsWith(mealType)) {
      newTitle = `${mealType}: ${title}`;
    }

    console.log(`Updating ${title} -> ${newTitle} (${mealType})`);
    
    await patchJson(`https://api.notion.com/v1/pages/${item.id}`, {
      properties: {
        "Entry": { "title": [{ "text": { "content": newTitle } }] },
        "Meal Type": { "select": { "name": mealType } }
      }
    });
    await new Promise(r => setTimeout(r, 333));
  }
}

main().catch(console.error);
