const { spawn } = require('child_process');
const fs = require('fs');

const LOG_FILE = "/Users/javier/.openclaw/workspace/health_log.md";
const CHART_SCRIPT = "/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/tmp/weekly_calories_chart.png";

function main() {
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n');
  
  const dailyTotals = {};
  const monthlyTotals = {};

  lines.forEach(line => {
    if (line.includes('| Food |')) {
      const parts = line.split('|').map(p => p.trim());
      const date = parts[1];
      const carbs = parseInt(parts[7]);
      const cals = parseInt(parts[8]);
      
      if (!isNaN(cals)) {
        if (!monthlyTotals[date]) monthlyTotals[date] = 0;
        monthlyTotals[date] += cals;
      }
    }
  });

  // Last 7 days for the chart (including today)
  const chartData = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const total = monthlyTotals[ds] || 0;
    chartData.push({
      x: ds.split('-').slice(1).join('/'),
      y: total
    });
  }
  chartData.reverse();

  // Calculate 30-day average (excluding 0 days)
  const nonZeroDays = Object.values(monthlyTotals).filter(v => v > 0);
  const avgCal = nonZeroDays.length > 0 ? Math.round(nonZeroDays.reduce((a, b) => a + b) / nonZeroDays.length) : 0;

  const hour = new Date().getHours();
  const isDark = hour >= 20 || hour < 7;

  const args = [
    CHART_SCRIPT,
    '--type', 'bar',
    '--title', "Weekly Calorie Intake (Audited)",
    '--y-title', 'Calories (kcal)',
    '--width', 800,
    '--height', 400,
    '--output', OUTPUT_PATH,
    '--bar-labels',
    '--color', '#3498db',
    '--hline', `${avgCal},#e67e22,30d Avg: ${avgCal}`
  ];

  if (isDark) args.push('--dark');

  const child = spawn('node', args);
  child.stdin.write(JSON.stringify(chartData));
  console.log("Chart Data:", JSON.stringify(chartData, null, 2));
  child.stdin.end();

  child.on('close', (code) => {
    if (code === 0) console.log(`Weekly audited chart generated at: ${OUTPUT_PATH}`);
    else process.exit(code);
  });
}

main();
