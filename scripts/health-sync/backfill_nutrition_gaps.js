#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const PENDING_PATH = path.join(WORKSPACE, 'data', 'pending_photo_entries.json');
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_API_SECRET = process.env.NIGHTSCOUT_API_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  if (value == null) return null;
  const m = String(value).match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseNutritionFromText(text) {
  const t = cleanText(text);
  const extract = (regex) => {
    const m = t.match(regex);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };

  return {
    carbs: extract(/carbs?\s*[:=~]?\s*(\d+(?:\.\d+)?)/i) || extract(/(\d+(?:\.\d+)?)\s*g\s*carbs?/i),
    cals: extract(/(?:cals?|calories|kcal)\s*[:=~]?\s*(\d+(?:\.\d+)?)/i) || extract(/(\d+(?:\.\d+)?)\s*kcal/i),
    protein: extract(/protein\s*[:=~]?\s*(\d+(?:\.\d+)?)/i) || extract(/(\d+(?:\.\d+)?)\s*g\s*protein/i)
  };
}

function estimateNutrition(text, mealType) {
  const t = cleanText(text).toLowerCase();
  const defaults = {
    Breakfast: { carbs: 30, cals: 320, protein: 14 },
    Lunch: { carbs: 42, cals: 500, protein: 20 },
    Dinner: { carbs: 48, cals: 580, protein: 24 },
    Snack: { carbs: 15, cals: 180, protein: 6 },
    Dessert: { carbs: 24, cals: 240, protein: 3 }
  };
  const base = { ...(defaults[mealType] || defaults.Snack) };

  if (/apple|orange|grapes?|strawberr|dragon fruit|kiwi|guava/.test(t)) {
    base.carbs += 8; base.cals += 35;
  }
  if (/bread|toast|tortilla|bun|bao|rice|noodle|pasta|potato/.test(t)) {
    base.carbs += 12; base.cals += 90;
  }
  if (/cake|cookie|chocolate|dessert|sweet/.test(t)) {
    base.carbs += 16; base.cals += 120; base.protein = Math.max(2, base.protein - 2);
  }
  if (/egg|eggs|beef|pork|chicken|fish|salmon|tuna|prosciutto|pastrami|meat|tofu|lentil|beans/.test(t)) {
    base.protein += 8; base.cals += 60;
  }
  if (/cheese|milk|yogurt|nuts|peanut butter|avocado/.test(t)) {
    base.protein += 4; base.cals += 80;
  }

  return {
    carbs: Math.max(4, Math.min(95, Math.round(base.carbs))),
    cals: Math.max(60, Math.min(1200, Math.round(base.cals))),
    protein: Math.max(1, Math.min(65, Math.round(base.protein)))
  };
}

function estimatePred(carbs, tsCell) {
  const c = Number.isFinite(carbs) ? carbs : 25;
  const peak = Math.min(300, Math.max(120, Math.round(110 + c * 3.2)));
  const low = Math.max(95, peak - 10);
  const high = Math.min(320, peak + 10);

  const timeOnly = cleanText(tsCell || '').split(' ')[0] || '12:00';
  const [hRaw, mRaw] = timeOnly.split(':').map(v => Number(v));
  const h = Number.isFinite(hRaw) ? hRaw : 12;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setMinutes(d.getMinutes() + 95);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;

  return `Pred: ${low}-${high} mg/dL @ ${h12}:${mm} ${ampm}`;
}

function parseRow(line) {
  const parts = line.split('|').map(x => x.trim());
  if (parts.length < 9) return null;
  if (!/^202\d-\d\d-\d\d$/.test(parts[1])) return null;

  const carbsIdx = parts.length - 3;
  const calsIdx = parts.length - 2;
  return {
    raw: line,
    date: parts[1],
    time: parts[2],
    user: parts[3],
    category: parts[4],
    mealType: parts[5],
    entryText: parts.slice(6, carbsIdx).join(' | '),
    carbsText: parts[carbsIdx],
    calsText: parts[calsIdx],
    parts
  };
}

function rebuild(row, newEntryText, carbs, cals) {
  return `| ${row.date} | ${row.time} | ${row.user} | ${row.category} | ${row.mealType} | ${cleanText(newEntryText)} | ${carbs} | ${cals} |`;
}

