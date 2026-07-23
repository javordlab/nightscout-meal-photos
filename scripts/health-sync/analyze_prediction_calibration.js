#!/usr/bin/env node
// analyze_prediction_calibration.js — Compare predicted vs actual BG peaks.
//
// Self-contained: dumps Food + Exercise rows from MySQL health_ssot itself,
// groups cumulative sub-entries into meals, excludes stacked-meal windows,
// and prints deviation stats by segment (meal type, hour, carbs, preBG, etc.)
// plus the implied carb factors / intercept residuals / time-to-peak medians
// that drive model recalibration.
//
// Usage:
//   node scripts/health-sync/analyze_prediction_calibration.js                 # full history
//   node scripts/health-sync/analyze_prediction_calibration.js --since=2026-06-12
//
// Born from the 2026-06-12 Model v3→v4 calibration (docs/model_v4_calibration_2026-06-12.md).
// Error convention: err = actual peak − predicted midpoint. Positive = model UNDER-predicted.
'use strict';

const { spawnSync } = require('child_process');

const MYSQL_BIN = '/opt/homebrew/opt/mysql@8.4/bin/mysql';
const DB_NAME = 'health_ssot';

// Current model parameters (Model v5, shipped 2026-07-23 — see
// docs/model_v5_calibration_2026-07-23.md). Used only for the "implied vs
// current" diagnostics — predictions themselves come from the DB.
const MODEL = {
  factors: [ // [maxCarbs, factor]
    [15, 2.0], [30, 1.2], [50, 0.9], [Infinity, 0.8],
  ],
  intercepts: { Breakfast: 20, Lunch: 0, Dinner: 0, Snack: 0, Dessert: -10 },
  ttp: { Breakfast: 75, Lunch: 70, Dinner: 65, Snack: 55, Dessert: 105 },
  proteinCoef: 0.3,      // v5 Layer 2b: + coef × max(0, protein_g − threshold)
  proteinThreshold: 20,
  dampSlope: 0.35,
  dampCenter: 115,
};

const sinceArg = process.argv.find(a => a.startsWith('--since='));
const SINCE = sinceArg ? sinceArg.split('=')[1] : null;

