const fs = require('fs');
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";

function backfillOffsets() {
    let content = fs.readFileSync(LOG_PATH, 'utf8');
    let lines = content.split('\n');
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('| 202')) {
            const parts = lines[i].split('|');
            const date = parts[1].trim();
            const time = parts[2].trim();
            
            if (time && !time.includes(' ')) {
                const dStr = `${date}T${time}:00`;
                const isPDT = new Date(dStr + "Z") > new Date("2026-03-08T10:00:00Z");
                const offset = isPDT ? "-07:00" : "-08:00";
                
                parts[2] = ` ${time} ${offset} `;
                lines[i] = parts.join('|');
                updated = true;
            }
        }
    }

    if (updated) {
        fs.writeFileSync(LOG_PATH, lines.join('\n'));
        console.log("Backfilled offsets in health_log.md.");
    } else {
        console.log("No offsets needed backfilling.");
    }
}

backfillOffsets();
