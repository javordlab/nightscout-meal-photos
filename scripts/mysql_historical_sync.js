const fs = require('fs');
const { execSync } = require('child_process');

const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";

function runQuery(sql) {
    const command = `${MYSQL_BIN} -u root health_monitor -e "${sql.replace(/"/g, '\\"')}"`;
    try {
        execSync(command);
    } catch (e) {
        console.error("Query failed:", sql);
        console.error(e.message);
    }
}

function escapeSql(str) {
    if (!str) return 'NULL';
    return `'${str.replace(/'/g, "''")}'`;
}

function main() {
    console.log("Starting Historical Sync to MySQL...");
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(l => l.startsWith('| 202')).reverse();

    console.log(`Processing ${lines.length} lines...`);

    for (const line of lines) {
        const p = line.split('|').map(x => x.trim());
        if (p.length < 9) continue;

        const date = p[1];
        const time = p[2];
        const user = p[3];
        const category = p[4];
        const mealTypeRaw = p[5];
        const title = p[6].replace(/\[📷\]\([^\)]+\)/g, '').trim();
        const carbs = parseInt(p[7]) || 'NULL';
        const cals = parseInt(p[8]) || 'NULL';
        
        const dStr = `${date} ${time}:00`;
        const mealType = category === "Food" ? (mealTypeRaw === "-" ? "Snack" : mealTypeRaw) : 'NULL';
        const photoMatch = p[6].match(/https:\/\/iili\.io\/[^\)]+/);
        const photoUrl = photoMatch ? photoMatch[0] : null;

        const sql = `
            INSERT INTO maria_health_log 
            (entry_title, event_date, user_name, category, meal_type, carbs_est, calories_est, photo_url)
            VALUES 
            (${escapeSql(title)}, ${escapeSql(dStr)}, ${escapeSql(user)}, ${escapeSql(category)}, 
             ${mealType === 'NULL' ? 'NULL' : escapeSql(mealType)}, ${carbs}, ${cals}, ${escapeSql(photoUrl)})
            ON DUPLICATE KEY UPDATE 
            entry_title = VALUES(entry_title),
            carbs_est = VALUES(carbs_est),
            calories_est = VALUES(calories_est),
            photo_url = VALUES(photo_url);
        `;
        
        runQuery(sql);
    }
    console.log("Historical Sync Complete.");

    // 4. Update Dashboard
    try {
        console.log("  -> Updating Backup Dashboard...");
        execSync('node /Users/javier/.openclaw/workspace/scripts/generate_backup_dashboard_data.js');
        execSync('cd /Users/javier/.openclaw/workspace/nightscout-meal-photos && git add data/backups.json && (git commit -m "chore: automated historical sync update" || true) && git push origin main');
    } catch (e) {
        console.error("Dashboard update failed:", e.message);
    }
}

main();
