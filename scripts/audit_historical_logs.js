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

const localLogData = [
  { date: "2026-03-05", time: "20:22", item: "Snack: 1 protein ball", cal: 100 },
  { date: "2026-03-05", time: "18:43", item: "Dinner: Fried rice with egg/avocado, carrot soup, sake, and pastrami toast", cal: 910 },
  { date: "2026-03-05", time: "15:19", item: "Snack: 1 oatmeal chocolate cookie and a small glass of milk", cal: 250 },
  { date: "2026-03-05", time: "13:07", item: "Lunch: Pastrami and melted cheese on toast with a side of steamed broccoli", cal: 350 },
  { date: "2026-03-05", time: "10:05", item: "Breakfast: Scallion pancake with pork and a kiwi", cal: 400 },
  { date: "2026-03-04", time: "18:23", item: "Dinner: Pasta with meat sauce, cheese, broccoli, plus strawberries and grapes", cal: 615 },
  { date: "2026-03-04", time: "14:46", item: "Snack: 1 Japanese Cream Sand cookie", cal: 80 },
  { date: "2026-03-04", time: "12:16", item: "Lunch: Pork belly on bread, half an apple, and a small bowl of mixed nuts", cal: 500 },
  { date: "2026-03-04", time: "08:47", item: "Breakfast: Prosciutto, bread with brie cheese, and tea", cal: 350 },
  { date: "2026-03-04", time: "08:30", item: "Breakfast: Sliced kiwi with goji berries", cal: 110 },
  { date: "2026-03-03", time: "21:13", item: "Snack: 1 protein ball", cal: 100 },
  { date: "2026-03-03", time: "19:41", item: "Snack: Half an apple", cal: 50 },
  { date: "2026-03-03", time: "18:57", item: "Dinner: Meatballs, fried potatoes, sourdough bread with butter, and a side of greens with grapes", cal: 550 },
  { date: "2026-03-03", time: "16:34", item: "Snack: Yogurt with strawberries and goji berries", cal: 200 },
  { date: "2026-03-03", time: "13:04", item: "Lunch: Carrot cheese soup, prosciutto, and bread", cal: 450 },
  { date: "2026-03-03", time: "09:56", item: "Breakfast: Toasted bread with cream cheese, smoked salmon, and a kiwi", cal: 350 },
  { date: "2026-03-02", time: "19:43", item: "Dessert: Sliced strawberries", cal: 60 },
  { date: "2026-03-02", time: "19:21", item: "Dinner: Shredded beef with bell peppers and a ciabatta roll", cal: 500 },
  { date: "2026-03-02", time: "17:16", item: "Snack: 2 meat and cheese roll-ups", cal: 180 },
  { date: "2026-03-02", time: "08:49", item: "Breakfast: Smoked salmon and avocado on two slices of toasted sourdough", cal: 350 },
  { date: "2026-03-01", time: "18:42", item: "Snack: 6 green grapes", cal: 40 },
  { date: "2026-03-01", time: "18:21", item: "Dinner: Meatballs in sauce with fried rice and greens", cal: 550 },
  { date: "2026-03-01", time: "16:47", item: "Snack: Handful of pecans", cal: 200 },
  { date: "2026-03-01", time: "16:40", item: "Snack: Small wedge of brie cheese", cal: 120 },
  { date: "2026-03-01", time: "12:56", item: "Lunch: 2 bao buns with pork belly and a glass of orange juice", cal: 600 },
  { date: "2026-03-01", time: "09:07", item: "Breakfast: Sourdough with peanut butter and jam, and coffee with milk", cal: 450 },
  { date: "2026-02-28", time: "19:42", item: "Snack: Small piece of bread and a glass of milk", cal: 180 },
  { date: "2026-02-28", time: "19:06", item: "Snack: 1 energy ball", cal: 120 },
  { date: "2026-02-28", time: "18:53", item: "Snack: Small slice of bread with brie cheese", cal: 150 },
  { date: "2026-02-28", time: "18:40", item: "Dinner: Ramen with pork belly, tofu, bok choy, carrots, and nori", cal: 500 },
  { date: "2026-02-28", time: "17:29", item: "Snack: Jamón Serrano", cal: 100 },
  { date: "2026-02-28", time: "13:26", item: "Snack: 1 Japanese Cream Sand cookie", cal: 80 },
  { date: "2026-02-28", time: "13:06", item: "Snack: Prosciutto, hard cheese, and 6 green grapes", cal: 180 },
  { date: "2026-02-28", time: "09:04", item: "Breakfast: Scallion pancake, smoked salmon, scrambled eggs, avocado, orange, and 3 loquats", cal: 550 },
  { date: "2026-02-27", time: "20:33", item: "Yogurt with berry jam", cal: 200 },
  { date: "2026-02-27", time: "19:01", item: "Sliced sausage with sautéed peppers/onions and side of mochi", cal: 500 },
  { date: "2026-02-27", time: "12:41", item: "Noodles with avocado, greens, and shaved cheese", cal: 450 },
  { date: "2026-02-27", time: "12:31", item: "4oz orange juice", cal: 50 },
  { date: "2026-02-27", time: "09:17", item: "Half a red apple, sliced", cal: 50 },
  { date: "2026-02-27", time: "09:15", item: "Two slices toasted sourdough with cream cheese and smoked salmon", cal: 350 },
  { date: "2026-02-27", time: "09:13", item: "Fresh orange juice", cal: 100 },
  { date: "2026-02-26", time: "19:38", item: "Snack: 1 Cream Sand cookie", cal: 80 },
  { date: "2026-02-26", time: "17:52", item: "Snack: Glass of champagne and 6 grapes", cal: 140 },
  { date: "2026-02-26", time: "17:47", item: "Snack: Two deviled eggs", cal: 140 },
  { date: "2026-02-26", time: "17:42", item: "Dinner: 2 bao buns with braised meat and scallions", cal: 450 },
  { date: "2026-02-26", time: "13:54", item: "Lunch: noodle soup with egg and leafy greens", cal: 350 },
  { date: "2026-02-26", time: "09:31", item: "Scallion pancake / savory flatbread with some cheese", cal: 400 },
  { date: "2026-02-26", time: "09:27", item: "Apple slices + small cup of yogurt", cal: 220 },
  { date: "2026-02-26", time: "06:04", item: "Small glass of milk", cal: 100 },
  { date: "2026-02-25", time: "19:38", item: "Snack: 6 green grapes", cal: 40 },
  { date: "2026-02-25", time: "18:44", item: "White rice with mole/curry protein", cal: 450 },
  { date: "2026-02-25", time: "18:38", item: "Corn tostada with tuna and avocado", cal: 250 },
  { date: "2026-02-25", time: "18:33", item: "Snack: nori seaweed chips", cal: 50 },
  { date: "2026-02-25", time: "18:26", item: "Dinner salad: endive, avocado, citrus", cal: 150 },
  { date: "2026-02-25", time: "16:03", item: "Half an apple", cal: 50 },
  { date: "2026-02-25", time: "12:09", item: "Lunch: Octopus with potatoes", cal: 400 },
  { date: "2026-02-25", time: "09:27", item: "Breakfast: Smoked salmon on 1 bao bun", cal: 250 },
  { date: "2026-02-25", time: "05:34", item: "Snack: Glass of milk and cookie", cal: 200 },
  { date: "2026-02-25", time: "03:28", item: "Late snack: Small piece of dark chocolate", cal: 50 },
  { date: "2026-02-25", time: "02:48", item: "Dinner: Green vegetable soup, octopus with potatoes", cal: 450 },
  { date: "2026-02-24", time: "21:34", item: "Glass of milk and Japanese Cream Sand cookie", cal: 200 },
  { date: "2026-02-24", time: "19:28", item: "Small piece of dark chocolate", cal: 50 },
  { date: "2026-02-24", time: "18:48", item: "Green vegetable soup, octopus with potatoes", cal: 450 },
  { date: "2026-02-24", time: "15:49", item: "Handful of roasted cashews and dark chocolate", cal: 180 },
  { date: "2026-02-24", time: "13:22", item: "2 Onigiri, 2 Umeboshi, and Miso soup", cal: 450 },
  { date: "2026-02-24", time: "09:54", item: "Fried egg, prosciutto, 2 bao buns, and sliced apple", cal: 450 },
  { date: "2026-02-23", time: "20:43", item: "Japanese Strawberry Cream Sand cookie", cal: 85 },
  { date: "2026-02-23", time: "19:45", item: "Dinner: Grilled unagi, rice, tempura, asparagus", cal: 650 },
  { date: "2026-02-23", time: "15:10", item: "small bread roll with apple cream, roasted cashews", cal: 250 },
  { date: "2026-02-23", time: "12:06", item: "Small baked potato with prosciutto and salad", cal: 400 },
  { date: "2026-02-23", time: "10:00", item: "1 cup black coffee", cal: 5 },
  { date: "2026-02-23", time: "09:42", item: "2 fried eggs, 2 slices toast, sliced apple", cal: 400 },
  { date: "2026-02-22", time: "20:30", item: "Handful of cashews", cal: 150 },
  { date: "2026-02-22", time: "19:30", item: "Pasta dinner with sake", cal: 700 }
];

