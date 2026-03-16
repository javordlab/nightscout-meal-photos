const https = require('https');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const CHART_SCRIPT = "/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/tmp/glucose_chart.png";

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end')
    });
  });
}

// Correcting the fetch function
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
    // Fetch last 24h entries (288 entries for 5-min intervals)
    // Exclude current day, show previous 7
    const now = new Date();
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const startOf7DaysAgo = new Date(endOfYesterday.getTime() - 7 * 24 * 60 * 60 * 1000);
    const entries = await fetchJson(`${NS_URL}/api/v1/entries.json?count=300`);
    
    // Format data for Vega-Lite
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

    // Determine if we should use dark mode
    const hour = new Date().getHours();
    const isDark = hour >= 20 || hour < 7;

    const args = [
      CHART_SCRIPT,
      '--type', 'line',
      '--x-type', 'temporal',
      '--title', "Maria's Glucose - Last 24 Hours",
      '--y-title', 'mg/dL',
      '--y-domain', '40,300',
      '--hline', '70,#ff9f43,Low',
      '--hline', '180,#ee5253,High',
      '--width', '800',
      '--height', '400',
      '--output', OUTPUT_PATH
    ];

    if (isDark) args.push('--dark');

    // Spawn process and pipe data to stdin
    const child = spawn('node', args);
    
    child.stdin.write(JSON.stringify(chartData));
    child.stdin.end();

    child.stdout.on('data', (data) => console.log(data.toString()));
    child.stderr.on('data', (data) => console.error(data.toString()));

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
