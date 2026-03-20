const fs = require('fs');

const BASE_URL = "https://javordlab.github.io/nightscout-meal-photos/uploads";
const JSON_PATH = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

let fixed = 0;

data.forEach(entry => {
  if (entry.photo && entry.photo.startsWith('uploads/')) {
    const filename = entry.photo.split('/').pop();
    entry.photo = `${BASE_URL}/${filename}`;
    fixed++;
    console.log(`Fixed: ${entry.title.substring(0, 50)}...`);
  }
});

fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
console.log(`\nFixed ${fixed} entries with full GitHub URLs`);
