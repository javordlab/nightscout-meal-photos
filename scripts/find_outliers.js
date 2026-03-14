const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/tmp/glucose_24h.json', 'utf8'));

const highs = data.filter(e => e.sgv > 180).sort((a, b) => b.sgv - a.sgv);
const lows = data.filter(e => e.sgv < 70).sort((a, b) => a.sgv - b.sgv);

const peak = data.reduce((max, e) => e.sgv > max.sgv ? e : max, data[0]);

console.log(JSON.stringify({
    highCount: highs.length,
    lowCount: lows.length,
    maxSgv: peak.sgv,
    peakTime: peak.dateString,
    topHighs: highs.slice(0, 5).map(h => ({ val: h.sgv, time: h.dateString })),
    bottomLows: lows.slice(0, 5).map(l => ({ val: l.sgv, time: l.dateString }))
}, null, 2));
