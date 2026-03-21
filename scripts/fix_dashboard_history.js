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

    // Get unique dates sorted
    const allDates = [...new Set([...Object.keys(glucoseHistory), ...Object.keys(notionHistory)])].sort();

    const syncHistory = allDates.map(date => ({
        date: date,
        glucose: glucoseHistory[date] || 0,
        notion: notionHistory[date] || 0
    }));

    // Backfill missing values in cumulative series (if a day has no entries, count stays the same)
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
