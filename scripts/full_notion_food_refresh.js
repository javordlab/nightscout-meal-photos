const https = require('https');
const fs = require('fs');

const NOTION_KEY = fs.readFileSync('/Users/javier/.config/notion/api_key', 'utf8').trim();
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
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

async function deletePage(pageId) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'DELETE',
      hostname: 'api.notion.com',
      path: `/v1/blocks/${pageId}`, // Deleting the block (page) archives it
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28'
      }
    };
    const req = https.request(options, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.end();
  });
}

// Or better, just archive it
async function archivePage(pageId) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ archived: true });
        const options = {
            method: 'PATCH',
            hostname: 'api.notion.com',
            path: `/v1/pages/${pageId}`,
            headers: {
                'Authorization': `Bearer ${NOTION_KEY}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(options, (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function createPage(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    const req = https.request("https://api.notion.com/v1/pages", options, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sourceData = [
  { date: "2026-03-05", time: "20:22", item: "Snack: 1 protein ball", carbs: 12, cal: 100 },
  { date: "2026-03-05", time: "18:43", item: "Dinner: Fried rice with egg/avocado, carrot soup, sake, and pastrami toast", carbs: 71, cal: 910, photo: "https://iili.io/qnDnLzB.jpg" },
  { date: "2026-03-05", time: "15:19", item: "Snack: 1 oatmeal chocolate cookie and a small glass of milk", carbs: 24, cal: 250, photo: "https://iili.io/qngbl5X.jpg" },
  { date: "2026-03-05", time: "13:07", item: "Lunch: Pastrami and melted cheese on toast with a side of steamed broccoli", carbs: 20, cal: 350, photo: "https://iili.io/qnNJF2a.jpg" },
  { date: "2026-03-05", time: "10:05", item: "Breakfast: Scallion pancake with pork and a kiwi", carbs: 38, cal: 400, photo: "https://iili.io/qn5BXpf.jpg" },
  { date: "2026-03-04", time: "18:23", item: "Dinner: Pasta with meat sauce, cheese, broccoli, plus strawberries and grapes", carbs: 66, cal: 615, photo: "https://iili.io/qC6Ur8X.jpg" },
  { date: "2026-03-04", time: "14:46", item: "Snack: 1 Japanese Cream Sand cookie", carbs: 12, cal: 80, photo: "https://iili.io/qCSzSnf.jpg" },
  { date: "2026-03-04", time: "12:16", item: "Lunch: Pork belly on bread, half an apple, and a small bowl of mixed nuts", carbs: 35, cal: 500, photo: "https://iili.io/qCexbqP.jpg" },
  { date: "2026-03-04", time: "08:47", item: "Breakfast: Prosciutto, bread with brie cheese, and tea", carbs: 25, cal: 350, photo: "https://iili.io/qCEobbj.jpg" },
  { date: "2026-03-04", time: "08:30", item: "Breakfast: Sliced kiwi with goji berries", carbs: 18, cal: 110, photo: "https://iili.io/qC199AF.jpg" },
  { date: "2026-03-03", time: "21:13", item: "Snack: 1 protein ball", carbs: 12, cal: 100 },
  { date: "2026-03-03", time: "19:41", item: "Snack: Half an apple", carbs: 12, cal: 50, photo: "https://iili.io/qCdmXet.jpg" },
  { date: "2026-03-03", time: "18:57", item: "Dinner: Meatballs, fried potatoes, sourdough bread with butter, and a side of greens with grapes", carbs: 55, cal: 550, photo: "https://iili.io/qCJDbs4.jpg" },
  { date: "2026-03-03", time: "16:34", item: "Snack: Yogurt with strawberries and goji berries", carbs: 25, cal: 200, photo: "https://iili.io/qC9KEyN.jpg" },
  { date: "2026-03-03", time: "13:04", item: "Lunch: Carrot cheese soup, prosciutto, and bread", carbs: 45, cal: 450, photo: "https://iili.io/qBDE9pe.jpg" },
  { date: "2026-03-03", time: "09:56", item: "Breakfast: Toasted bread with cream cheese, smoked salmon, and a kiwi", carbs: 32, cal: 350, photo: "https://iili.io/qBPwuwJ.jpg" },
  { date: "2026-03-02", time: "19:43", item: "Dessert: Sliced strawberries", carbs: 8, cal: 60, photo: "https://iili.io/qBACD3x.jpg" },
  { date: "2026-03-02", time: "19:21", item: "Dinner: Shredded beef with bell peppers and a ciabatta roll", carbs: 40, cal: 500, photo: "https://iili.io/qBuPu14.jpg" },
  { date: "2026-03-02", time: "17:16", item: "Snack: 2 meat and cheese roll-ups", carbs: 0, cal: 180, photo: "https://iili.io/qBIbt1a.jpg" },
  { date: "2026-03-02", time: "08:49", item: "Breakfast: Smoked salmon and avocado on two slices of toasted sourdough", carbs: 30, cal: 350 },
  { date: "2026-03-01", time: "18:42", item: "Snack: 6 green grapes", carbs: 7, cal: 40, photo: "https://iili.io/qqXyUUQ.jpg" },
  { date: "2026-03-01", time: "18:21", item: "Dinner: Meatballs in sauce with fried rice and greens", carbs: 55, cal: 550, photo: "https://iili.io/qqXmrEx.jpg" },
  { date: "2026-03-01", time: "16:47", item: "Snack: Handful of pecans", carbs: 2, cal: 200, photo: "https://iili.io/qqXmSLb.jpg" },
  { date: "2026-03-01", time: "16:40", item: "Snack: Small wedge of brie cheese", carbs: 0, cal: 120, photo: "https://iili.io/qqXd1AN.jpg" },
  { date: "2026-03-01", time: "12:56", item: "Lunch: 2 bao buns with pork belly and a glass of orange juice", carbs: 70, cal: 600, photo: "https://iili.io/qqM6DBe.jpg" },
  { date: "2026-03-01", time: "09:07", item: "Breakfast: Sourdough with peanut butter and jam, and coffee with milk", carbs: 50, cal: 450, photo: "https://iili.io/qq1L2Hl.jpg" },
  { date: "2026-02-28", time: "19:42", item: "Snack: Small piece of bread and a glass of milk", carbs: 22, cal: 180 },
  { date: "2026-02-28", time: "19:06", item: "Snack: 1 energy ball", carbs: 12, cal: 120, photo: "https://iili.io/qquu6Ml.jpg" },
  { date: "2026-02-28", time: "18:53", item: "Snack: Small slice of bread with brie cheese", carbs: 10, cal: 150, photo: "https://iili.io/qqT1iw7.jpg" },
  { date: "2026-02-28", time: "18:40", item: "Dinner: Ramen with pork belly, tofu, bok choy, carrots, and nori", carbs: 45, cal: 500, photo: "https://iili.io/qqT7gaI.jpg" },
  { date: "2026-02-28", time: "17:29", item: "Snack: Jamón Serrano", carbs: 0, cal: 100, photo: "https://iili.io/qqIwqJa.jpg" },
  { date: "2026-02-28", time: "13:26", item: "Snack: 1 Japanese Cream Sand cookie", carbs: 12, cal: 80, photo: "https://iili.io/qqCNPx1.jpg" },
  { date: "2026-02-28", time: "13:06", item: "Snack: Prosciutto, hard cheese, and 6 green grapes", carbs: 7, cal: 180, photo: "https://iili.io/qqCGaOg.jpg" },
  { date: "2026-02-28", time: "09:04", item: "Breakfast: Scallion pancake, smoked salmon, scrambled eggs, avocado, orange, and 3 loquats", carbs: 45, cal: 550, photo: "https://iili.io/qqKyhN9.jpg" },
  { date: "2026-02-27", time: "20:33", item: "Yogurt with berry jam", carbs: 22, cal: 200, photo: "https://iili.io/qfm6STJ.jpg" },
  { date: "2026-02-27", time: "19:01", item: "Sliced sausage with sautéed peppers/onions and side of mochi", carbs: 35, cal: 500, photo: "https://iili.io/qfbT3y7.jpg" },
  { date: "2026-02-27", time: "12:41", item: "Noodles with avocado, greens, and shaved cheese", carbs: 45, cal: 450, photo: "https://iili.io/qfLDFt4.jpg" },
  { date: "2026-02-27", time: "12:31", item: "4oz orange juice", carbs: 13, cal: 50 },
  { date: "2026-02-27", time: "09:17", item: "Half a red apple, sliced", carbs: 10, cal: 50, photo: "https://iili.io/qfPDmyx.jpg" },
  { date: "2026-02-27", time: "09:15", item: "Two slices toasted sourdough with cream cheese and smoked salmon", carbs: 30, cal: 350, photo: "https://iili.io/qfPtLdJ.jpg" },
  { date: "2026-02-27", time: "09:13", item: "Fresh orange juice", carbs: 25, cal: 100, photo: "https://iili.io/qfPs7vp.jpg" },
  { date: "2026-02-26", time: "19:38", item: "Snack: 1 Cream Sand cookie", carbs: 10, cal: 80, photo: "https://iili.io/qfwu5VS.jpg" },
  { date: "2026-02-26", time: "17:52", item: "Snack: Glass of champagne and 6 grapes", carbs: 12, cal: 140, photo: "https://iili.io/qfj0fQj.jpg" },
  { date: "2026-02-26", time: "17:47", item: "Snack: Two deviled eggs", carbs: 1, cal: 140, photo: "https://iili.io/qfj0Khb.jpg" },
  { date: "2026-02-26", time: "17:42", item: "Dinner: 2 bao buns with braised meat and scallions", carbs: 45, cal: 450, photo: "https://iili.io/qfj0dv9.jpg" },
  { date: "2026-02-26", time: "13:54", item: "Lunch: noodle soup with egg and leafy greens", carbs: 45, cal: 350, photo: "https://iili.io/qfhhYKJ.jpg" },
  { date: "2026-02-26", time: "09:31", item: "Scallion pancake / savory flatbread with some cheese", carbs: 30, cal: 400, photo: "https://iili.io/qfh8R3X.jpg" },
  { date: "2026-02-26", time: "09:27", item: "Apple slices + small cup of yogurt", carbs: 20, cal: 220, photo: "https://iili.io/qfh8TGI.jpg" },
  { date: "2026-02-26", time: "06:04", item: "Small glass of milk", carbs: 8, cal: 100 },
  { date: "2026-02-25", time: "19:38", item: "Snack: 6 green grapes", carbs: 5, cal: 40, photo: "https://files.catbox.moe/pdbpxz.jpg" },
  { date: "2026-02-25", time: "18:44", item: "White rice with mole/curry protein", carbs: 30, cal: 450 },
  { date: "2026-02-25", time: "18:38", item: "Corn tostada with tuna and avocado", carbs: 15, cal: 250 },
  { date: "2026-02-25", time: "18:33", item: "Snack: nori seaweed chips", carbs: 15, cal: 50 },
  { date: "2026-02-25", time: "18:26", item: "Dinner salad: endive, avocado, citrus", carbs: 12, cal: 150 },
  { date: "2026-02-25", time: "16:03", item: "Half an apple", carbs: 12, cal: 50 },
  { date: "2026-02-25", time: "12:09", item: "Lunch: Octopus with potatoes", carbs: 29, cal: 400, photo: "https://files.catbox.moe/uf8gwq.jpg" },
  { date: "2026-02-25", time: "09:27", item: "Breakfast: Smoked salmon on 1 bao bun", carbs: 22, cal: 250, photo: "https://files.catbox.moe/dzucg3.jpg" },
  { date: "2026-02-25", time: "05:34", item: "Snack: Glass of milk and cookie", carbs: 17, cal: 200 },
  { date: "2026-02-25", time: "03:28", item: "Late snack: Small piece of dark chocolate", carbs: 3, cal: 50, photo: "https://files.catbox.moe/xw7qza.jpg" },
  { date: "2026-02-25", time: "02:48", item: "Dinner: Green vegetable soup, octopus with potatoes", carbs: 35, cal: 450, photo: "https://files.catbox.moe/2059f6.jpg" },
  { date: "2026-02-24", time: "21:34", item: "Glass of milk and Japanese Cream Sand cookie", carbs: 25, cal: 200 },
  { date: "2026-02-24", time: "19:28", item: "Small piece of dark chocolate", carbs: 5, cal: 50 },
  { date: "2026-02-24", time: "18:48", item: "Green vegetable soup, octopus with potatoes", carbs: 35, cal: 450 },
  { date: "2026-02-24", time: "15:49", item: "Handful of roasted cashews and dark chocolate", carbs: 12, cal: 180 },
  { date: "2026-02-24", time: "13:22", item: "2 Onigiri, 2 Umeboshi, and Miso soup", carbs: 45, cal: 450 },
  { date: "2026-02-24", time: "09:54", item: "Fried egg, prosciutto, 2 bao buns, and sliced apple", carbs: 30, cal: 450 },
  { date: "2026-02-23", time: "20:43", item: "Japanese Strawberry Cream Sand cookie", carbs: 15, cal: 85 },
  { date: "2026-02-23", time: "19:45", item: "Dinner: Grilled unagi, rice, tempura, asparagus", carbs: 85, cal: 650 },
  { date: "2026-02-23", time: "15:10", item: "small bread roll with apple cream, roasted cashews", carbs: 30, cal: 250 },
  { date: "2026-02-23", time: "12:06", item: "Small baked potato with prosciutto and salad", carbs: 35, cal: 400 },
  { date: "2026-02-23", time: "10:00", item: "1 cup black coffee", carbs: 0, cal: 5 },
  { date: "2026-02-23", time: "09:42", item: "2 fried eggs, 2 slices toast, sliced apple", carbs: 30, cal: 400 },
  { date: "2026-02-22", time: "20:30", item: "Handful of cashews", carbs: 5, cal: 150 },
  { date: "2026-02-22", time: "19:30", item: "Pasta dinner with sake", carbs: 70, cal: 700 }
];

async function main() {
  console.log("Fetching all current Notion Food entries...");
  const notionData = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: { property: "Category", select: { equals: "Food" } }
  });
  
  console.log(`Found ${notionData.results.length} entries. Archiving them...`);
  for (const item of notionData.results) {
    await archivePage(item.id);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log("Archive complete.");

  console.log(`Repopulating with ${sourceData.length} clean source entries...`);
  for (const entry of sourceData) {
    const _tp = entry.time.split(' '); const _fOff = _tp[1] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
    const isoDate = `${entry.date}T${_tp[0]}:00${_fOff}`;
    const payload = {
      parent: { database_id: DATABASE_ID },
      properties: {
        "Entry": { title: [{ text: { content: entry.item } }] },
        "Category": { select: { name: "Food" } },
        "Date": { date: { start: isoDate } },
        "User": { select: { name: "Maria Dennis" } },
        "Carbs (est)": { number: entry.carbs },
        "Calories (est)": { number: entry.cal }
      }
    };
    if (entry.photo) {
      payload.properties["Photo"] = { url: entry.photo };
    }
    
    await createPage(payload);
    console.log(`Created: ${entry.item} (${isoDate})`);
    await new Promise(r => setTimeout(r, 333));
  }
  console.log("Repopulation complete.");
}

main().catch(console.error);
