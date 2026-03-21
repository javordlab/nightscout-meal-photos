#!/usr/bin/env node
// validate_log_integrity.js - Check for unauthorized changes to historical data
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKSPACE = process.cwd();
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const CHECKSUM_PATH = path.join(WORKSPACE, 'data', 'log_integrity.json');

function getChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function validate() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error('❌ health_log.md not found');
    process.exit(1);
  }

  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n');
  
  // We only care about lines older than the last 10 entries (buffer for current work)
  // This allows current logging while protecting history.
  const historicalContent = lines.slice(20).join('\n');
  const currentChecksum = getChecksum(historicalContent);

  if (!fs.existsSync(CHECKSUM_PATH)) {
    console.log('✨ First run: initializing historical checksum...');
    fs.writeFileSync(CHECKSUM_PATH, JSON.stringify({
      last_verified_at: new Date().toISOString(),
      historical_checksum: currentChecksum,
      line_count: lines.length
    }, null, 2));
    return;
  }

  const stored = JSON.parse(fs.readFileSync(CHECKSUM_PATH, 'utf8'));
  
  if (currentChecksum !== stored.historical_checksum) {
    console.error('🛑 INTEGRITY ALERT: Historical log data has been modified!');
    console.error(`Expected: ${stored.historical_checksum}`);
    console.error(`Actual:   ${currentChecksum}`);
    process.exit(1);
  }

  // Update stored state with new line count but keep historical checksum
  // unless we explicitly decide to re-base history.
  console.log('✅ Log integrity verified.');
}

if (require.main === module) {
  validate();
}
