const fs = require('fs');

const log = fs.readFileSync('/Users/javier/.openclaw/workspace/health_log.md', 'utf8');
const lines = log.split('\n');

const dates = ["2026-03-08", "2026-03-07", "2026-03-06"];
const history = {};

dates.forEach(date => {
    let carbs = 0;
    let cals = 0;
    lines.forEach(line => {
        if (line.includes(date) && line.includes('| Food |')) {
            const parts = line.split('|').map(p => p.trim());
            const carb = parseInt(parts[7]);
            const cal = parseInt(parts[8]);
            if (!isNaN(carb)) carbs += carb;
            if (!isNaN(cal)) cals += cal;
        }
    });
    history[date] = { carbs, cals };
});

console.log(JSON.stringify(history, null, 2));
