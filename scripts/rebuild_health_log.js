const https = require('https');
const fs = require('fs');

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
        'Content-Length': Buffer.byteLength(data)
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
  let allResults = [];
  let hasMore = true;
  let nextCursor = null;

  console.log("Fetching all records from Notion...");

  while (hasMore) {
    const payload = {
      sorts: [{ property: "Date", direction: "descending" }]
    };
    if (nextCursor) payload.start_cursor = nextCursor;

    const data = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, payload);
    
    if (!data.results) {
        console.error("Error fetching data:", data);
        break;
    }

    allResults = allResults.concat(data.results);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;
    console.log(`Fetched ${allResults.length} records so far...`);
  }
  
  let content = "# Health Log\n\n";
  content += "| Date | Time | User | Category | Meal Type | Entry | Carbs | Cals |\n";
  content += "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n";
  
  const seen = new Set();
  
  allResults.forEach(item => {
    const props = item.properties;
    if (!props.Date.date) return;
    
    const dateStr = props.Date.date.start;
    const datePart = dateStr.split("T")[0];
    const timePart = dateStr.split("T")[1].substring(0, 5);
    
    const user = props.User.select ? props.User.select.name : "Maria Dennis";
    const category = props.Category.select ? props.Category.select.name : "Food";
    const mealType = props["Meal Type"] && props["Meal Type"].select ? props["Meal Type"].select.name : "-";
    const entry = props.Entry.title[0] ? props.Entry.title[0].text.content : "Untitled";
    const carbs = props["Carbs (est)"] ? props["Carbs (est)"].number : "-";
    const cals = props["Calories (est)"] ? props["Calories (est)"].number : "-";
    const photoUrl = props.Photo ? props.Photo.url : null;
    
    let entryText = entry;
    if (photoUrl) {
        entryText += ` [📷](${photoUrl})`;
    }
    
    const line = `| ${datePart} | ${timePart} | ${user} | ${category} | ${mealType} | ${entryText} | ${carbs} | ${cals} |`;
    
    const key = `${datePart}|${timePart}|${entry}`;
    if (!seen.has(key)) {
        seen.add(key);
        content += line + "\n";
    }
  });
  
  fs.writeFileSync("/Users/javier/.openclaw/workspace/health_log.md", content);
  console.log(`Health log rebuilt and cleaned. Total entries: ${allResults.length}`);
}

main().catch(console.error);
