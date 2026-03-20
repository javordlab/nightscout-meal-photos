const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function notionRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        ...(data && { 'Content-Type': 'application/json' })
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve(d); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Query ALL Food entries (no date filter)
  let allEntries = [];
  let cursor = undefined;
  
  do {
    const response = await notionRequest("POST", `/databases/${DATABASE_ID}/query`, {
      filter: {
        property: 'Category', select: { equals: 'Food' }
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 100,
      ...(cursor && { start_cursor: cursor })
    });
    
    if (!response.results) break;
    allEntries.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);

  console.log(`Total Food entries in Notion: ${allEntries.length}\n`);
  
  const missing = [];
  const byUser = {};
  
  allEntries.forEach(page => {
    const props = page.properties;
    const user = props.User?.select?.name || 'Unknown';
    const predBg = props['Predicted Peak BG']?.number;
    const carbs = props['Carbs (est)']?.number;
    
    if (!byUser[user]) {
      byUser[user] = { total: 0, withProjections: 0, withoutProjections: 0, missingEntries: [] };
    }
    
    byUser[user].total++;
    if (predBg != null) {
      byUser[user].withProjections++;
    } else {
      byUser[user].withoutProjections++;
      if (carbs > 0) {
        byUser[user].missingEntries.push({
          id: page.id,
          title: props.Entry.title[0]?.plain_text || 'Untitled',
          date: props.Date.date.start,
          carbs: carbs
        });
        missing.push({
          id: page.id,
          user: user,
          title: props.Entry.title[0]?.plain_text || 'Untitled',
          date: props.Date.date.start,
          carbs: carbs
        });
      }
    }
  });
  
  console.log('Projections by User:\n');
  Object.entries(byUser).forEach(([user, stats]) => {
    console.log(`${user}:`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  With projections: ${stats.withProjections}`);
    console.log(`  Without projections: ${stats.withoutProjections}`);
    console.log(`  Coverage: ${((stats.withProjections / stats.total) * 100).toFixed(1)}%`);
    if (stats.missingEntries.length > 0) {
      console.log(`  Missing entries: ${stats.missingEntries.length}`);
    }
    console.log('');
  });
  
  if (missing.length > 0) {
    console.log(`\n=== Entries Missing Projections (${missing.length}) ===\n`);
    missing.slice(0, 20).forEach(entry => {
      console.log(`${entry.date} | ${entry.user}`);
      console.log(`  ${entry.title.substring(0, 60)}`);
      console.log(`  Carbs: ${entry.carbs}g | ID: ${entry.id}`);
      console.log('');
    });
    if (missing.length > 20) {
      console.log(`... and ${missing.length - 20} more`);
    }
    
    // Save to file for batch processing
    const fs = require('fs');
    fs.writeFileSync('/Users/javier/.openclaw/workspace/tmp/missing_projections.json', JSON.stringify(missing, null, 2));
    console.log(`\nSaved ${missing.length} entries to tmp/missing_projections.json`);
  } else {
    console.log('✅ All entries have projections!');
  }
}

main().catch(console.error);
