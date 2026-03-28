const NIGHTSCOUT_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_API_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const fs = require('fs');
const { execSync } = require('child_process');

const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";
const SUPPRESSION_PATH = "/Users/javier/.openclaw/workspace/data/med_suppression.json";

// Load suppression list — entries the auto-tracker must never re-log
// Format: [{ date: "YYYY-MM-DD", description: "Metformin 500mg (lunch)", suppressedAt: ISO }]
function loadSuppression() {
  try { return JSON.parse(fs.readFileSync(SUPPRESSION_PATH, 'utf8')); }
  catch { return []; }
}

function isSuppressed(today, description) {
  const list = loadSuppression();
  return list.some(s => s.date === today && s.description === description);
}

function suppress(today, description) {
  const list = loadSuppression();
  if (!isSuppressed(today, description)) {
    list.push({ date: today, description, suppressedAt: new Date().toISOString() });
    fs.mkdirSync(require('path').dirname(SUPPRESSION_PATH), { recursive: true });
    fs.writeFileSync(SUPPRESSION_PATH, JSON.stringify(list, null, 2) + '\n');
    console.log(`  suppress: ${today} ${description}`);
  }
}

// Rosuvastatin every-other-day anchor: 2026-03-01 was taken (day 0).
// Take on even days since anchor (0, 2, 4, ...).
const ROSUVASTATIN_ANCHOR = '2026-03-01';

// --- Timezone helpers (host system timezone) ---
const _SYS_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getLADateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: _SYS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function getLAHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: _SYS_TZ,
    hour: 'numeric', hour12: false
  }).format(new Date()), 10);
}

function getTZOffset() {
  // Use Intl.DateTimeFormat to get parts in the host's actual timezone (no hardcoded offset)
  const entryDate = new Date();
  const offsetTotalMins = -entryDate.getTimezoneOffset();
  const offsetSign = offsetTotalMins >= 0 ? '+' : '-';
  const offsetHrs = String(Math.floor(Math.abs(offsetTotalMins) / 60)).padStart(2, '0');
  const offsetMins = String(Math.abs(offsetTotalMins) % 60).padStart(2, '0');
  return `${offsetSign}${offsetHrs}:${offsetMins}`;
}

// --- BG Helper ---

function getBG() {
  try {
    const result = execSync(
      `curl -s "${NIGHTSCOUT_URL}/api/v1/entries.json?count=1" -H "API-SECRET: ${NIGHTSCOUT_API_SECRET}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const data = JSON.parse(result);
    if (data && data[0]) {
      return `(BG: ${data[0].sgv} mg/dL ${data[0].direction || 'Flat'})`;
    }
  } catch (e) {
    console.log('BG fetch failed:', e.message);
  }
  return '(BG: Unknown)';
}

// --- Rosuvastatin cycle ---

function shouldTakeRosuvastatin(todayStr) {
  const anchor = new Date(`${ROSUVASTATIN_ANCHOR}T00:00:00Z`);
  const today  = new Date(`${todayStr}T00:00:00Z`);
  const daysSince = Math.round((today - anchor) / 86400000);
  return daysSince % 2 === 0; // even days since anchor = take
}

// --- Log entry builder ---

function entry(today, time, offset, description, bg) {
  return `| ${today} | ${time} ${offset} | Maria Dennis | Medication | - | Medication: ${description} ${bg} | null | null |`;
}

// --- Main ---

function autoLog() {
  const today  = getLADateString();
  const offset = getTZOffset();
  const hour   = getLAHour();

  let content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n');
  const toInsert = [];
  let currentBg = null;

  // Helper: only add if not already present AND not suppressed
  function addIfMissing(time, description) {
    // Check suppression list first (manually deleted entries)
    if (isSuppressed(today, description)) {
      console.log(`  skip (suppressed): Medication: ${description}`);
      return;
    }
    // Check if any variant of this medication description already exists today
    // Use loose match: date + description keyword (ignores exact time/offset)
    const descLower = description.toLowerCase();
    const alreadyLogged = lines.some(l => {
      if (!l.includes(today) || !l.includes('Medication')) return false;
      return l.toLowerCase().includes(descLower.split(' ')[0]) && // e.g. "metformin", "lisinopril"
             l.toLowerCase().includes(descLower.split('(')[1]?.replace(')', '').trim() || ''); // e.g. "lunch", "breakfast"
    });
    if (!alreadyLogged) {
      if (!currentBg) currentBg = getBG();
      toInsert.push(entry(today, time, offset, description, currentBg));
      console.log(`  + Queuing: Medication: ${description} ${currentBg}`);
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

// CLI: node auto_track_meds.js --suppress "2026-03-27" "Metformin 500mg (lunch)"
const args = process.argv.slice(2);
if (args[0] === '--suppress') {
  const [, date, description] = args;
  if (!date || !description) { console.error('Usage: --suppress <date> <description>'); process.exit(1); }
  suppress(date, description);
  console.log(`Suppressed "${description}" for ${date}`);
} else {
  autoLog();
}
