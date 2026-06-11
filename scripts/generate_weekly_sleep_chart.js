#!/usr/bin/env node
/**
 * Generate the daily-report weekly sleep chart.
 *
 * 7-night stacked bars (Deep + Core + REM + Awake bottom→top) with the 7-day
 * average totalSleep as a dashed red line. Width 520 × height 340, matching
 * the locked Telegram preview from 2026-05-18.
 *
 * Reads Sleep entries from health_log.md, parses stage durations out of the
 * "Sleep: 7h 28m · Deep ... · REM ... · Core ... · Awake ..." title format
 * (same regex pattern as normalize_health_log.js).
 *
 * Wiring: hooked into send_daily_charts_telegram.js as the 5th chart.
 */
const { spawn } = require('child_process');
const fs = require('fs');

const LOG_FILE     = '/Users/javier/.openclaw/workspace/health_log.md';
const CHART_SCRIPT = '/Users/javier/.openclaw/workspace/skills/chart-image/scripts/chart.mjs';
const OUTPUT_PATH  = '/Users/javier/.openclaw/workspace/tmp/weekly_sleep_chart.png';
const SPEC_PATH    = '/Users/javier/.openclaw/workspace/tmp/weekly_sleep_chart_spec.json';

const SLEEP_TOTAL_REGEX = /Sleep:\s*(\d+)h\s*(\d+)m/i;
const SLEEP_STAGE_REGEX = /\b(Deep|REM|Core|Awake)\s+(\d+)h\s*(\d+)m/gi;

function parseSleepTitle(title) {
  const total = title.match(SLEEP_TOTAL_REGEX);
  if (!total) return null;
  const out = {
    hours: Number(total[1]) + Number(total[2]) / 60,
    deep: 0, rem: 0, core: 0, awake: 0,
  };
  let m;
  SLEEP_STAGE_REGEX.lastIndex = 0;
  while ((m = SLEEP_STAGE_REGEX.exec(title)) !== null) {
    out[m[1].toLowerCase()] = Number(m[2]) + Number(m[3]) / 60;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

function localDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function main() {
  const content = fs.readFileSync(LOG_FILE, 'utf8');

  // Index Sleep entries by event_date — last write wins if multiple entries
  // for the same date exist (e.g. legacy text-only + HAE-sourced — prefer
  // whichever has the more complete stage breakdown).
  const byDate = {};
  for (const line of content.split('\n')) {
    if (!line.includes('| Sleep |')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 9) continue;
    const date = parts[1];
    const titleParts = parts.slice(6, parts.length - 2);
    const title = titleParts.join(' | ');
    const stages = parseSleepTitle(title);
    if (!stages) continue;
    const prev = byDate[date];
    if (!prev || (stages.hours > 0 && (!prev.hours || prev.hours === 0))) {
      byDate[date] = stages;
    }
  }

  // Last 7 days ending today
  const today = new Date();
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    last7.push(localDateStr(d));
  }

  const chartData = [];
  const totals = [];
  const stageMeta = [
    { label: 'Deep',  key: 'deep',  order: 1 },
    { label: 'Core',  key: 'core',  order: 2 },
    { label: 'REM',   key: 'rem',   order: 3 },
    { label: 'Awake', key: 'awake', order: 4 },
  ];
  for (const d of last7) {
    const s = byDate[d];
    if (!s) continue;
    for (const meta of stageMeta) {
      chartData.push({
        date: d,
        stage: meta.label,
        hours: s[meta.key] || 0,
        stageOrder: meta.order,
      });
    }
    totals.push(s.hours);
  }

  if (chartData.length === 0) {
    console.warn('weekly_sleep_chart: no Sleep entries in last 7 days — skipping chart generation');
    process.exit(0);
  }

  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;

  const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: 520,
    height: 340,
    background: 'white',
    padding: 24,
    title: {
      text: 'Maria — Sleep last 7 nights',
      subtitle: `Avg ${avg.toFixed(2)}h`,
      anchor: 'start',
      fontSize: 16,
      subtitleColor: '#888',
    },
    data: { values: chartData },
    layer: [
      {
        mark: { type: 'bar' },
        encoding: {
          x: {
            field: 'date',
            type: 'ordinal',
            axis: { title: null, labelAngle: -60, labelExpr: 'slice(datum.value, 5)' },
          },
          y: {
            field: 'hours',
            type: 'quantitative',
            stack: 'zero',
            axis: { title: 'Hours', tickMinStep: 1 },
          },
          color: {
            field: 'stage',
            type: 'nominal',
            scale: {
              domain: ['Deep', 'Core', 'REM', 'Awake'],
              range:  ['#1f4e8c', '#6ea8ff', '#b297ff', '#d3d3d3'],
            },
            legend: { title: 'Stage', orient: 'top' },
          },
          order: { field: 'stageOrder', type: 'quantitative' },
        },
      },
      {
        data: { values: [{ avg: Math.round(avg * 100) / 100 }] },
        mark: { type: 'rule', color: '#e63946', strokeWidth: 2, strokeDash: [6, 4] },
        encoding: { y: { field: 'avg', type: 'quantitative' } },
      },
    ],
  };

  fs.mkdirSync('/Users/javier/.openclaw/workspace/tmp', { recursive: true });
  fs.writeFileSync(SPEC_PATH, JSON.stringify(spec));

  const child = spawn('/opt/homebrew/bin/node', [CHART_SCRIPT, '--spec', SPEC_PATH, '--output', OUTPUT_PATH], { stdio: 'inherit' });
  child.on('close', code => {
    if (code === 0) console.log(`Weekly sleep chart generated at: ${OUTPUT_PATH}`);
    else process.exit(code);
  });
}

main();
