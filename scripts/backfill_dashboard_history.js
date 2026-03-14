const fs = require('fs');
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/backups.json";

function main() {
    const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    
    // Current totals
    const currentGlucose = 5463;
    const currentNotion = 191;

    // Daily counts from MySQL output
    const glucoseDaily = [
        { date: "2026-03-14", count: 205 },
        { date: "2026-03-13", count: 268 },
        { date: "2026-03-12", count: 278 },
        { date: "2026-03-11", count: 278 },
        { date: "2026-03-10", count: 260 },
        { date: "2026-03-09", count: 279 },
        { date: "2026-03-08", count: 274 },
        { date: "2026-03-07", count: 264 },
        { date: "2026-03-06", count: 267 },
        { date: "2026-03-05", count: 275 }
    ];

    const notionDaily = [
        { date: "2026-03-14", count: 0 }, // none today yet in the query
        { date: "2026-03-13", count: 7 },
        { date: "2026-03-12", count: 184 }
    ];

    let history = [];
    let runningGlucose = currentGlucose;
    let runningNotion = currentNotion;

    // Calculate cumulative backwards
    for (let i = 0; i < glucoseDaily.length; i++) {
        const d = glucoseDaily[i].date;
        history.push({
            date: d,
            glucose: runningGlucose,
            notion: runningNotion
        });
        
        // Subtract today's count to get yesterday's total
        runningGlucose -= glucoseDaily[i].count;
        
        const nEntry = notionDaily.find(n => n.date === d);
        if (nEntry) {
            runningNotion -= nEntry.count;
        }
    }

    data.syncHistory = history.reverse();
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    console.log("Backfilled cumulative sync history.");
}
main();