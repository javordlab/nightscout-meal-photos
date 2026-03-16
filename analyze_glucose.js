const fs = require('fs');
const glucoseData = JSON.parse(fs.readFileSync('glucose_data.json', 'utf8'));

const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

const last24h = glucoseData.filter(e => new Date(e.date) >= yesterday);
const last14d = glucoseData.filter(e => new Date(e.date) >= fourteenDaysAgo);

function calculateStats(entries) {
    if (entries.length === 0) return null;
    const values = entries.map(e => e.sgv).filter(v => !!v);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const tir = (values.filter(v => v >= 70 && v <= 180).length / values.length) * 100;
    const gmi = 3.31 + (0.02392 * avg);
    const cv = (Math.sqrt(values.map(v => Math.pow(v - avg, 2)).reduce((a, b) => a + b, 0) / values.length) / avg) * 100;
    return { avg, tir, gmi, cv };
}

const stats24h = calculateStats(last24h);
const stats14d = calculateStats(last14d);

console.log(JSON.stringify({ stats24h, stats14d }, null, 2));