function fetchNearestBgLabel(isoTs) {
  const ts = new Date(isoTs).getTime();
  if (!Number.isFinite(ts)) return null;
  const fromMs = ts - 20 * 60 * 1000;
  const toMs = ts + 20 * 60 * 1000;

  try {
    const cmd = [
      'curl -sG',
      `"${NIGHTSCOUT_URL}/api/v1/entries.json"`,
      `-H "API-SECRET: ${NIGHTSCOUT_API_SECRET}"`,
      `--data-urlencode "find[date][$gte]=${fromMs}"`,
      `--data-urlencode "find[date][$lte]=${toMs}"`,
      '--data-urlencode "count=200"'
    ].join(' ');

    const result = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    const data = JSON.parse(result);
    if (!Array.isArray(data) || data.length === 0) return null;
    data.sort((a, b) => Math.abs((a.date || 0) - ts) - Math.abs((b.date || 0) - ts));
    const best = data[0];
    if (!Number.isFinite(best?.sgv)) return null;
    return `${best.sgv} mg/dL ${best.direction || 'Flat'}`;
  } catch {
    return null;
  }
}

function inferOffset(dateValue) {
  const d = new Date(`${dateValue}T12:00:00`);
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(mins) / 60)).padStart(2, '0');
  const m = String(Math.abs(mins) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function toIsoFromRow(row) {
  const t = cleanText(row.time).split(' ');
  const hhmm = t[0] || '00:00';
  const offset = t[1] || inferOffset(row.date);
  return `${row.date}T${hhmm}:00${offset}`;
}

function parsePendingItems() {
  if (!fs.existsSync(PENDING_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean);
  } catch {
    return [];
  }
}

function buildRowFromPending(item) {
  const ts = new Date(item.timestamp || Date.now());
  const date = ts.toISOString().slice(0, 10);
  const hh = String(ts.getHours()).padStart(2, '0');
  const mm = String(ts.getMinutes()).padStart(2, '0');
  const _om = -ts.getTimezoneOffset(); const _s = _om >= 0 ? '+' : '-'; const _h = String(Math.floor(Math.abs(_om) / 60)).padStart(2, '0'); const _m = String(Math.abs(_om) % 60).padStart(2, '0');
  const offset = `${_s}${_h}:${_m}`;
  const mealType = cleanText(item.mealType || 'Snack');
  const description = `${mealType}: Meal photo (auto-estimated nutrition)`;
  const est = estimateNutrition(description, mealType);
  const pred = estimatePred(est.carbs, `${hh}:${mm} ${offset}`);
  const photoUrl = /^https?:\/\//i.test(String(item.photoUrl || '')) ? String(item.photoUrl) : 'pending';
  const macros = `(Protein: ${est.protein}g | Carbs: ~${est.carbs}g | Cals: ~${est.cals})`;

  const bgLabel = fetchNearestBgLabel(`${date}T${hh}:${mm}:00${offset}`) || 'Unknown';
  const entryText = `${mealType}: Meal photo (auto-estimated nutrition) (BG: ${bgLabel}) (${pred}) ${macros} [📷](${photoUrl})`;
  return `| ${date} | ${hh}:${mm} ${offset} | Maria Dennis | Food | ${mealType} | ${entryText} | ${est.carbs} | ${est.cals} |`;
}

function main() {
  if (!fs.existsSync(LOG_PATH)) throw new Error(`health_log_missing:${LOG_PATH}`);

  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
  let updated = 0;
  let inserted = 0;

  for (let i = 0; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (!row) continue;
    if (cleanText(row.category).toLowerCase() !== 'food') continue;

    const parsedInline = parseNutritionFromText(row.entryText);
    const existingCarbs = toNumber(row.carbsText);
    const existingCals = toNumber(row.calsText);
    const est = estimateNutrition(row.entryText, row.mealType);

    const nextCarbs = existingCarbs ?? parsedInline.carbs ?? est.carbs;
    const nextCals = existingCals ?? parsedInline.cals ?? est.cals;
    const nextProtein = parsedInline.protein ?? est.protein;

    let nextEntryText = row.entryText;

    if (/\(BG:\s*Unknown\)/i.test(nextEntryText)) {
      const bgLabel = fetchNearestBgLabel(toIsoFromRow(row));
      if (bgLabel) {
        nextEntryText = nextEntryText.replace(/\(BG:\s*Unknown\)/ig, `(BG: ${bgLabel})`);
      }
    }

    if (/\(Pred:\s*TBD\)/i.test(nextEntryText)) {
      nextEntryText = nextEntryText.replace(/\(Pred:\s*TBD\)/ig, `(${estimatePred(nextCarbs, row.time)})`);
    } else if (!/\(Pred:\s*[^)]+\)/i.test(nextEntryText)) {
      nextEntryText = `${nextEntryText} (${estimatePred(nextCarbs, row.time)})`;
    }

    const macroBundle = `(Protein: ${nextProtein}g | Carbs: ~${nextCarbs}g | Cals: ~${nextCals})`;
    const hasMacroBundle = /\(Protein:\s*[^)]*\|\s*Carbs:\s*[^)]*\|\s*Cals:\s*[^)]*\)/i.test(nextEntryText);
    if (!hasMacroBundle) {
      // Remove legacy single-macro fragments before inserting canonical bundle.
      nextEntryText = nextEntryText
        .replace(/\(Protein:\s*[^)]*\)/ig, '')
        .replace(/\(Carbs:\s*[^)]*\)/ig, '')
        .replace(/\(Cals?:\s*[^)]*\)/ig, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (/\[[^\]]*\]\(https?:\/\//i.test(nextEntryText)) {
        nextEntryText = nextEntryText.replace(/\s*(\[[^\]]*\]\(https?:\/\/[^)]+\))/i, ` ${macroBundle} $1`);
      } else {
        nextEntryText = `${nextEntryText} ${macroBundle}`;
      }
    }

    const rebuilt = rebuild(row, nextEntryText, nextCarbs, nextCals);
    if (rebuilt !== lines[i]) {
      lines[i] = rebuilt;
      updated++;
    }
  }

  // Materialize pending nutrition/photo rows if no matching log row exists yet.
  const existingRows = lines
    .map(parseRow)
    .filter(Boolean)
    .filter(r => cleanText(r.category).toLowerCase() === 'food')
    .map(r => ({
      ts: new Date(toIsoFromRow(r)).getTime(),
      mealType: cleanText(r.mealType).toLowerCase(),
      text: cleanText(r.entryText).toLowerCase()
    }))
    .filter(r => Number.isFinite(r.ts));

  const pending = parsePendingItems();
  const pendingRemaining = [];
  for (const item of pending) {
    const ts = new Date(item.timestamp || 0).getTime();
    if (!Number.isFinite(ts)) {
      pendingRemaining.push(item);
      continue;
    }

    const meal = cleanText(item.mealType || '').toLowerCase();
    const url = cleanText(item.photoUrl || '').toLowerCase();

    const already = existingRows.some(r => {
      const close = Math.abs(r.ts - ts) <= 5 * 60 * 1000;
      const mealMatch = !meal || r.mealType === meal;
      const urlMatch = url && r.text.includes(url);
      return close && (mealMatch || urlMatch);
    });

    if (already) {
      continue; // resolved; drop from pending queue
    }

    const row = buildRowFromPending(item);
    lines.splice(2, 0, row);
    inserted++;
  }

  // Recompute existing rows after inserts and keep only truly unresolved pending items
  const refreshedRows = lines
    .map(parseRow)
    .filter(Boolean)
    .filter(r => cleanText(r.category).toLowerCase() === 'food')
    .map(r => ({
      ts: new Date(toIsoFromRow(r)).getTime(),
      mealType: cleanText(r.mealType).toLowerCase(),
      text: cleanText(r.entryText).toLowerCase()
    }))
    .filter(r => Number.isFinite(r.ts));

  for (const item of pending) {
    const ts = new Date(item.timestamp || 0).getTime();
    if (!Number.isFinite(ts)) {
      if (!pendingRemaining.includes(item)) pendingRemaining.push(item);
      continue;
    }
    const meal = cleanText(item.mealType || '').toLowerCase();
    const url = cleanText(item.photoUrl || '').toLowerCase();
    const resolved = refreshedRows.some(r => {
      const close = Math.abs(r.ts - ts) <= 5 * 60 * 1000;
      const mealMatch = !meal || r.mealType === meal;
      const urlMatch = url && r.text.includes(url);
      return close && (mealMatch || urlMatch);
    });
    if (!resolved) pendingRemaining.push(item);
  }

  if (updated > 0 || inserted > 0) {
    fs.writeFileSync(LOG_PATH, lines.join('\n'));
  }

  if (fs.existsSync(PENDING_PATH)) {
    fs.writeFileSync(PENDING_PATH, JSON.stringify(pendingRemaining, null, 2) + '\n');
  }

  const out = { status: 'ok', updated, inserted, pendingRemaining: pendingRemaining.length };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { main };
