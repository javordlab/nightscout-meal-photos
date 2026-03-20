const fs = require('fs');

const BROKEN_URLS = [
  'https://iili.io/70e1c2c7-082b-486f-b6f0-99d2bae19f52.jpg',
  'https://iili.io/d6b3cf3a-ae1f-4836-b3f3-73ecd6a89ee2.jpg',
  'https://iili.io/f53060b2-14d1-4466-919f-1d6cbaf359ec.jpg',
  'https://iili.io/c01f80a4-aafd-48c8-801b-72d73bc822d6.jpg',
  'https://iili.io/4a293f8a-2283-4c49-923b-5260d4e858fe.jpg',
  'https://iili.io/28205df3-226e-4852-8b8e-8e6f9e461ed4.jpg',
  'https://iili.io/35cdbb5c-b5a0-4553-893e-a476afc4d19e.jpg',
  'https://iili.io/4169eba5-b2a4-4d1e-9074-2c81e117627a.jpg',
  'https://iili.io/1bcae232-3858-47cc-8556-529a3c5f04e1.jpg',
  'https://iili.io/30d718c6-0d35-4c9d-8e0e-f6bcb56f28cb.jpg',
  'https://iili.io/4d20a8e3-3a1a-487f-b1bd-1b711874d816.jpg',
  'https://iili.io/d60c1ebe-cefb-4490-b75c-27ea3a294930.jpg',
  'https://iili.io/51c8ee3d-fed3-43f8-b00f-50439dd4bac6.jpg',
  'https://iili.io/3c0ba392-d087-4351-bdc9-0b62242e6899.jpg',
  'https://iili.io/d5afb3ee-eff2-4281-a355-34796d217b29.jpg',
  'https://iili.io/7c08586f-286c-4da4-8018-f2a66b64abf7.jpg',
  'https://iili.io/e06b4b8a-ffd9-4f21-848b-ff2ebc7603b9.jpg',
  'https://iili.io/7e08c360-7b67-4b12-88cf-012bacd4a479.jpg',
  'https://iili.io/f35236b3-6f01-4e14-9fb0-0a2e95f4eaa1.jpg'
];

const JSON_PATH = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

let fixed = 0;

data.forEach(entry => {
  if (BROKEN_URLS.includes(entry.photo)) {
    const filename = entry.photo.split('/').pop();
    entry.photo = `uploads/${filename}`;
    fixed++;
    console.log(`Fixed: ${entry.title.substring(0, 50)}... -> uploads/${filename}`);
  }
});

fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
console.log(`\nFixed ${fixed} entries in notion_meals.json`);
