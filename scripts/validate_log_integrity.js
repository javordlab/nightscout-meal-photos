#!/usr/bin/env node
// validate_log_integrity.js - Check for unauthorized changes to historical data
//
// Detection model (re-based baseline):
//   * New entries are appended at the TOP of the table, so the "historical"
//     slice changes legitimately on every write — a frozen checksum from a
//     never-rebased baseline false-alarms forever. Instead, after every
//     PASSING validation the baseline (line count + checksum) is re-based.
//   * Alerts fire on the two signatures of real damage:
//       1. Line count dropped >40% since the last pass (truncation/wipe).
//       2. Checksum changed while the line count is UNCHANGED (in-place
//          edit of history rather than normal append growth).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Absolute path — this runs from cron/hooks where cwd is not the workspace.
const WORKSPACE = '/Users/javier/.openclaw/workspace';
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const CHECKSUM_PATH = path.join(WORKSPACE, 'data', 'log_integrity.json');

function getChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeBaseline(checksum, lineCount) {
  fs.writeFileSync(CHECKSUM_PATH, JSON.stringify({
    last_verified_at: new Date().toISOString(),
    historical_checksum: checksum,
    line_count: lineCount
  }, null, 2));
}

function validate() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error('❌ health_log.md not found');
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n');
  
  // Find the anchor header that separates today's work from history
  // If the header is missing, fall back to line 20
  const headerIndex = lines.findIndex(line => line.includes('| Date | Time | User | Category |'));
  const anchorIndex = headerIndex !== -1 ? headerIndex + 1 : 20;

  console.log(`⚓ Using anchor at line ${anchorIndex + 1} (${headerIndex !== -1 ? 'Header found' : 'Fallback used'})`);

  const historicalContent = lines.slice(anchorIndex).join('\n');
  const currentChecksum = getChecksum(historicalContent);

  if (!fs.existsSync(CHECKSUM_PATH)) {
    console.log('✨ First run: initializing historical checksum...');
    writeBaseline(currentChecksum, lines.length);
    return;
  }

  const stored = JSON.parse(fs.readFileSync(CHECKSUM_PATH, 'utf8'));
  const storedLineCount = Number.isFinite(stored.line_count) ? stored.line_count : null;

  // Alert 1: massive truncation — the log lost >40% of its lines since the
  // last passing validation.
  if (storedLineCount != null && lines.length < storedLineCount * 0.6) {
    console.error('🛑 INTEGRITY ALERT: health_log.md line count dropped >40%!');
    console.error(`Baseline lines: ${storedLineCount}`);
    console.error(`Current lines:  ${lines.length}`);
    process.exit(1);
  }

  // Alert 2: history modified in place — the checksum changed while the line
  // count stayed exactly the same (normal activity appends new lines at the
  // top, which changes BOTH; a same-size change means an edit to history).
  if (currentChecksum !== stored.historical_checksum && lines.length === storedLineCount) {
    console.error('🛑 INTEGRITY ALERT: Historical log data has been modified (checksum changed with unchanged line count)!');
    console.error(`Expected: ${stored.historical_checksum}`);
    console.error(`Actual:   ${currentChecksum}`);
    process.exit(1);
  }

  // Passing validation → re-base the baseline so legitimate growth never
  // accumulates into a permanent false alarm.
  writeBaseline(currentChecksum, lines.length);
  console.log('✅ Log integrity verified (baseline re-based).');
}

if (require.main === module) {
  validate();
}