async function main() {
  console.log("Fetching all Notion Food entries...");
  const notionData = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: { property: "Category", select: { equals: "Food" } }
  });
  
  const notionItems = notionData.results.map(item => ({
    id: item.id,
    title: item.properties.Entry.title[0]?.text.content || "",
    date: item.properties.Date.date.start,
    cal: item.properties["Calories (est)"].number
  }));

  console.log(`Auditing ${localLogData.length} local entries against ${notionItems.length} Notion entries...`);

  for (const local of localLogData) {
    const _tAh = local.time.split(' '); const _oAh = _tAh[1] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
    const localDateTime = new Date(`${local.date}T${_tAh[0]}:00${_oAh}`);
    
    // Find matching Notion item by looking for same day and similar title
    const match = notionItems.find(n => {
      const nDate = new Date(n.date);
      const isSameDay = nDate.getFullYear() === localDateTime.getFullYear() &&
                        nDate.getMonth() === localDateTime.getFullYear() && // Wait, wrong check
                        nDate.getDate() === localDateTime.getDate();
      
      // Better day check handling ISO strings
      const nDayStr = n.date.split('T')[0];
      const isDayMatch = nDayStr === local.date;
      
      const isTitleSimilar = n.title.toLowerCase().includes(local.item.split(':')[0].toLowerCase()) || 
                             local.item.toLowerCase().includes(n.title.toLowerCase().split(':')[0]);
      
      return isDayMatch && isTitleSimilar;
    });

    if (match) {
      if (match.cal !== local.cal) {
        console.log(`Updating ${match.title} (${local.date}): ${match.cal} -> ${local.cal} kcal`);
        await patchJson(`https://api.notion.com/v1/pages/${match.id}`, {
          properties: { "Calories (est)": { number: local.cal } }
        });
      }
    } else {
      console.log(`⚠️ Missing in Notion: ${local.item} on ${local.date} ${local.time}`);
    }
  }
  console.log("Audit complete.");
}

main().catch(console.error);
