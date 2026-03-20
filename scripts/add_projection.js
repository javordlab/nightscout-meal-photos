const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

// Calculate projection for a meal
function calculateProjection(date, carbs) {
  if (!carbs || carbs <= 0) return null;
  
  const mealTime = new Date(date);
  const predPeakTime = new Date(mealTime.getTime() + 105 * 60 * 1000);
  let predictedBg = Math.round(120 + (carbs * 3.5));
  if (predictedBg > 300) predictedBg = 300;
  
  return {
    peakBg: predictedBg,
    peakTime: predPeakTime.toISOString()
  };
}

// Add projection to Notion entry
async function addProjectionToNotion(entryId, carbs, date) {
  const projection = calculateProjection(date, carbs);
  if (!projection) return { success: false, reason: 'No carbs to calculate' };
  
  return new Promise((resolve) => {
    const data = JSON.stringify({
      properties: {
        'Predicted Peak BG': { number: projection.peakBg },
        'Predicted Peak Time': { date: { start: projection.peakTime } }
      }
    });
    
    const options = {
      method: 'PATCH',
      hostname: 'api.notion.com',
      path: `/v1/pages/${entryId}`,
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
        try {
          const json = JSON.parse(body);
          resolve({ success: !json.error, data: json, projection });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.write(data);
    req.end();
  });
}

// Find entry by date and title
async function findEntry(date, titleSubstring) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      filter: {
        and: [
          { property: 'Date', date: { equals: date } },
          { property: 'Entry', title: { contains: titleSubstring.substring(0, 30) } }
        ]
      }
    });
    
    const options = {
      method: 'POST',
      hostname: 'api.notion.com',
      path: `/v1/databases/${DATABASE_ID}/query`,
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
        try {
          const json = JSON.parse(body);
          resolve(json.results?.[0] || null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node add_projection.js "YYYY-MM-DDTHH:MM:SS" "Meal title" carbs');
    console.log('Example: node add_projection.js "2026-03-19T18:30:00-07:00" "Dinner: Chicken" 45');
    process.exit(1);
  }
  
  const date = args[0];
  const title = args[1];
  const carbs = parseInt(args[2]);
  
  console.log(`Finding entry: ${title.substring(0, 40)}... @ ${date}`);
  
  const entry = await findEntry(date, title);
  if (!entry) {
    console.log('❌ Entry not found in Notion');
    process.exit(1);
  }
  
  console.log(`Found entry ID: ${entry.id}`);
  console.log(`Current carbs: ${entry.properties['Carbs (est)']?.number}`);
  console.log(`Current projection: ${entry.properties['Predicted Peak BG']?.number || 'None'}`);
  
  const result = await addProjectionToNotion(entry.id, carbs, date);
  
  if (result.success) {
    const peakTime = new Date(result.projection.peakTime);
    console.log(`\n✅ Projection added:`);
    console.log(`   Predicted Peak: ${result.projection.peakBg} mg/dL`);
    console.log(`   Peak Time: ${peakTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PT`);
  } else {
    console.log('\n❌ Failed:', result.error || result.reason);
    process.exit(1);
  }
}

// Export for use by other scripts
module.exports = { calculateProjection, addProjectionToNotion, findEntry };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
