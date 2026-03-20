const fs = require('fs');

const dataPath = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';
const data = JSON.parse(fs.readFileSync(dataPath));

// URL mapping: old broken iili.io URLs → new working URLs
const urlMap = {
  'https://iili.io/7c08586f-286c-4da4-8018-f2a66b64abf7.jpg': 'https://iili.io/qN1tOZl.jpg',
  'https://iili.io/d5afb3ee-eff2-4281-a355-34796d217b29.jpg': 'https://iili.io/qN1tmcF.jpg',
  'https://iili.io/51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg': 'https://iili.io/qN1DgiN.jpg',
  'https://iili.io/d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg': 'https://iili.io/qN1DsJn.jpg',
  'https://iili.io/30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg': 'https://iili.io/qN1DZbf.jpg',
  'https://iili.io/35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg': 'https://iili.io/qN1DDx4.jpg',
  'https://iili.io/28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg': 'https://iili.io/qN1DbWl.jpg',
  'https://iili.io/f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg': 'https://iili.io/qN1DyfS.jpg',
  'https://iili.io/d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg': 'https://iili.io/qN1bHg9.jpg',
  'https://iili.io/70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg': 'https://iili.io/qN1b25u.jpg'
};

let updated = 0;
data.forEach(meal => {
  if (urlMap[meal.photo]) {
    meal.photo = urlMap[meal.photo];
    updated++;
  }
});

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`✅ Updated ${updated} entries with new photo URLs`);

// Also update health_log.md
const healthLogPath = '/Users/javier/.openclaw/workspace/health_log.md';
let healthLog = fs.readFileSync(healthLogPath, 'utf8');

let logUpdated = 0;
Object.entries(urlMap).forEach(([old, newUrl]) => {
  if (healthLog.includes(old)) {
    healthLog = healthLog.split(old).join(newUrl);
    logUpdated++;
  }
});

fs.writeFileSync(healthLogPath, healthLog);
console.log(`✅ Updated ${logUpdated} URLs in health_log.md`);
