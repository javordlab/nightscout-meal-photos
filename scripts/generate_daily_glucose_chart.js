const https = require('https');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const CHART_SCRIPT = "/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/tmp/daily_glucose_chart.png";

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    const now = new Date();
    // End of yesterday (Start of today local time)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    // Start of yesterday (24h before end)
    const start = new Date(new Date(end).getTime() - 24 * 60 * 60 * 1000).toISOString();
    
    console.log(`Generating Daily chart: ${start} to ${end}`);
    
    const url = `${NS_URL}/api/v1/entries/sgv.json?find[dateString][$gte]=${start}&find[dateString][$lte]=${end}&count=300`;
    const entries = await fetchJson(url);
    
    const chartData = entries
      .filter(e => e.sgv)
      .map(e => ({
        x: new Date(e.date).toISOString(),
        y: e.sgv
      }))
      .reverse();

    if (chartData.length === 0) {
      console.error("No glucose data found.");
      process.exit(1);
    }

    const hour = new Date().getHours();
    const isDark = hour >= 20 || hour < 7;

    const args = [
      CHART_SCRIPT,
      '--type', 'line',
      '--x-type', 'temporal',
      '--title', "Maria's Glucose - Previous Day",
      '--y-title', 'mg/dL',
      '--y-domain', '40,300',
      '--hline', '70,#ff9f43,Low',
      '--hline', '180,#ee5253,High',
      '--width', '800',
      '--height', '400',
      '--output', OUTPUT_PATH
    ];

    if (isDark) args.push('--dark');

    const child = spawn('node', args);
    child.stdin.write(JSON.stringify(chartData));
    child.stdin.end();

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`Chart generated at: ${OUTPUT_PATH}`);
      } else {
        process.exit(code);
      }
    });

  } catch (error) {
    console.error("Error generating chart:", error.message);
    process.exit(1);
  }
}

main();
