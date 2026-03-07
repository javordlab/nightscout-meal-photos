const fs = require('fs');
const log = fs.readFileSync('/Users/javier/.openclaw/workspace/health_log.md', 'utf8');
const lines = log.split('\n');

const dates = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
const results = {};

dates.forEach(date => {
    let totalCarbs = 0;
    let totalCals = 0;
    lines.forEach(line => {
        if (line.includes(date) && line.includes('| Food |')) {
            const parts = line.split('|').map(p => p.trim());
            const carbs = parseInt(parts[6]);
            const cals = parseInt(parts[7]);
            if (!isNaN(carbs)) totalCarbs += carbs;
            if (!isNaN(cals)) totalCals += cals;
        }
    });
    results[date] = { totalCarbs, totalCals };
});

console.log(JSON.stringify(results, null, 2));
