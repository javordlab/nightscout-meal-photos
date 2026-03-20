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

  console.log(`Found ${response.results.length} Food entries in last 7 days\n`);
  
  let missingProjections = 0;
  
  response.results.forEach(page => {
    const props = page.properties;
    const title = props.Entry.title[0]?.plain_text || 'Untitled';
    const date = props.Date.date.start;
    const carbs = props['Carbs (est)']?.number;
    const predBg = props['Predicted Peak BG']?.number;
    const predTime = props['Predicted Peak Time']?.date?.start;
    
    if (predBg == null) {
      missingProjections++;
      console.log(`❌ ${date}: ${title.substring(0, 50)}`);
      console.log(`   Carbs: ${carbs}g, Projection: MISSING`);
    }
  });
  
  console.log(`\n${missingProjections}/${response.results.length} entries missing projections`);
}

main().catch(console.error);
