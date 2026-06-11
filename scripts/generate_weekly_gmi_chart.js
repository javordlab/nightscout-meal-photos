const { spawn } = require('child_process');
const { fetchSgvRowsInWindow } = require('./lib/glucose_source');

const CHART_SCRIPT = "/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/tmp/weekly_gmi_chart.png";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getLADateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function gmiFromMean(meanMgDl) {
  return 3.31 + 0.02392 * meanMgDl;
}

function groupMeanByDate(rows) {
  const sums = {};
  const counts = {};
  for (const r of rows) {
    const ds = getLADateString(new Date(r.date));
    sums[ds] = (sums[ds] || 0) + r.sgv;
    counts[ds] = (counts[ds] || 0) + 1;
  }
  const out = {};
  for (const ds of Object.keys(sums)) {
    out[ds] = sums[ds] / counts[ds];
  }
  return out;
}

function main() {
  const now = Date.now();
  // Fetch 30-day window so we can compute both the 7-day chart bars AND the 30-day average line.
  const sinceMills = now - 30 * 86400000;
  const rows = fetchSgvRowsInWindow(sinceMills, now);
  const dailyMean = groupMeanByDate(rows);

  // Previous 7 days for the chart (excluding today)
  const chartData = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now - i * 86400000);
    const ds = getLADateString(d);
    const mean = dailyMean[ds];
    const gmi = mean ? gmiFromMean(mean) : 0;
    chartData.push({
      x: ds.split('-').slice(1).join('/'),
      y: gmi ? Number(gmi.toFixed(2)) : 0
    });
  }
  chartData.reverse();

  // 30-day average GMI (excluding days with no readings)
  const dailyGMIs = Object.values(dailyMean).map(gmiFromMean);
  const avgGMI = dailyGMIs.length > 0
    ? Number((dailyGMIs.reduce((a, b) => a + b, 0) / dailyGMIs.length).toFixed(2))
    : 0;

  const hour = new Date().getHours();
  const isDark = hour >= 20 || hour < 7;

  const args = [
    CHART_SCRIPT,
    '--type', 'bar',
    '--title', "Weekly GMI Trend",
    '--x-title', 'Date',
    '--y-title', 'GMI (%)',
    '--y-domain', '5,7.5',
    '--no-zero',
    '--y-format', '.2f',
    '--width', 800,
    '--height', 400,
    '--output', OUTPUT_PATH,
    '--bar-labels',
    '--color', '#9b59b6',
    '--hline', `${avgGMI},#e67e22,30d Avg: ${avgGMI.toFixed(2)}`
  ];

  if (isDark) args.push('--dark');

  const child = spawn('/opt/homebrew/bin/node', args);
  child.stdin.write(JSON.stringify(chartData));
  console.log("Chart Data:", JSON.stringify(chartData, null, 2));
  child.stdin.end();

  child.on('close', (code) => {
    if (code === 0) console.log(`Weekly GMI chart generated at: ${OUTPUT_PATH}`);
    else process.exit(code);
  });
}

main();
