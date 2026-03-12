const https = require('https');
const fs = require('fs');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NS_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";

async function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    };
    const req = https.request(url, options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d || "{}")));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function extractPhotos(text) {
  const regex = /\[📷\]\((https:\/\/iili\.io\/[^\)]+)\)/g;
  const matches = [...text.matchAll(regex)];
  return matches.map(m => m[1]);
}

const entries = [
  { date: "2026-03-12", time: "13:44", user: "Maria Dennis", category: "Food", mealType: "Lunch", entry: "Lunch: 1.5 shrimp/fish tacos and ~60% of roasted potatoes (Leftovers deducted) [📷](https://iili.io/qcJf0oQ.jpg) [📷](https://iili.io/qcJsJfV.jpg)", carbs: 45, cals: 360 },
  { date: "2026-03-12", time: "10:23", user: "Maria Dennis", category: "Food", mealType: "Breakfast", entry: "Breakfast: Flour tortilla with cheese, pastrami, and half a sliced apple [📷](https://iili.io/qaep2st.jpg)", carbs: 28, cals: 390 },
  { date: "2026-03-11", time: "19:30", user: "Maria Dennis", category: "Activity", mealType: "-", entry: "45 minutes exercise (After dinner)", carbs: null, cals: null },
  { date: "2026-03-11", time: "19:15", user: "Maria Dennis", category: "Food", mealType: "Dessert", entry: "Chocolate cake with whipped cream (~28g carbs, ~350 kcal)", carbs: 28, cals: 350 },
  { date: "2026-03-11", time: "18:58", user: "Maria Dennis", category: "Food", mealType: "Dinner", entry: "Dinner: Spanish tortilla (egg/potato) wedge, sautéed cabbage/carrots, bread with butter, and 2 slices prosciutto [📷](https://iili.io/qY0dtLJ.jpg) [📷](https://iili.io/qY0zFft.jpg)", carbs: 40, cals: 600 },
  { date: "2026-03-11", time: "14:15", user: "Maria Dennis", category: "Activity", mealType: "-", entry: "45 minutes walk (After lunch)", carbs: null, cals: null },
  { date: "2026-03-11", time: "13:30", user: "Maria Dennis", category: "Medication", mealType: "-", entry: "500mg Metformin HCL", carbs: null, cals: null },
  { date: "2026-03-11", time: "13:30", user: "Maria Dennis", category: "Food", mealType: "Lunch", entry: "Lunch: Fried rice with pork and veggies, plus a few grapes [📷](https://iili.io/qY0zFft.jpg) (~52g carbs, ~550 kcal)", carbs: 52, cals: 550 },
  { date: "2026-03-11", time: "09:56", user: "Maria Dennis", category: "Food", mealType: "Breakfast", entry: "Breakfast: Small beef and cheese sandwich and one small orange (~32g carbs, ~380 kcal)", carbs: 32, cals: 380 },
  { date: "2026-03-11", time: "09:56", user: "Maria Dennis", category: "Medication", mealType: "-", entry: "500mg Metformin HCL", carbs: null, cals: null },
  { date: "2026-03-11", time: "09:56", user: "Maria Dennis", category: "Activity", mealType: "-", entry: "30 minutes walk", carbs: null, cals: null }
];

async function run() {
  for (const e of entries) {
    const iso = `${e.date}T${e.time}:00-07:00`;
    const photos = extractPhotos(e.entry);
    const cleanTitle = e.entry.replace(/\[📷\]\([^\)]+\)/g, '').trim();

    console.log(`Syncing: ${iso} - ${cleanTitle}`);

    // Notion
    const notionBody = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        "Entry": { title: [{ text: { content: cleanTitle } }] },
        "Date": { date: { start: iso } },
        "Category": { select: { name: e.category } },
        "User": { select: { name: e.user } },
        "Carbs (est)": { number: e.carbs },
        "Calories (est)": { number: e.cals },
        "Meal Type": { select: { name: e.mealType === "-" ? "Snack" : e.mealType } },
        "Photo": { url: photos[0] || null }
      }
    };
    await postJson('https://api.notion.com/v1/pages', { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28' }, notionBody);
    console.log("  -> Notion OK");

    // Nightscout
    let eventType = "Note";
    if (e.category === "Food") eventType = "Meal Bolus";
    if (e.category === "Activity") eventType = "Exercise";

    const nsBody = {
      enteredBy: "Javordclaw-EmergencyBackfill",
      eventType: eventType,
      carbs: e.carbs,
      notes: `${cleanTitle}${e.carbs ? ` (~${e.carbs}g carbs, ~${e.cals} kcal)` : ''}${photos.length ? ' 📷 ' + photos.join(' ') : ''}`,
      created_at: iso
    };
    await postJson(`${NS_URL}/api/v1/treatments.json`, { 'api-secret': NS_SECRET }, nsBody);
    console.log("  -> Nightscout OK");
  }
}

run().catch(console.error);
