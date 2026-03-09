const fs = require('fs');
const LOG_FILE = "/Users/javier/.openclaw/workspace/health_log.md";

function main() {
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n');
  const monthlyTotals = {};

  lines.forEach(line => {
    if (line.includes('| Food |')) {
      const parts = line.split('|').map(p => p.trim());
      const date = parts[1];
      const cals = parseInt(parts[8]);
      if (!isNaN(cals)) {
        if (!monthlyTotals[date]) monthlyTotals[date] = 0;
        monthlyTotals[date] += cals;
      }
    }
  });

  const chartData = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    chartData.push({ x: ds, y: monthlyTotals[ds] || 0 });
  }
  console.log(JSON.stringify(chartData, null, 2));
}
main();
