const https = require('https');
const fs = require('fs');

const NOTION_KEY = fs.readFileSync('/Users/javier/.config/notion/api_key', 'utf8').trim();
const DATABASE_ID = "31685ec7-0668-815a-bc98-000bab1964f3";

async function patchJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => resolve(JSON.parse(responseBody)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const updates = [
  { id: "31685ec7-0668-8100-8716-e70a1ee5f87c", cal: 40 },
  { id: "31685ec7-0668-8106-907d-e333f4fc6b84", cal: 350 },
  { id: "31685ec7-0668-8111-9ec3-dbd31767afb9", cal: 60 },
  { id: "31685ec7-0668-8112-b2c3-e13aa8bd13f9", cal: 500 },
  { id: "31685ec7-0668-8114-aa54-d91503e1e4da", cal: 50 },
  { id: "31685ec7-0668-812b-b6f3-c6dbbea53bd2", cal: 450 },
  { id: "31685ec7-0668-812f-9256-c2a612682be6", cal: 250 },
  { id: "31685ec7-0668-8132-80ad-f4264462a04f", cal: 350 },
  { id: "31685ec7-0668-813f-b58a-c48ed9db252d", cal: 600 },
  { id: "31685ec7-0668-8140-9089-c3b0fdc502b2", cal: 200 },
  { id: "31685ec7-0668-8142-aac0-feeb1016ca26", cal: 500 },
  { id: "31685ec7-0668-814e-9272-c17cd6edb07d", cal: 400 },
  { id: "31685ec7-0668-814f-a98a-d2249d1ac0ff", cal: 450 },
  { id: "31685ec7-0668-8150-a2b6-ea273b6d72e2", cal: 250 },
  { id: "31685ec7-0668-815c-a6c7-ceecf7366898", cal: 350 },
  { id: "31685ec7-0668-8163-abe2-c6b6541a06f1", cal: 80 },
  { id: "31685ec7-0668-8164-ac60-c4ee4c06ca8c", cal: 400 },
  { id: "31685ec7-0668-8166-a7de-f41c507419b8", cal: 180 },
  { id: "31685ec7-0668-8167-96d3-db5272a10530", cal: 550 },
  { id: "31685ec7-0668-8169-a5c9-c0d68157d53f", cal: 700 },
  { id: "31685ec7-0668-816a-880b-c3ecb014f07d", cal: 150 },
  { id: "31685ec7-0668-8171-b0d3-ca83ea7d4391", cal: 200 },
  { id: "31685ec7-0668-8177-9ea3-f543a598f033", cal: 500 },
  { id: "31685ec7-0668-818a-81e2-e035026cc66a", cal: 450 },
  { id: "31685ec7-0668-818b-8a4b-f9c157072819", cal: 400 },
  { id: "31685ec7-0668-818d-925f-e15da4e6a349", cal: 180 },
  { id: "31685ec7-0668-8196-9529-c2ba57ef888a", cal: 100 },
  { id: "31685ec7-0668-819b-9cf3-ea72ecef8aa3", cal: 140 },
  { id: "31685ec7-0668-81a2-aeb8-d90bb68627e7", cal: 100 },
  { id: "31685ec7-0668-81ac-9af1-fdff96f45e9f", cal: 220 },
  { id: "31685ec7-0668-81be-84f2-d0d723401b24", cal: 80 },
  { id: "31685ec7-0668-81c5-a58e-f596286b320f", cal: 450 },
  { id: "31685ec7-0668-81cc-8d97-cb6141a75b37", cal: 85 },
  { id: "31685ec7-0668-81d4-b576-d9034d2c416b", cal: 200 },
  { id: "31685ec7-0668-81d5-ae1c-ef97dfe97387", cal: 120 },
  { id: "31685ec7-0668-81dc-85e1-c3a703c160a9", cal: 650 },
  { id: "31685ec7-0668-81e4-928b-daf996a6c3c6", cal: 500 },
  { id: "31685ec7-0668-81ed-b8d7-c95ee55e5912", cal: 50 },
  { id: "31685ec7-0668-81f3-86d3-cd8515842dc2", cal: 50 },
  { id: "31685ec7-0668-81f4-a728-ff35398967e5", cal: 50 },
  { id: "31685ec7-0668-81f8-b4ad-cfa6577820a9", cal: 250 },
  { id: "31785ec7-0668-8135-9077-c7f0c08b8ca4", cal: 550 },
  { id: "31785ec7-0668-8146-8e41-cee468a95228", cal: 150 },
  { id: "31785ec7-0668-815d-a43a-e9053a44e741", cal: 40 },
  { id: "31785ec7-0668-8162-b1e1-e505e91b66c3", cal: 150 },
  { id: "31785ec7-0668-81bc-9d4c-d1e19f49e8ce", cal: 350 }
];

async function main() {
  console.log(`Starting retroactive calorie fill for ${updates.length} entries...`);
  for (const update of updates) {
    const payload = {
      properties: {
        "Calories (est)": { number: update.cal }
      }
    };
    await patchJson(`https://api.notion.com/v1/pages/${update.id}`, payload);
    console.log(`Updated ${update.id} with ${update.cal} kcal.`);
    await new Promise(r => setTimeout(r, 333)); // Rate limiting
  }
  console.log("Retroactive fill complete.");
}

main().catch(console.error);
