const fs = require('fs');

const content = fs.readFileSync('/Users/javier/.openclaw/workspace/health_log.md', 'utf8');
const lines = content.split('\n');
const monthlyTotals = {};

lines.forEach(line => {
    if (line.includes('| Food |')) {
        const parts = line.split('|').map(p => p.trim());
        const date = parts[1];
        const cals = parseInt(parts[8]);
        if (!isNaN(cals)) {
            if (!monthlyTotals[date]) monthlyTotals[date] = 0;
            monthlyTotals[date] += cals;
        }
    }
});

const values = Object.values(monthlyTotals).filter(v => v > 0);
const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b) / values.length) : 0;
console.log(`Average: ${avg} kcal across ${values.length} days.`);
