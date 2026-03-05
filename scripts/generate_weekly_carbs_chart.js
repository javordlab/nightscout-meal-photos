const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');

const NOTION_KEY = fs.readFileSync('/Users/javier/.config/notion/api_key', 'utf8').trim();
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const CHART_SCRIPT = "/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/tmp/weekly_carbs_chart.png";

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => resolve(JSON.parse(responseBody)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

  const payload = {
    filter: {
      and: [
        { property: "Category", select: { equals: "Food" } },
        { property: "Date", date: { on_or_after: dateStr } }
      ]
    },
    sorts: [{ property: "Date", direction: "ascending" }]
  };

  const data = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, payload);
  
  const monthlyTotals = {};
  data.results.forEach(item => {
    const dateProp = item.properties.Date.date;
    if (!dateProp) return;
    const date = dateProp.start.split('T')[0];
    const val = item.properties["Carbs (est)"].number || 0;
    if (!monthlyTotals[date]) monthlyTotals[date] = 0;
    monthlyTotals[date] += val;
  });

  const dailyTotals = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    dailyTotals[ds] = monthlyTotals[ds] || 0;
  }

  const chartData = Object.keys(dailyTotals)
    .sort()
    .map(date => ({
      x: date.split('-').slice(1).join('/'),
      y: dailyTotals[date]
    }));

  const nonZeroDays = Object.values(monthlyTotals).filter(v => v > 0);
  const avgCarb = nonZeroDays.length > 0 ? Math.round(nonZeroDays.reduce((a, b) => a + b) / nonZeroDays.length) : 0;

  const hour = new Date().getHours();
  const isDark = hour >= 20 || hour < 7;

  const args = [
    CHART_SCRIPT,
    '--type', 'bar',
    '--title', "Weekly Carb Intake",
    '--y-title', 'Carbs (g)',
    '--width', '800',
    '--height', '400',
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
    if (code === 0) console.log(`Weekly carbs chart generated with average line: ${avgCarb}g`);
    else process.exit(code);
  });
}

main().catch(console.error);
