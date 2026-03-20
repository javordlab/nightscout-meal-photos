const https = require('https');
const fs = require('fs');

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

function parseProjection(entryText) {
  const match = entryText.match(/\(Pred:\s*(\d+)\s*mg\/dL\s*@\s*([\d:]+)\s*(?:[AP]M)?\)/);
  if (!match) return null;
  
  const bg = parseInt(match[1]);
  const timeStr = match[2];
  
  return { bg, timeStr };
}

async function main() {
  // Read health_log.md
  const logContent = fs.readFileSync('/Users/javier/.openclaw/workspace/health_log.md', 'utf8');
  const lines = logContent.split('\n').filter(l => l.includes('| Food |') && l.includes('Pred:'));
  
  console.log(`Found ${lines.length} Food entries with projections in health_log.md\n`);
  
  // Query Notion for all Food entries
  let notionEntries = [];
  let cursor = undefined;
  
  do {
    const response = await notionRequest("POST", `/databases/${DATABASE_ID}/query`, {
      filter: { property: 'Category', select: { equals: 'Food' } },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 100,
      ...(cursor && { start_cursor: cursor })
    });
    
    if (!response.results) break;
    notionEntries.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);
  
  console.log(`Found ${notionEntries.length} Food entries in Notion\n`);
  
  let updated = 0;
  let skipped = 0;
  
  for (const line of lines.slice(0, 50)) { // Process first 50
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 7) continue;
    
    const date = parts[1];
    const time = parts[2].split(' ')[0]; // Remove timezone
    const entryText = parts[6];
    
    const projection = parseProjection(entryText);
    if (!projection) continue;
    
    // Find matching Notion entry by date
    const isoDate = `${date}T${time}`;
    const matchingEntry = notionEntries.find(e => {
      const entryDate = e.properties.Date?.date?.start;
      return entryDate && entryDate.startsWith(isoDate.substring(0, 16));
    });
    
    if (!matchingEntry) {
      console.log(`Not found: ${date} ${time} - ${entryText.substring(0, 40)}...`);
      skipped++;
      continue;
    }
    
    // Check if already has projection
    const existingPred = matchingEntry.properties['Predicted Peak BG']?.number;
    if (existingPred) {
      skipped++;
      continue;
    }
    
    // Calculate peak time
    const mealTime = new Date(isoDate);
    const peakTime = new Date(mealTime.getTime() + 105 * 60 * 1000);
    
    // Update Notion
    process.stdout.write(`Updating ${date} ${time}: ${projection.bg} mg/dL... `);
    
    await notionRequest("PATCH", `/pages/${matchingEntry.id}`, {
      properties: {
        'Predicted Peak BG': { number: projection.bg },
        'Predicted Peak Time': { date: { start: peakTime.toISOString() } }
      }
    });
    
    console.log('OK');
    updated++;
    
    // Small delay
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\n✅ Updated ${updated} entries in Notion`);
  console.log(`⏭️  Skipped ${skipped} entries (already have projections or not found)`);
}

main().catch(console.error);
