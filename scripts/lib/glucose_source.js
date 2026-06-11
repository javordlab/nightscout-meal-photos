// Shared glucose data loader.
//
// All downstream consumers of CGM readings (daily report, 14d stats, glucose
// summary, charts) read through this module so they share one calculation path.
// The source is the MySQL mirror `health_monitor.glucose_measurements`,
// populated every 30 min by `mysql_glucose_sync.js` from Nightscout.
//
// Nightscout remains the upstream sync source. No script other than
// mysql_glucose_sync.js should read Nightscout SGVs directly.

const { execSync } = require('child_process');

const MYSQL_BIN = process.env.MYSQL_BIN || '/opt/homebrew/opt/mysql@8.4/bin/mysql';
const DB = process.env.MYSQL_DB || 'health_monitor';
const MYSQL_USER = process.env.MYSQL_USER || 'root';

function runQueryTSV(sql) {
  const cmd = `${MYSQL_BIN} -u ${MYSQL_USER} -N -B ${DB} -e "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { maxBuffer: 128 * 1024 * 1024 }).toString();
}

function parseRows(tsv) {
  const rows = [];
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const [nsId, sgvStr, direction, device, millsStr] = line.split('\t');
    const sgv = parseInt(sgvStr, 10);
    const mills = parseInt(millsStr, 10);
    if (!Number.isFinite(sgv) || !Number.isFinite(mills)) continue;
    rows.push({
      _id: nsId,
      sgv,
      direction: direction === 'NULL' ? null : direction,
      device: device === 'NULL' ? null : device,
      date: mills,
      dateString: new Date(mills).toISOString(),
    });
  }
  return rows;
}

// Fetch the most recent N SGV rows (mimics Nightscout `entries.json?count=N`).
// Returned in the same shape as Nightscout entries: {sgv, date, dateString, direction, device, _id}.
function fetchRecentSgvRows(count = 5000) {
  const sql = `SELECT ns_id, sgv, direction, device, mills
               FROM glucose_measurements
               ORDER BY mills DESC
               LIMIT ${parseInt(count, 10)};`;
  return parseRows(runQueryTSV(sql));
}

// Fetch SGV rows within a time window [sinceMills, untilMills] inclusive.
function fetchSgvRowsInWindow(sinceMills, untilMills) {
  const since = parseInt(sinceMills, 10);
  const until = parseInt(untilMills, 10);
  const sql = `SELECT ns_id, sgv, direction, device, mills
               FROM glucose_measurements
               WHERE mills >= ${since} AND mills <= ${until}
               ORDER BY mills ASC;`;
  return parseRows(runQueryTSV(sql));
}

module.exports = {
  fetchRecentSgvRows,
  fetchSgvRowsInWindow,
};
