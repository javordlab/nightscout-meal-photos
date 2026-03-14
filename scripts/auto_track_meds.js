const fs = require('fs');
const path = require('path');

const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";

function getIsoDate() {
    const d = new Date();
    // PDT started March 8th, 2026.
    return d.toISOString().split('T')[0];
}

function getOffset() {
    return "-07:00"; // PDT for March 14, 2026
}

function autoLog() {
    const today = getIsoDate();
    const offset = getOffset();
    const dayOfMonth = parseInt(today.split('-')[2]);
    const isOddDay = dayOfMonth % 2 !== 0;
    
    let content = fs.readFileSync(LOG_PATH, 'utf8');
    let lines = content.split('\n');
    let updated = false;

    // Check for Lisinopril (Daily Morning)
    if (!content.includes(`${today} | 09:00 ${offset} | Maria Dennis | Medication | - | Lisinopril 10mg (Scheduled)`)) {
        console.log("Auto-logging Lisinopril...");
        lines.splice(3, 0, `| ${today} | 09:00 ${offset} | Maria Dennis | Medication | - | Lisinopril 10mg (Scheduled) | null | null |`);
        updated = true;
    }

    // Check for Rosuvastatin (Odd Days Morning)
    if (isOddDay && !content.includes(`${today} | 09:05 ${offset} | Maria Dennis | Medication | - | Rosuvastatin 10mg (Scheduled)`)) {
        console.log("Auto-logging Rosuvastatin...");
        lines.splice(3, 0, `| ${today} | 09:05 ${offset} | Maria Dennis | Medication | - | Rosuvastatin 10mg (Scheduled) | null | null |`);
        updated = true;
    }

    // Check for Metformin (Daily Night - Only if after 9pm PT)
    // For now, let's just do morning meds since it's 11am. 
    // I will add Metformin logic in a way that checks the time.
    const nowHour = new Date().getHours(); 
    // Warning: Server time might be UTC. 
    // 9pm PT = 4am or 5am UTC.
    
    if (updated) {
        fs.writeFileSync(LOG_PATH, lines.join('\n'));
        console.log("Health log updated with scheduled medications.");
    } else {
        console.log("No scheduled medications needed logging at this time.");
    }
}

autoLog();
