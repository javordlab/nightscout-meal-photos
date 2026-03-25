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
                const _d = new Date(dStr); const _om = -_d.getTimezoneOffset(); const _s = _om >= 0 ? '+' : '-'; const _h = String(Math.floor(Math.abs(_om) / 60)).padStart(2, '0'); const _m = String(Math.abs(_om) % 60).padStart(2, '0');
                const offset = `${_s}${_h}:${_m}`;
                
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
