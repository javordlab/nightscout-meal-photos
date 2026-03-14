const fs = require('fs');
const LOG_FILE = "/Users/javier/.openclaw/workspace/health_log.md";

function main() {
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n');
  const totals = {};

  lines.forEach(line => {
    if (line.includes('| Food |')) {
      const parts = line.split('|').map(p => p.trim());
      const date = parts[1];
      const cals = parseInt(parts[8]);
      if (!isNaN(cals)) {
        if (!totals[date]) totals[date] = 0;
        totals[date] += cals;
      }
    }
  });

  console.log(JSON.stringify(totals, null, 2));
}

main();
