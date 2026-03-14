const fs = require('fs');

const nightscoutData = JSON.parse(fs.readFileSync('nightscout_24h.json', 'utf8'));
const sgvValues = nightscoutData.map(entry => entry.sgv).filter(val => val !== undefined);

if (sgvValues.length === 0) {
    console.log("No SGV values found.");
    process.exit(1);
}

const min = Math.min(...sgvValues);
const max = Math.max(...sgvValues);
const avg = sgvValues.reduce((a, b) => a + b, 0) / sgvValues.length;

// Estimated A1C = (Average Glucose + 46.7) / 28.7
const eA1C = (avg + 46.7) / 28.7;

// TIR (70-180 mg/dL)
const inRange = sgvValues.filter(val => val >= 70 && val <= 180).length;
const tir = (inRange / sgvValues.length) * 100;

// High (>180) and Low (<70)
const high = (sgvValues.filter(val => val > 180).length / sgvValues.length) * 100;
const low = (sgvValues.filter(val => val < 70).length / sgvValues.length) * 100;

console.log(`Summary for last 24h:`);
console.log(`Average: ${avg.toFixed(1)} mg/dL`);
console.log(`Min/Max: ${min}/${max} mg/dL`);
console.log(`Estimated A1C: ${eA1C.toFixed(2)}%`);
console.log(`Time in Range (70-180): ${tir.toFixed(1)}%`);
console.log(`Time High (>180): ${high.toFixed(1)}%`);
console.log(`Time Low (<70): ${low.toFixed(1)}%`);
