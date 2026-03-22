#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const OUTPUT_DIR = path.join(WORKSPACE, 'data');
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const TZ = 'America/Los_Angeles';

function laDateString(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateString, delta) {
  const dt = new Date(`${dateString}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '[]'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values, avg) {
  if (values.length === 0) return null;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateGlucoseStats(entries) {
  const values = entries.map(e => e.sgv).filter(v => Number.isFinite(v));
  if (values.length === 0) {
    return {
      count: 0,
      average: null,
      tir: null,
      gmi: null,
      stdDev: null,
      cv: null
    };
  }

  const average = mean(values);
  const inRange = values.filter(v => v >= 70 && v <= 180).length;
  const tir = (inRange / values.length) * 100;
  const gmi = 3.31 + (0.02392 * average);
  const sd = stdDev(values, average);
  const cv = sd && average ? (sd / average) * 100 : null;

  return {
    count: values.length,
    average,
    tir,
    gmi,
    stdDev: sd,
    cv
  };
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + (Number.isFinite(row[key]) ? row[key] : 0), 0);
}

function fmt(value, digits = 1) {
  if (!Number.isFinite(value)) return 'N/A';
  return Number(value).toFixed(digits);
}

async function main(options = {}) {
  const now = new Date();
  const reportDate = options.reportDate || laDateString(now); // date report runs
  const targetDate = options.targetDate || addDays(reportDate, -1); // full previous day

  const start14 = addDays(targetDate, -13);
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));

  const nsEntries = await fetchJson(`${NIGHTSCOUT_URL}/api/v1/entries.json?count=5000`);
  const sgvRows = (nsEntries || []).filter(e => Number.isFinite(e?.sgv) && Number.isFinite(e?.date));

  const glucosePrevDay = sgvRows.filter(e => laDateString(new Date(e.date)) === targetDate);
  const glucose14Days = sgvRows.filter(e => {
    const d = laDateString(new Date(e.date));
    return d >= start14 && d <= targetDate;
  });

  const statsDay = calculateGlucoseStats(glucosePrevDay);
  const stats14 = calculateGlucoseStats(glucose14Days);

  const highs = glucosePrevDay.filter(e => e.sgv > 180).sort((a, b) => b.sgv - a.sgv);
  const lows = glucosePrevDay.filter(e => e.sgv < 70).sort((a, b) => a.sgv - b.sgv);
  const peak = glucosePrevDay.length > 0 ? glucosePrevDay.reduce((m, e) => e.sgv > m.sgv ? e : m, glucosePrevDay[0]) : null;

  const entries = normalized.entries || [];
  const foodPrevDay = entries.filter(e => e.category === 'Food' && e.date === targetDate);
  const medsPrevDay = entries.filter(e => e.category === 'Medication' && e.date === targetDate);

  const food14 = entries.filter(e => e.category === 'Food' && e.date >= start14 && e.date <= targetDate);
  const byDate = {};
  for (const e of food14) {
    byDate[e.date] = byDate[e.date] || { carbs: 0, cals: 0, protein: 0, meals: 0 };
    byDate[e.date].carbs += Number.isFinite(e.carbsEst) ? e.carbsEst : 0;
    byDate[e.date].cals += Number.isFinite(e.caloriesEst) ? e.caloriesEst : 0;
    byDate[e.date].protein += Number.isFinite(e.proteinEst) ? e.proteinEst : 0;
    byDate[e.date].meals += 1;
  }
  const days = Object.keys(byDate).sort();
  const avg14 = {
    carbs: days.length ? Object.values(byDate).reduce((s, d) => s + d.carbs, 0) / days.length : 0,
    cals: days.length ? Object.values(byDate).reduce((s, d) => s + d.cals, 0) / days.length : 0,
    protein: days.length ? Object.values(byDate).reduce((s, d) => s + d.protein, 0) / days.length : 0,
    meals: days.length ? Object.values(byDate).reduce((s, d) => s + d.meals, 0) / days.length : 0,
    days: days.length
  };

  const report = `DAILY HEALTH REPORT\nDate: ${reportDate}\nCoverage window: ${targetDate} 00:00-23:59 PT (full previous day)\nGenerated time: ${new Date().toISOString()}\nModel: ChatGPT coding assistant (OpenAI)\n\n1) Previous-day Glucose Summary\n- Average glucose: ${fmt(statsDay.average, 1)} mg/dL\n- Time in Range (70-180): ${fmt(statsDay.tir, 1)}%\n- GMI: ${fmt(statsDay.gmi, 2)}%\n- Standard deviation: ${fmt(statsDay.stdDev, 1)} mg/dL\n- CV: ${fmt(statsDay.cv, 1)}%\n- Data points used: ${statsDay.count}\n\n2) 14-day Trends (ending ${targetDate})\n- Average glucose: ${fmt(stats14.average, 1)} mg/dL\n- Time in Range (70-180): ${fmt(stats14.tir, 1)}%\n- GMI: ${fmt(stats14.gmi, 2)}%\n- Standard deviation: ${fmt(stats14.stdDev, 1)} mg/dL\n- CV: ${fmt(stats14.cv, 1)}%\n- Data points used: ${stats14.count}\n\n3) Nutrition (${targetDate})\n- Meals logged: ${foodPrevDay.length}\n- Total carbs: ${fmt(sum(foodPrevDay, 'carbsEst'), 1)} g\n- Total calories: ${fmt(sum(foodPrevDay, 'caloriesEst'), 0)} kcal\n- Total protein: ${fmt(sum(foodPrevDay, 'proteinEst'), 1)} g\n\n4) Nutrition (14-day daily average ending ${targetDate})\n- Average carbs/day: ${fmt(avg14.carbs, 1)} g\n- Average calories/day: ${fmt(avg14.cals, 1)} kcal\n- Average protein/day: ${fmt(avg14.protein, 1)} g\n- Average meals/day: ${fmt(avg14.meals, 1)}\n- Days in window with food entries: ${avg14.days}\n\n5) Medication Status (${targetDate})\n${medsPrevDay.length ? medsPrevDay.map(m => `- ${m.timestamp}: ${m.title}`).join('\n') : '- No medication entries logged'}\n\n6) Outliers (${targetDate})\n- High readings >180: ${highs.length}\n- Low readings <70: ${lows.length}\n- Max glucose: ${peak ? `${peak.sgv} mg/dL at ${peak.dateString || new Date(peak.date).toISOString()}` : 'N/A'}\n\n7) Supervisor Analysis\n- This report now uses full previous-day midnight-to-midnight coverage to eliminate run-time drift.\n- Continue monitoring post-dinner excursions if repeated peaks >180 appear.\n`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(OUTPUT_DIR, `daily_report_${reportDate}.txt`);
  fs.writeFileSync(reportPath, report);

  const metaPath = path.join(OUTPUT_DIR, 'daily_report_latest.json');
  fs.writeFileSync(metaPath, JSON.stringify({ reportDate, targetDate, reportPath, generatedAt: new Date().toISOString() }, null, 2) + '\n');

  console.log(reportPath);
  return { reportPath, reportDate, targetDate };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const reportDateArg = args.find(a => a.startsWith('--report-date='));
  const targetDateArg = args.find(a => a.startsWith('--target-date='));
  const reportDate = reportDateArg ? reportDateArg.split('=')[1] : null;
  const targetDate = targetDateArg ? targetDateArg.split('=')[1] : null;

  main({ reportDate, targetDate }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, laDateString, addDays, calculateGlucoseStats };
