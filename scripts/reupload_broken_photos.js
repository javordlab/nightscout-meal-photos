const https = require('https');
const fs = require('fs');
const FormData = require('form-data');

const uploadsDir = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/uploads/';
const dataPath = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';
const API_KEY = '6d207e02198a847aa98d0a2a901485a5';

const brokenFiles = [
  '7c08586f-286c-4da4-8018-f2a66b64abf7.jpg',
  'd5afb3ee-eff2-4281-a355-34796d217b29.jpg',
  '51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg',
  'd60c1ebe-cefb-4490-b75c-27ea3a294930.jpg',
  '30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg',
  '35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg',
  '28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg',
  'f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg',
  'd6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg',
  '70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg'
];

async function uploadToFreeImageHost(filePath) {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('key', API_KEY);
    form.append('source', fs.createReadStream(filePath));
    
    const options = {
      hostname: 'freeimage.host',
      path: '/api/1/upload',
      method: 'POST',
      headers: form.getHeaders()
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.image?.url || null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    
    req.on('error', () => resolve(null));
    form.pipe(req);
  });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(dataPath));
  const urlMap = {};
  
  console.log('Re-uploading 10 broken photos...\n');
  
  for (const filename of brokenFiles) {
    const localPath = uploadsDir + filename;
    const oldUrl = 'https://iili.io/' + filename;
    
    process.stdout.write(`Uploading ${filename}... `);
    const newUrl = await uploadToFreeImageHost(localPath);
    
    if (newUrl) {
      urlMap[oldUrl] = newUrl;
      console.log(`OK: ${newUrl}`);
    } else {
      console.log('FAILED');
    }
    
    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\nUpdating ${data.length} gallery entries...`);
  
  let updated = 0;
  data.forEach(meal => {
    if (urlMap[meal.photo]) {
      meal.photo = urlMap[meal.photo];
      updated++;
    }
  });
  
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`✅ Updated ${updated} entries`);
  
  console.log('\nURL mappings:');
  Object.entries(urlMap).forEach(([old, newUrl]) => {
    console.log(`  ${old} → ${newUrl}`);
  });
}

main().catch(console.error);
