const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/tmp/glucose_14d.json', 'utf8'));

const values = data.filter(e => e.sgv).map(e => e.sgv);
if (values.length === 0) {
    console.log("No data");
    process.exit(1);
}

const sum = values.reduce((a, b) => a + b, 0);
const average = sum / values.length;
const tir = (values.filter(v => v >= 70 && v <= 180).length / values.length) * 100;
const gmi = 3.31 + (0.02392 * average);

// Calculate Standard Deviation
const squareDiffs = values.map(v => Math.pow(v - average, 2));
const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
const stdDev = Math.sqrt(avgSquareDiff);
const cv = (stdDev / average) * 100;

console.log(JSON.stringify({
    average: Math.round(average),
    tir: tir.toFixed(1),
    gmi: gmi.toFixed(1),
    stdDev: Math.round(stdDev),
    cv: cv.toFixed(1)
}, null, 2));
