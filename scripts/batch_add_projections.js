const https = require('https');
const fs = require('fs');

const NOTION_KEY = "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";

async function patchJson(id, props) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ properties: props });
    const options = {
      method: 'PATCH',
      hostname: 'api.notion.com',
      path: `/v1/pages/${id}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

async function main() {
  const missing = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/tmp/missing_projections.json', 'utf8'));
  
  console.log(`Adding projections to ${missing.length} entries...\n`);
  
  let success = 0;
  let failed = 0;
  
  for (const entry of missing) {
    const carbs = entry.carbs || 0;
    if (carbs <= 0) continue;
    
    // Calculate projection
    const mealTime = new Date(entry.date);
    const peakTime = new Date(mealTime.getTime() + 105 * 60 * 1000);
    let predictedBg = Math.round(120 + (carbs * 3.5));
    if (predictedBg > 300) predictedBg = 300;
    
    process.stdout.write(`Adding to ${entry.title.substring(0, 40)}... `);
    
    const result = await patchJson(entry.id, {
      'Predicted Peak BG': { number: predictedBg },
      'Predicted Peak Time': { date: { start: peakTime.toISOString() } }
    });
    
    if (result.error) {
      console.log(`FAILED: ${result.error}`);
      failed++;
    } else {
      console.log(`OK (${predictedBg} mg/dL @ ${peakTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })})`);
      success++;
    }
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\n✅ Added projections to ${success} entries`);
  if (failed > 0) console.log(`❌ Failed: ${failed} entries`);
}

main().catch(console.error);
