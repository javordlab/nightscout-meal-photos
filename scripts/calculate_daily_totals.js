const fs = require('fs');

const log = fs.readFileSync('/Users/javier/.openclaw/workspace/health_log.md', 'utf8');
const lines = log.split('\n');

// Current date is March 8th, so yesterday is March 7th
const targetDate = "2026-03-07";

let totalCarbs = 0;
let totalCals = 0;
const meals = [];

lines.forEach(line => {
    if (line.includes(targetDate) && line.includes('| Food |')) {
        const parts = line.split('|').map(p => p.trim());
        const entry = parts[6];
        const carbs = parseInt(parts[7]);
        const cals = parseInt(parts[8]);
        
        if (!isNaN(carbs)) totalCarbs += carbs;
        if (!isNaN(cals)) totalCals += cals;
        meals.push(`${entry} (${cals} kcal)`);
    }
});

console.log(JSON.stringify({ targetDate, totalCarbs, totalCals, meals }, null, 2));