function dump() {
  const sql = `SELECT entry_key, ts_iso, event_date, event_time, meal_type, carbs_est, protein_est,
    predicted_peak_bg_low, predicted_peak_bg_high, pre_meal_bg,
    COALESCE(two_hour_peak_bg, peak_bg) AS actual_peak, time_to_peak_min, category
  FROM health_log_entries
  WHERE deleted_at IS NULL AND user_name LIKE 'Maria%'
    AND category IN ('Food','Exercise','Activity')
  ORDER BY ts_iso`;
  const r = spawnSync(MYSQL_BIN, ['-u', 'root', '--default-character-set=utf8mb4', '-B', DB_NAME, '-e', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mysql failed: ${r.stderr || r.stdout}`);
  const lines = r.stdout.trim().split('\n');
  const header = lines[0].split('\t');
  return lines.slice(1).map(l => {
    const c = l.split('\t');
    const o = {};
    header.forEach((h, i) => o[h] = c[i] === 'NULL' ? null : c[i]);
    ['carbs_est', 'protein_est', 'predicted_peak_bg_low', 'predicted_peak_bg_high',
     'pre_meal_bg', 'actual_peak', 'time_to_peak_min']
      .forEach(k => { if (o[k] != null) o[k] = Number(o[k]); });
    o.ms = new Date(o.ts_iso).getTime();
    return o;
  });
}

const rows = dump();
const food = rows.filter(r => r.category === 'Food');
const exercise = rows.filter(r => r.category === 'Exercise' || r.category === 'Activity');

function localHour(r) {
  const m = String(r.event_time).match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

// Group cumulative sub-entries (gap <= 75 min) into one meal; the LAST
// sub-entry with a prediction carries the cumulative-carb Pred.
const groups = [];
let cur = null;
for (const f of food) {
  if (cur && f.ms - cur.rows[cur.rows.length - 1].ms <= 75 * 60 * 1000) cur.rows.push(f);
  else { cur = { rows: [f] }; groups.push(cur); }
}
for (const g of groups) {
  const withPred = g.rows.filter(r => r.predicted_peak_bg_low != null);
  g.rep = withPred.length ? withPred[withPred.length - 1] : null;
  g.totalCarbs = g.rows.reduce((s, r) => s + (r.carbs_est || 0), 0);
  g.totalProtein = g.rows.reduce((s, r) => s + (r.protein_est || 0), 0);
}
function stacked(g) {
  const end = g.rep.ms + 3 * 3600 * 1000;
  return food.some(f => !g.rows.includes(f) && f.ms > g.rep.ms && f.ms <= end);
}
function walkedAfter(g) {
  return exercise.some(e => e.ms >= g.rep.ms - 15 * 60 * 1000 && e.ms <= g.rep.ms + 2.5 * 3600 * 1000);
}

let usable = groups.filter(g => g.rep && g.rep.actual_peak != null && g.rep.pre_meal_bg != null);
if (SINCE) usable = usable.filter(g => String(g.rep.event_date) >= SINCE);
for (const g of usable) {
  const r = g.rep;
  r.predMid = (r.predicted_peak_bg_low + r.predicted_peak_bg_high) / 2;
  g.err = r.actual_peak - r.predMid;
  g.actualRise = r.actual_peak - r.pre_meal_bg;
  g.pctErr = 100 * g.err / r.predMid;
  g.stacked = stacked(g);
  g.walked = walkedAfter(g);
  g.hour = localHour(r);
}

function stats(arr) {
  if (!arr.length) return null;
  const errs = arr.map(g => g.err);
  const n = errs.length;
  const mean = errs.reduce((a, b) => a + b, 0) / n;
  const sorted = [...errs].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / n;
  const mape = arr.reduce((a, g) => a + Math.abs(g.pctErr), 0) / n;
  const pct = f => +(errs.filter(f).length / n * 100).toFixed(0);
  return {
    n, mean: +mean.toFixed(1), median, mae: +mae.toFixed(1), mape: +mape.toFixed(1),
    within10: pct(e => Math.abs(e) <= 10), within20: pct(e => Math.abs(e) <= 20),
    within30: pct(e => Math.abs(e) <= 30),
    underpred_pct: pct(e => e > 10), overpred_pct: pct(e => e < -10),
  };
}
function show(label, arr) {
  const s = stats(arr);
  if (!s) { console.log(`${label.padEnd(38)} no data`); return; }
  console.log(`${label.padEnd(38)} n=${String(s.n).padStart(3)}  meanErr=${String(s.mean).padStart(6)}  med=${String(s.median).padStart(4)}  MAE=${String(s.mae).padStart(5)}  MAPE=${String(s.mape).padStart(5)}%  ±10:${String(s.within10).padStart(3)}%  ±20:${String(s.within20).padStart(3)}%  ±30:${String(s.within30).padStart(3)}%  underPred:${String(s.underpred_pct).padStart(3)}%  overPred:${String(s.overpred_pct).padStart(3)}%`);
}

console.log(`Prediction calibration — ${SINCE ? `since ${SINCE}` : 'full history'}`);
console.log(`Meals with pred+actual: ${usable.length} (of ${groups.length} groups, ${food.length} food rows)`);
console.log('err = actual peak − predicted midpoint; + = UNDER-predicted, − = OVER-predicted\n');

show('ALL MEALS', usable);
const clean = usable.filter(g => !g.stacked);
show('CLEAN (no meal stacked within 3h)', clean);
show('Stacked-meal windows (unreliable)', usable.filter(g => g.stacked));
console.log('\n--- By meal type (clean) ---');
for (const mt of ['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Dessert']) show(mt, clean.filter(g => g.rep.meal_type === mt));
console.log('\n--- By hour (clean) ---');
for (const [lo, hi] of [[5, 11], [11, 14], [14, 16], [16, 18], [18, 21], [21, 29]])
  show(`${lo}:00-${hi >= 24 ? hi - 24 : hi}:00`, clean.filter(g => (g.hour < 5 ? g.hour + 24 : g.hour) >= lo && (g.hour < 5 ? g.hour + 24 : g.hour) < hi));
console.log('\n--- By total carbs (clean) ---');
for (const [lo, hi] of [[0, 15], [16, 30], [31, 50], [51, 9999]])
  show(`${lo}-${hi === 9999 ? '+' : hi}g`, clean.filter(g => g.totalCarbs >= lo && g.totalCarbs <= hi));
console.log('\n--- By pre-meal BG (clean) ---');
for (const [lo, hi] of [[0, 90], [90, 110], [110, 130], [130, 150], [150, 999]])
  show(`preBG ${lo}-${hi}`, clean.filter(g => g.rep.pre_meal_bg >= lo && g.rep.pre_meal_bg < hi));
console.log('\n--- Walk within 2.5h after (clean) ---');
show('Walked after', clean.filter(g => g.walked));
show('No walk', clean.filter(g => !g.walked));

console.log('\n--- Time-to-peak: actual median vs model (clean) ---');
for (const mt of Object.keys(MODEL.ttp)) {
  const arr = clean.filter(g => g.rep.meal_type === mt && g.rep.time_to_peak_min != null && g.rep.time_to_peak_min >= 0);
  if (!arr.length) { console.log(`${mt.padEnd(10)} no data`); continue; }
  const t = arr.map(g => g.rep.time_to_peak_min).sort((a, b) => a - b);
  const med = t[Math.floor(t.length / 2)];
  console.log(`${mt.padEnd(10)} n=${String(arr.length).padStart(3)}  model=${MODEL.ttp[mt]}min  actual median=${med}min  delta=${med - MODEL.ttp[mt]}min`);
}

console.log('\n--- Implied carb factor per bracket (clean; median of (rise − intercept − protein − damp)/carbs) ---');
for (const [i, [maxC, fac]] of MODEL.factors.entries()) {
  const minC = i === 0 ? 5 : MODEL.factors[i - 1][0] + 1;
  const arr = clean.filter(g => g.totalCarbs >= minC && g.totalCarbs <= maxC && MODEL.intercepts[g.rep.meal_type] != null);
  const f = arr.map(g => {
    const damp = -MODEL.dampSlope * (g.rep.pre_meal_bg - MODEL.dampCenter);
    const prot = MODEL.proteinCoef * Math.max(0, (g.totalProtein || 0) - MODEL.proteinThreshold);
    return (g.actualRise - MODEL.intercepts[g.rep.meal_type] - prot - damp) / g.totalCarbs;
  }).sort((a, b) => a - b);
  if (!f.length) { console.log(`${minC}-${maxC === Infinity ? '+' : maxC}g: no data`); continue; }
  console.log(`${String(minC).padStart(3)}-${String(maxC === Infinity ? '+' : maxC).padEnd(4)}g current=${fac}  implied median=${f[Math.floor(f.length / 2)].toFixed(2)}  n=${f.length}`);
}

console.log('\n--- Worst misses (clean, |err| >= 40) ---');
clean.filter(g => Math.abs(g.err) >= 40).sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 12).forEach(g => {
  console.log(`${g.rep.event_date} ${g.rep.event_time} ${String(g.rep.meal_type).padEnd(9)} pred=${g.rep.predMid} actual=${g.rep.actual_peak} err=${g.err > 0 ? '+' : ''}${g.err.toFixed(0)} carbs=${g.totalCarbs} preBG=${g.rep.pre_meal_bg} walked=${g.walked}`);
});
