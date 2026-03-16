const fs = require('fs');
const content = fs.readFileSync('health_log.md', 'utf8');
const lines = content.split('\n').filter(l => l.includes('| 202'));

const data = lines.map(line => {
    const parts = line.split('|').map(p => p.trim());
    return {
        date: parts[1],
        category: parts[4],
        carbs: parts[7] === 'null' ? 0 : parseFloat(parts[7]) || 0,
        cals: parts[8] === 'null' ? 0 : parseFloat(parts[8]) || 0
    };
});

const now = new Date('2026-03-16');
const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

const last14dEntries = data.filter(e => new Date(e.date) >= fourteenDaysAgo && new Date(e.date) < now);

const dailyTotals = {};
last14dEntries.forEach(e => {
    if (!dailyTotals[e.date]) dailyTotals[e.date] = { carbs: 0, cals: 0 };
    dailyTotals[e.date].carbs += e.carbs;
    dailyTotals[e.date].cals += e.cals;
});

const days = Object.keys(dailyTotals).length;
const totalCarbs = Object.values(dailyTotals).reduce((a, b) => a + b.carbs, 0);
const totalCals = Object.values(dailyTotals).reduce((a, b) => a + b.cals, 0);

console.log(JSON.stringify({
    days,
    avgCarbs: totalCarbs / days,
    avgCals: totalCals / days
}, null, 2));
