const https = require('https');
const fs = require('fs');
const path = require('path');

const BROKEN_PHOTOS = [
  // March 15
  { date: "2026-03-15", oldUrl: "https://iili.io/70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg", desc: "Breakfast" },
  { date: "2026-03-15", oldUrl: "https://iili.io/d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg", desc: "Lunch" },
  { date: "2026-03-15", oldUrl: "https://iili.io/f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg", desc: "Dessert" },
  { date: "2026-03-15", oldUrl: "https://iili.io/c01f80a4-aafd-48cb-01b-72d73bc822d6.jpg", desc: "Dinner 1" },
  { date: "2026-03-15", oldUrl: "https://iili.io/4a293f8a-2283-4c49-923b-5260d4e858fe.jpg", desc: "Dinner 2" },
  // March 16
  { date: "2026-03-16", oldUrl: "https://iili.io/28205df3-226e-4852-b8b8-8e6f9e461ed4.jpg", desc: "Breakfast" },
  { date: "2026-03-16", oldUrl: "https://iili.io/35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg", desc: "Lunch 1" },
  { date: "2026-03-16", oldUrl: "https://iili.io/4169eba5-b2a4-4d1e-9074-2c81e117627a.jpg", desc: "Lunch 2" },
  { date: "2026-03-16", oldUrl: "https://iili.io/1bcae232-3858-47cc-8556-529a3c5f04e1.jpg", desc: "Lunch 3" },
  { date: "2026-03-16", oldUrl: "https://iili.io/30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg", desc: "Dinner 1" },
  { date: "2026-03-16", oldUrl: "https://iili.io/4d20a8e3-3a1a-487f-b1bd-1b711874d816.jpg", desc: "Dinner 2" },
  { date: "2026-03-16", oldUrl: "https://iili.io/d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg", desc: "Snack" },
  // March 17
  { date: "2026-03-17", oldUrl: "https://iili.io/51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg", desc: "Dinner 1" },
  { date: "2026-03-17", oldUrl: "https://iili.io/3c0ba392-d087-4351-bdc9-0b62242e6899.jpg", desc: "Dinner 2" },
  // March 18
  { date: "2026-03-18", oldUrl: "https://iili.io/d5afb3ee-eff2-4281-a355-34796d217b29.jpg", desc: "Lunch" },
  { date: "2026-03-18", oldUrl: "https://iili.io/7c08586f-286c-4da4-8018-f2a66b64abf7.jpg", desc: "Dinner 1" },
  { date: "2026-03-18", oldUrl: "https://iili.io/e06b4b8a-ffd9-4f21-848b-ff2ebc7603b9.jpg", desc: "Dinner 2" },
  { date: "2026-03-18", oldUrl: "https://iili.io/7e08c360-7b67-4b12-88cf-012bacd4a479.jpg", desc: "Dinner 3" },
  { date: "2026-03-18", oldUrl: "https://iili.io/f35236b3-6f01-4e14-9fb0-0a2e95f4eaa1.jpg", desc: "Dinner 4" }
];

const UPLOADS_DIR = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/uploads';

async function tryDownload(url, outputPath) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(outputPath);
        resolve(false);
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const stats = fs.statSync(outputPath);
        resolve(stats.size > 0);
      });
    }).on('error', () => {
      file.close();
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      resolve(false);
    });
  });
}

async function main() {
  console.log('Checking broken photos from freeimage.host...\n');
  
  let downloaded = 0;
  let failed = [];

  for (const photo of BROKEN_PHOTOS) {
    const filename = path.basename(photo.oldUrl);
    const outputPath = path.join(UPLOADS_DIR, filename);
    
    process.stdout.write(`Downloading ${photo.date} ${photo.desc}... `);
    
    const success = await tryDownload(photo.oldUrl, outputPath);
    
    if (success) {
      console.log('OK');
      downloaded++;
    } else {
      console.log('FAILED (500)');
      failed.push(photo);
    }
  }

  console.log(`\n${downloaded}/${BROKEN_PHOTOS.length} downloaded successfully`);
  
  if (failed.length > 0) {
    console.log('\nFailed downloads:');
    failed.forEach(f => console.log(`  - ${f.date} ${f.desc}: ${f.oldUrl}`));
  }
  
  console.log('\nNote: These images cannot be recovered from freeimage.host.');
  console.log('Options:');
  console.log('1. Re-upload manually from phone/camera');
  console.log('2. Use Telegram originals if still available in "Food log" group');
  console.log('3. Self-host if you have local copies');
}

main().catch(console.error);
