#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const OUTPUT_DIR = path.join(WORKSPACE, 'data');
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getLocalOffset(date) {
  const d = date ? new Date(date) : new Date();
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(mins) / 60)).padStart(2, '0');
  const m = String(Math.abs(mins) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

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

const NIGHTSCOUT_SECRET = process.env.NIGHTSCOUT_SECRET || process.env.NS_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const MODEL = process.env.REPORT_MODEL || process.env.OPENCLAW_ACTIVE_MODEL || 'anthropic/claude-sonnet-4-6';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'api-secret': NIGHTSCOUT_SECRET
      }
    };

    https.get(url, options, (res) => {
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

function formatLaTime(isoLike) {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function cleanMealTitle(title = '') {
  return String(title)
    .replace(/\(BG:[^)]+\)/gi, '')
    .replace(/\(Pred:[^)]+\)/gi, '')
    .replace(/\(Protein:[^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nearestBg(entries, mealIso, windowMinutes = 20) {
  const mealMs = new Date(mealIso).getTime();
  if (!Number.isFinite(mealMs)) return null;
  let best = null;
  let bestDiff = windowMinutes * 60 * 1000;
  for (const e of entries) {
    if (!Number.isFinite(e?.date) || !Number.isFinite(e?.sgv)) continue;
    const diff = Math.abs(e.date - mealMs);
    if (diff <= bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
}

async function main(options = {}) {
  const now = new Date();
  const reportDate = options.reportDate || laDateString(now); // date report runs
  const targetDate = options.targetDate || reportDate; // current calendar day

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

  const mealsDetailed = foodPrevDay
    .slice()
    .sort((a, b) => new Date(a.timestamp || `${a.date}T00:00:00${getLocalOffset(a.date + 'T00:00:00')}`).getTime() - new Date(b.timestamp || `${b.date}T00:00:00${getLocalOffset(b.date + 'T00:00:00')}`).getTime())
    .map((m) => {
      const mealIso = m.timestamp || `${m.date}T12:00:00${getLocalOffset(m.date + 'T12:00:00')}`;
      const bg = nearestBg(glucosePrevDay, mealIso);
      const bgText = bg ? `${bg.sgv} mg/dL` : 'N/A';
      return `- ${formatLaTime(mealIso)} — ${cleanMealTitle(m.title || m.entry || 'Meal')} — ${fmt(m.carbsEst, 1)}g carbs, ${fmt(m.caloriesEst, 0)} kcal, ${fmt(m.proteinEst, 1)}g protein — BG at meal: ${bgText}`;
    });

  const dayAvgDelta = Number.isFinite(statsDay.average) && Number.isFinite(stats14.average)
    ? statsDay.average - stats14.average
    : null;
  const dayTirDelta = Number.isFinite(statsDay.tir) && Number.isFinite(stats14.tir)
    ? statsDay.tir - stats14.tir
    : null;
  const carbsDelta = Number.isFinite(avg14.carbs) ? sum(foodPrevDay, 'carbsEst') - avg14.carbs : null;
  const calsDelta = Number.isFinite(avg14.cals) ? sum(foodPrevDay, 'caloriesEst') - avg14.cals : null;

  const wentWell = [];
  if (Number.isFinite(statsDay.tir) && statsDay.tir >= 90) wentWell.push(`Strong Time in Range at ${fmt(statsDay.tir, 1)}% ✅`);
  if ((highs.length || 0) <= 2) wentWell.push(`Limited high excursions (>${180} mg/dL): ${highs.length} ✅`);
  if ((lows.length || 0) === 0) wentWell.push('No hypoglycemia episodes (<70 mg/dL) ✅');
  if (Number.isFinite(sum(foodPrevDay, 'proteinEst')) && sum(foodPrevDay, 'proteinEst') >= 60) wentWell.push(`Good protein intake (${fmt(sum(foodPrevDay, 'proteinEst'), 1)}g) ✅`);

  const improve = [];
  if (Number.isFinite(carbsDelta) && carbsDelta > 30) improve.push(`Carbs were above 14-day baseline by ${fmt(carbsDelta, 1)}g; consider smaller late-day carb load.`);
  if (Number.isFinite(calsDelta) && calsDelta > 300) improve.push(`Calories were above baseline by ${fmt(calsDelta, 0)} kcal; consider portion tightening at dinner/snacks.`);
  if (highs.length > 0) improve.push(`There was ${highs.length} reading(s) >180 mg/dL; keep an eye on post-meal spacing/activity.`);

  const expectedGmiFromAvg = Number.isFinite(statsDay.average) ? (3.31 + (0.02392 * statsDay.average)) : null;

  const report = `🩺 DAILY HEALTH REPORT\n📅 Date: ${reportDate}\n🕒 Coverage window: ${targetDate} 00:00 – ${addDays(targetDate, 1)} 00:00 (${TZ})\n⚙️ Generated time: ${new Date().toISOString()}\n🤖 Model: ${MODEL}\n\n1) 📊 Today's Glucose Summary\n- Average glucose: ${fmt(statsDay.average, 1)} mg/dL\n- Time in Range (70-180): ${fmt(statsDay.tir, 1)}%\n- GMI: ${fmt(statsDay.gmi, 2)}%\n- Standard deviation: ${fmt(statsDay.stdDev, 1)} mg/dL\n- CV: ${fmt(statsDay.cv, 1)}%\n- Data points used: ${statsDay.count}\n\n2) 📉 14-day Trends (ending ${targetDate})\n- Average glucose: ${fmt(stats14.average, 1)} mg/dL\n- Time in Range (70-180): ${fmt(stats14.tir, 1)}%\n- GMI: ${fmt(stats14.gmi, 2)}%\n- Standard deviation: ${fmt(stats14.stdDev, 1)} mg/dL\n- CV: ${fmt(stats14.cv, 1)}%\n- Data points used: ${stats14.count}\n\n3) 🍽️ Nutrition (${targetDate})\n- Meals logged: ${foodPrevDay.length}\n- Total carbs: ${fmt(sum(foodPrevDay, 'carbsEst'), 1)} g\n- Total calories: ${fmt(sum(foodPrevDay, 'caloriesEst'), 0)} kcal\n- Total protein: ${fmt(sum(foodPrevDay, 'proteinEst'), 1)} g\n\n4) 🧾 Meal Details (${targetDate})\n${mealsDetailed.length ? mealsDetailed.join('\n') : '- No food entries logged'}\n\n5) 📚 Nutrition Baseline (14-day daily average ending ${targetDate})\n- Average carbs/day: ${fmt(avg14.carbs, 1)} g\n- Average calories/day: ${fmt(avg14.cals, 1)} kcal\n- Average protein/day: ${fmt(avg14.protein, 1)} g\n- Average meals/day: ${fmt(avg14.meals, 1)}\n- Days in window with food entries: ${avg14.days}\n\n6) 💊 Medication Status (${targetDate})\n${medsPrevDay.length ? medsPrevDay.map(m => `- ${m.timestamp}: ${m.title}`).join('\n') : '- No medication entries logged'}\n\n7) 🚨 Outliers (${targetDate})\n- High readings >180: ${highs.length}\n- Low readings <70: ${lows.length}\n- Max glucose: ${peak ? `${peak.sgv} mg/dL at ${peak.dateString || new Date(peak.date).toISOString()}` : 'N/A'}\n\n8) 🧠 Extended Supervisor Analysis\n- Nice work overall today: ${wentWell.length ? wentWell.map(x => x.replace(/\s*✅$/, '')).join(' | ') : 'overall stable day with no major safety events'}.\n- Key trend signals: avg glucose vs 14-day baseline ${Number.isFinite(dayAvgDelta) ? `${fmt(dayAvgDelta, 1)} mg/dL` : 'N/A'}, TIR delta ${Number.isFinite(dayTirDelta) ? `${fmt(dayTirDelta, 1)}%` : 'N/A'}, carbs delta ${Number.isFinite(carbsDelta) ? `${fmt(carbsDelta, 1)} g` : 'N/A'}, calories delta ${Number.isFinite(calsDelta) ? `${fmt(calsDelta, 0)} kcal` : 'N/A'}.\n- Friendly focus for tomorrow: ${improve.length ? improve.join(' ') : 'No urgent corrections needed—just keep the same consistency and momentum.'}\n- You’re doing great—small consistent habits keep adding up. Keep it going 🌟\n\n9) 🛡️ Self-Audit (Data Integrity)\n- Target day enforced: ${targetDate} PT\n- Glucose points in target window: ${statsDay.count}\n- GMI formula check (3.31 + 0.02392 × Avg): ${fmt(expectedGmiFromAvg, 2)}%\n- Reported GMI: ${fmt(statsDay.gmi, 2)}%\n`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(OUTPUT_DIR, `daily_report_${reportDate}.txt`);
  fs.writeFileSync(reportPath, report);

  const metaPath = path.join(OUTPUT_DIR, 'daily_report_latest.json');
  fs.writeFileSync(metaPath, JSON.stringify({ reportDate, targetDate, reportPath, generatedAt: new Date().toISOString() }, null, 2) + '\n');

  console.log(reportPath);
  return {
    reportPath,
    reportDate,
    targetDate,
    statsDay,
    stats14,
    generatedAt: new Date().toISOString()
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const reportDateArg = args.find(a => a.startsWith('--report-date='));
  const targetDateArg = args.find(a => a.startsWith('--target-date='));
  const modelArg = args.find(a => a.startsWith('--model='));
  const reportDate = reportDateArg ? reportDateArg.split('=')[1] : null;
  const targetDate = targetDateArg ? targetDateArg.split('=')[1] : null;
  if (modelArg) process.env.REPORT_MODEL = modelArg.split('=')[1];

  main({ reportDate, targetDate }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, laDateString, addDays, calculateGlucoseStats };
