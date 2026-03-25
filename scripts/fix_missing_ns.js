const https = require('https');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET_HASH = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function nsPost(treatment) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(treatment);
        const options = {
            method: 'POST',
            hostname: 'p01--sefi--s66fclg7g2lm.code.run',
            path: '/api/v1/treatments',
            headers: {
                'api-secret': NS_SECRET_HASH,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => resolve(resData));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

const missing = [
    {
        date: "2026-03-09",
        time: "10:24",
        notes: "Breakfast: Scallion pancake with cheese, fried egg, kiwi, and black coffee. 📷 https://iili.io/qAnVvMN.jpg",
        carbs: 43,
        eventType: "Meal Bolus"
    },
    {
        date: "2026-03-09",
        time: "13:37",
        notes: "Lunch: Scallion pancake, prosciutto, and avocado (~42g carbs, ~500 kcal). 📷 https://iili.io/qAWqhN9.jpg",
        carbs: 42,
        eventType: "Meal Bolus"
    },
    {
        date: "2026-03-09",
        time: "13:39",
        notes: "Sliced apple and kiwi (~22g carbs, ~90 kcal). 📷 https://iili.io/qAWYFjf.jpg",
        carbs: 22,
        eventType: "Meal Bolus"
    },
    {
        date: "2026-03-09",
        time: "15:58",
        notes: "Mixed nuts and cheese balls (~12g carbs, ~250 kcal). 📷 https://iili.io/qAS2gVV.jpg",
        carbs: 12,
        eventType: "Meal Bolus"
    },
    {
        date: "2026-03-09",
        time: "21:30",
        notes: "Glass of milk and a spoon of peanut butter (~15g carbs, ~250 kcal)",
        carbs: 15,
        eventType: "Meal Bolus"
    }
];

async function run() {
    for (const m of missing) {
        // Parse local time for this historical entry (March 9, 2026 = PDT)
        const dt = new Date(`${m.date}T${m.time}:00-07:00`);
        const treatment = {
            created_at: dt.toISOString(),
            notes: m.notes,
            carbs: m.carbs,
            eventType: m.eventType,
            enteredBy: "Antigravity Sync Fixer"
        };
        console.log(`Pushing ${m.notes} to NS...`);
        const res = await nsPost(treatment);
        console.log(res);
    }
}

run().catch(console.error);
