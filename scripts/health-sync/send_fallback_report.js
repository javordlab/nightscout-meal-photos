#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { markReportSent } = require('./report_watchdog');
const { main: generateDailyReport } = require('../generate_daily_report');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const OUTPUT_PATH = path.join(WORKSPACE, 'data', 'fallback_report.txt');

async function main() {
  const generated = await generateDailyReport();

  const lines = [
    'FALLBACK HEALTH REPORT',
    `Generated at: ${new Date().toISOString()}`,
    'Reason: Primary 09:30 report was missing by 09:32 PT',
    `Daily report generated at: ${generated.reportPath}`,
    'Action: Fallback report emitted and watchdog heartbeat updated.'
  ];

  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n');
  markReportSent('watchdog_fallback');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
