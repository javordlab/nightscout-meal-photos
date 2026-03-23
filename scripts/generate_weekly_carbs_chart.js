const { spawn } = require('child_process');
const fs = require('fs');

const LOG_FILE = "/Users/javier/.openclaw/workspace/health_log.md";
const CHART_SCRIPT = "/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/tmp/weekly_carbs_chart.png";

function getLADateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function main() {
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n');

  const dailyTotals = {};
  const monthlyTotals = {};

  lines.forEach(line => {
    if (line.includes('| Food |')) {
      const parts = line.split('|').map(p => p.trim());
      const date = parts[1];
      const carbsIdx = parts.length - 3;
      const carbs = parseInt(parts[carbsIdx]);

      if (!isNaN(carbs)) {
        if (!monthlyTotals[date]) monthlyTotals[date] = 0;
        monthlyTotals[date] += carbs;
      }
    }
  });

  // Previous 7 days for the chart (excluding today)
  const chartData = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const ds = getLADateString(d);
    const total = monthlyTotals[ds] || 0;
    chartData.push({
      x: ds.split('-').slice(1).join('/'),
      y: total
    });
  }
  chartData.reverse();

  const nonZeroDays = Object.values(monthlyTotals).filter(v => v > 0);
  const avgCarb = nonZeroDays.length > 0 ? Math.round(nonZeroDays.reduce((a, b) => a + b) / nonZeroDays.length) : 0;

  const hour = new Date().getHours();
  const isDark = hour >= 20 || hour < 7;

  const args = [
    CHART_SCRIPT,
    '--type', 'bar',
    '--title', "Weekly Carb Intake (Audited)",
    '--y-title', 'Carbs (g)',
    '--width', 800,
    '--height', 400,
    '--output', OUTPUT_PATH,
    '--bar-labels',
    '--color', '#2ecc71',
    '--hline', `${avgCarb},#e67e22,30d Avg: ${avgCarb}`
  ];

  if (isDark) args.push('--dark');

  const child = spawn('node', args);
  child.stdin.write(JSON.stringify(chartData));
  child.stdin.end();

  child.on('close', (code) => {
    if (code === 0) console.log(`Weekly audited carbs chart generated at: ${OUTPUT_PATH}`);
    else process.exit(code);
  });
}

main();
