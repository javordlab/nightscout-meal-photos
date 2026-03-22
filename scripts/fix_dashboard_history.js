const fs = require('fs');
const { execSync } = require('child_process');

const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/backups.json";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";

function getHistory(table, dateColumn) {
    const raw = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT DATE(${dateColumn}) as d, COUNT(*) FROM ${table} GROUP BY d ORDER BY d ASC;"`).toString().trim();
    const rows = raw.split('\n').map(line => {
        const [date, count] = line.split('\t');
        return { date, count: parseInt(count) };
    });

    let cumulative = 0;
    const historyMap = {};
    rows.forEach(r => {
        cumulative += r.count;
        historyMap[r.date] = cumulative;
    });
    return historyMap;
}

function main() {
    console.log("Reconstructing sync history from database...");
    
    const glucoseHistory = getHistory("glucose_measurements", "event_time");
    const notionHistory = getHistory("maria_health_log", "event_date");

    // Get unique dates sorted to find start point
    const allDates = [...new Set([...Object.keys(glucoseHistory), ...Object.keys(notionHistory)])].sort();

    // Generate a continuous list of unique dates from the first date to today
    const start = new Date(allDates[0]);
    const end = new Date();
    const dateSet = new Set();
    
    let current = new Date(start.getTime());
    // Move to noon to avoid DST jump issues at midnight
    current.setHours(12, 0, 0, 0);

    while (current <= end) {
        dateSet.add(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
    }
    
    const continuousDates = Array.from(dateSet).sort();

    const syncHistory = continuousDates.map(date => ({
        date: date,
        glucose: glucoseHistory[date] || 0,
        notion: notionHistory[date] || 0
    }));

    // Backfill cumulative values: if a day is 0, it means no NEW records,
    // so the total count is the same as the previous day.
    for (let i = 1; i < syncHistory.length; i++) {
        if (syncHistory[i].glucose === 0) syncHistory[i].glucose = syncHistory[i-1].glucose;
        if (syncHistory[i].notion === 0) syncHistory[i].notion = syncHistory[i-1].notion;
    }

    // Update backups.json
    if (fs.existsSync(OUTPUT_PATH)) {
        const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
        data.syncHistory = syncHistory.slice(-30); // Last 30 days
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
        console.log(`Updated ${OUTPUT_PATH} with reconstructed history (${syncHistory.length} days).`);
    } else {
        console.error("backups.json not found!");
    }
}

main();
