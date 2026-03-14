const fs = require('fs');

function calculateStats(data) {
    const values = data.filter(e => e.sgv).map(e => e.sgv);
    if (values.length === 0) return null;

    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / values.length;
    const tir = (values.filter(v => v >= 70 && v <= 180).length / values.length) * 100;
    const gmi = 3.31 + (0.02392 * average);

    return { average, tir, gmi };
}

const data24h = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/tmp/glucose_24h.json', 'utf8'));
const data14d = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/tmp/glucose_14d.json', 'utf8'));

const stats24h = calculateStats(data24h);
const stats14d = calculateStats(data14d);

console.log(JSON.stringify({ stats24h, stats14d }, null, 2));
