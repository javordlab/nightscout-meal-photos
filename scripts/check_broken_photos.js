const https = require('https');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json'));
const uploadsDir = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/uploads/';

async function checkUrl(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { method: 'HEAD', timeout: 5000 }, (res) => {
      resolve({ url, status: res.statusCode });
    });
    req.on('error', () => resolve({ url, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 0 }); });
  });
}

async function main() {
  const uniqueUrls = [...new Set(data.map(m => m.photo))];
  console.log(`Checking ${uniqueUrls.length} unique photo URLs...\n`);
  
  const broken = [];
  const working = [];
  
  // Check in batches of 10
  for (let i = 0; i < uniqueUrls.length; i += 10) {
    const batch = uniqueUrls.slice(i, i + 10);
    const results = await Promise.all(batch.map(checkUrl));
    
    results.forEach(r => {
      if (r.status !== 200) {
        broken.push(r);
      } else {
        working.push(r.url);
      }
    });
    
    process.stdout.write(`Checked ${Math.min(i + 10, uniqueUrls.length)}/${uniqueUrls.length}...\r`);
  }
  
  console.log(`\n\n✅ Working: ${working.length}`);
  console.log(`❌ Broken: ${broken.length}\n`);
  
  if (broken.length > 0) {
    console.log('Broken URLs:');
    broken.forEach(b => {
      const filename = b.url.split('/').pop();
      const localPath = uploadsDir + filename;
      const hasLocal = fs.existsSync(localPath);
      console.log(`  ${b.url} (status: ${b.status}) - Local: ${hasLocal ? 'YES' : 'NO'}`);
    });
    
    // Save broken for re-upload
    fs.writeFileSync('/Users/javier/.openclaw/workspace/tmp/broken_photos.json', JSON.stringify(broken, null, 2));
    console.log(`\nBroken URLs saved to tmp/broken_photos.json`);
  }
}

main();
