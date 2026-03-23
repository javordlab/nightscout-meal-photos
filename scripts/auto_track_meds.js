const fs = require('fs');

const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";

// Rosuvastatin every-other-day anchor: 2026-03-01 was taken (day 0).
// Take on even days since anchor (0, 2, 4, ...).
const ROSUVASTATIN_ANCHOR = '2026-03-01';

// --- Timezone helpers (America/Los_Angeles) ---

function getLADateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function getLAHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', hour12: false
  }).format(new Date()), 10);
}

function getTZOffset() {
  // Returns '-07:00' (PDT) or '-08:00' (PST) based on current wall clock
  const utcH = new Date().getUTCHours();
  const laH  = getLAHour();
  const diff = ((utcH - laH) + 24) % 24;
  return `-${String(diff).padStart(2, '0')}:00`;
}

// --- Rosuvastatin cycle ---

function shouldTakeRosuvastatin(todayStr) {
  const anchor = new Date(`${ROSUVASTATIN_ANCHOR}T00:00:00Z`);
  const today  = new Date(`${todayStr}T00:00:00Z`);
  const daysSince = Math.round((today - anchor) / 86400000);
  return daysSince % 2 === 0; // even days since anchor = take
}

// --- Log entry builder ---

function entry(today, time, offset, description) {
  return `| ${today} | ${time} ${offset} | Maria Dennis | Medication | - | ${description} | null | null |`;
}

// --- Main ---

function autoLog() {
  const today  = getLADateString();
  const offset = getTZOffset();
  const hour   = getLAHour();

  let content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n');
  const toInsert = [];

  // Helper: only add if not already present anywhere in the file for today
  function addIfMissing(time, description) {
    const marker = `${today} | ${time} ${offset} | Maria Dennis | Medication | - | ${description}`;
    if (!content.includes(marker)) {
      toInsert.push(entry(today, time, offset, description));
      console.log(`  + Queuing: ${description}`);
    }
  }

  // Morning medications (log once hour >= 9)
  if (hour >= 9) {
    addIfMissing('09:00', 'Lisinopril 10mg (Scheduled)');
    addIfMissing('09:10', 'Metformin 500mg (breakfast)');

    if (shouldTakeRosuvastatin(today)) {
      addIfMissing('09:05', 'Rosuvastatin 10mg (Scheduled)');
    }
  }

  // Lunch Metformin (log once hour >= 12)
  if (hour >= 12) {
    addIfMissing('13:00', 'Metformin 500mg (lunch)');
  }

  // Dinner Metformin (log once hour >= 19)
  if (hour >= 19) {
    addIfMissing('19:00', 'Metformin 1000mg (dinner)');
  }

  if (toInsert.length === 0) {
    console.log(`auto_track_meds: nothing to log at hour ${hour} LA (${today}).`);
    return;
  }

  // Insert all new entries after the file header (line 0 = title, line 1 = blank)
  lines.splice(2, 0, ...toInsert);
  fs.writeFileSync(LOG_PATH, lines.join('\n'));
  console.log(`auto_track_meds: logged ${toInsert.length} entry/entries for ${today}.`);
}

autoLog();
