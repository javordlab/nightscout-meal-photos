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
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const onOrAfter = sevenDaysAgo.toISOString().slice(0, 10);

  const response = await notionRequest("POST", `/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: 'Category', select: { equals: 'Food' } },
        { property: 'Date', date: { on_or_after: onOrAfter } }
      ]
    },
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: 100
  });

  if (!response.results) {
    console.error('Failed:', response);
    return;
  }

  console.log(`Found ${response.results.length} Food entries\n`);
  
  const byUser = {};
  
  response.results.forEach(page => {
    const props = page.properties;
    const user = props.User?.select?.name || 'Unknown';
    const predBg = props['Predicted Peak BG']?.number;
    
    if (!byUser[user]) {
      byUser[user] = { total: 0, withProjections: 0, withoutProjections: 0 };
    }
    
    byUser[user].total++;
    if (predBg != null) {
      byUser[user].withProjections++;
    } else {
      byUser[user].withoutProjections++;
    }
  });
  
  console.log('Projections by User:\n');
  Object.entries(byUser).forEach(([user, stats]) => {
    console.log(`${user}:`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  With projections: ${stats.withProjections}`);
    console.log(`  Without projections: ${stats.withoutProjections}`);
    console.log(`  Coverage: ${((stats.withProjections / stats.total) * 100).toFixed(1)}%`);
    console.log('');
  });
}

main().catch(console.error);
