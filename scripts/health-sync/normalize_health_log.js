#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKSPACE = process.cwd();
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const OUTPUT_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const PENDING_PHOTO_PATH = path.join(WORKSPACE, 'data', 'pending_photo_entries.json');

const { loadSyncState, saveSyncState, upsertEntry } = require('./sync_state');

const PHOTO_LINK_REGEX = /\[[^\]]*\]\(([^)]+)\)/g;
const PRED_REGEX = /\(Pred:\s*([^@)]+?)\s*@\s*([^)]+)\)/i;
const BG_REGEX = /\(BG:\s*([^)]*?)\)/i;
const PROTEIN_REGEX = /\(Protein:\s*([^)]+?)\)/i;

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function cleanWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
  return cleanWhitespace(title)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'");
}

function extractPhotos(entryText) {
  return [...entryText.matchAll(PHOTO_LINK_REGEX)]
    .map(m => cleanWhitespace(m[1]))
    .filter(url => /^https?:\/\//i.test(url));
}

function stripPhotos(entryText) {
  return cleanWhitespace(entryText.replace(PHOTO_LINK_REGEX, ''));
}

function extractPredictions(entryText) {
  const pred = entryText.match(PRED_REGEX);
  if (!pred) {
    return {
      raw: null,
      peakBgText: null,
      peakTimeText: null
    };
  }

  return {
    raw: pred[0],
    peakBgText: cleanWhitespace(pred[1]),
    peakTimeText: cleanWhitespace(pred[2])
  };
}

function extractBgText(entryText) {
  const bg = entryText.match(BG_REGEX);
  return bg ? cleanWhitespace(bg[1]) : null;
}

function extractProtein(entryText) {
  const protein = entryText.match(PROTEIN_REGEX);
  return protein ? parseNumber(protein[1]) : null;
}

function estimateProteinFromTitle(title, carbsEst = null, caloriesEst = null) {
  const text = normalizeTitle(title || '');
  if (!text) return 1;

  let protein = 0;

  // Eggs
  const eggs = text.match(/(\d+(?:\.\d+)?)\s*(?:soft-boiled|boiled|fried|poached|scrambled)?\s*eggs?\b/);
  if (eggs) {
    protein += Number(eggs[1]) * 6;
  } else if (/\beggs?\b/.test(text)) {
    protein += 6;
  }

  // Dairy
  if (/\bmilk\b/.test(text)) {
    const oz = text.match(/(\d+(?:\.\d+)?)\s*oz\s*milk|milk[^\d]*(\d+(?:\.\d+)?)\s*oz/);
    if (oz) {
      const v = Number(oz[1] || oz[2]);
      if (Number.isFinite(v)) protein += (v / 8) * 8;
    } else if (/\bglass of milk\b|\bcup of milk\b|\b1 cup\b/.test(text)) {
      protein += 8;
    } else {
      protein += 6;
    }
  }
  if (/\byogurt\b/.test(text)) protein += /\b1\s*cup\b/.test(text) ? 8 : 6;
  if (/\bbrie\b|\bcream cheese\b|\bcheese\b/.test(text)) protein += 5;

  // Nuts / seeds / peanut butter
  if (/\bpecans?\b|\bwalnuts?\b|\bnuts?\b|\bhemp seeds?\b/.test(text)) protein += 5;
  if (/\bpeanut butter\b/.test(text)) protein += 4;

  // Fish / meat / legumes
  if (/\bprosciutto\b/.test(text)) {
    const slices = text.match(/(\d+(?:\.\d+)?)\s*slices?\s+(?:of\s+)?prosciutto/);
    protein += slices ? Number(slices[1]) * 3 : 6;
  }
  if (/\bpastrami\b|\bcorned beef\b|\bbeef\b/.test(text)) protein += 10;
  if (/\bpork\b|\bpork belly\b|\bham\b/.test(text)) protein += 10;
  if (/\bchicken\b|\bturkey\b/.test(text)) protein += 12;
  if (/\bsalmon\b|\bsmoked salmon\b|\bsardines?\b|\btuna\b|\boctopus\b|\bpulpo\b|\bshrimp\b|\bfish\b/.test(text)) protein += 14;
  if (/\bmeatballs?\b|\bshredded meat\b|\bbraised meat\b|\bpulled meat\b/.test(text)) protein += 14;
  if (/\bsausage\b/.test(text)) protein += 8;
  if (/\blentil\b/.test(text)) protein += 8;
  if (/\bbeans?\b/.test(text)) protein += 7;
  if (/\btofu\b/.test(text)) protein += 8;
  if (/\bprotein ball\b|\benergy ball\b|\btruffle\b/.test(text)) protein += 3;

  // Dish-level heuristics
  if (/\bburrito\b/.test(text)) protein += 6;
  if (/\bdumplings?\b|\bbao buns?\b/.test(text)) protein += 8;
  if (/\bramen\b/.test(text)) protein += 8;

  // If nothing matched, infer a minimal value from content style
  if (protein === 0) {
    if (/\bapple\b|\bkiwi\b|\borange\b|\bgrapes?\b|\bstrawberr(?:y|ies)\b|\bdragon fruit\b|\bguava\b|\bcake\b|\bcookie\b|\bchocolate\b/.test(text)) {
      protein = 1;
    } else if (Number.isFinite(caloriesEst) && caloriesEst > 0) {
      protein = Math.max(1, Math.min(12, Math.round((caloriesEst * 0.12) / 4)));
    } else if (Number.isFinite(carbsEst) && carbsEst > 0) {
      protein = Math.max(1, Math.min(8, Math.round(carbsEst * 0.12)));
    } else {
      protein = 1;
    }
  }

  return Math.round(protein * 10) / 10;
}

function stripMetadata(entryText) {
  let text = stripPhotos(entryText);
  text = cleanWhitespace(text.replace(BG_REGEX, '').replace(PRED_REGEX, '').replace(PROTEIN_REGEX, '').replace(/\(Carbs:[^)]*\)/g, '').replace(/\(Carbs:[^)]*\|[^)]*\)/g, ''));
  return text;
}

function parseNumber(value) {
  if (!value || value === 'null') return null;
  // Extract number from strings like '17g', '~21g', '340 kcal'
  const numMatch = String(value).match(/[\d.]+/);
  if (!numMatch) return null;
  const parsed = Number(numMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferOffset(dateValue) {
  const d = new Date(`${dateValue}T12:00:00`);
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(mins) / 60)).padStart(2, '0');
  const m = String(Math.abs(mins) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function toIso(date, timeCell) {
  const trimmed = cleanWhitespace(timeCell);
  const parts = trimmed.split(' ');
  const timeOnly = parts[0];
  const offset = parts[1] || inferOffset(date);
  return `${date}T${timeOnly}:00${offset}`;
}

function buildEntryKey(entry) {
  const basis = `${entry.timestamp}|${entry.user}|${entry.title}`;
  return sha256(basis);
}

function buildContentHash(entry) {
  const clone = {
    timestamp: entry.timestamp,
    user: entry.user,
    category: entry.category,
    mealType: entry.mealType,
    title: entry.title,
    notes: entry.notes,
    photoUrls: entry.photoUrls,
    carbsEst: entry.carbsEst,
    caloriesEst: entry.caloriesEst,
    proteinEst: entry.proteinEst,
    predicted: entry.predicted,
    actual: entry.actual
  };
  return sha256(JSON.stringify(clone));
}

function loadPendingPhotoEntries() {
  if (!fs.existsSync(PENDING_PHOTO_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_PHOTO_PATH, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && /^https?:\/\//i.test(String(item.photoUrl || '')));
  } catch {
    return [];
  }
}

function resolvePendingPhotoUrl(entryText, timestamp, mealType, pendingPhotos) {
  if (!/\[[^\]]*\]\(\s*pending\s*\)/i.test(entryText)) return null;
  if (!pendingPhotos || pendingPhotos.length === 0) return null;

  const target = new Date(timestamp).getTime();
  if (!Number.isFinite(target)) return null;

  const meal = cleanWhitespace(mealType || '').toLowerCase();
  const candidates = pendingPhotos
    .map(item => {
      const t = new Date(item.timestamp).getTime();
      return {
        ...item,
        diffMs: Number.isFinite(t) ? Math.abs(t - target) : Number.POSITIVE_INFINITY,
        mealMatch: cleanWhitespace(item.mealType || '').toLowerCase() === meal
      };
    })
    .filter(item => item.diffMs <= 5 * 60 * 1000);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.mealMatch !== b.mealMatch) return a.mealMatch ? -1 : 1;
    return a.diffMs - b.diffMs;
  });

  return candidates[0].photoUrl || null;
}

function parseRow(line, lineNumber, pendingPhotos = []) {
  const parts = line.split('|').map(x => x.trim());
  if (parts.length < 9) return null;
  if (!/^202\d-\d\d-\d\d$/.test(parts[1])) return null;

  const date = parts[1];
  const time = parts[2];
  const user = parts[3];
  const category = parts[4];
  const mealType = parts[5];
  // Carbs and cals are always at fixed positions from the end
  // parts structure: | date | time | user | cat | type | entry... | carbs | cals |
  const carbsIdx = parts.length - 3;  // 3rd from end
  const calsIdx = parts.length - 2;   // 2nd from end
  // Entry text is everything from index 6 up to carbs column
  const entryParts = parts.slice(6, carbsIdx);
  const entryText = entryParts.join(' | ');
  let carbs = parseNumber(parts[carbsIdx]);
  let cals = parseNumber(parts[calsIdx]);

  // Safety net: if carbs/cals columns are null for Food entries, extract from description text
  if (category === 'Food' && (carbs == null || cals == null)) {
    const carbMatch = entryText.match(/Carbs:\s*~?(\d+)/i);
    const calMatch = entryText.match(/Cals?:\s*~?(\d+)/i);
    if (carbs == null && carbMatch) carbs = Number(carbMatch[1]);
    if (cals == null && calMatch) cals = Number(calMatch[1]);
  }

  const timestamp = toIso(date, time);
  const photos = extractPhotos(entryText);
  const pendingResolvedPhoto = photos.length === 0
    ? resolvePendingPhotoUrl(entryText, timestamp, mealType, pendingPhotos)
    : null;
  const resolvedPhotos = pendingResolvedPhoto ? [pendingResolvedPhoto] : photos;
  const predictions = extractPredictions(entryText);
  const bgText = extractBgText(entryText);
  const title = stripMetadata(entryText);
  const explicitProtein = extractProtein(entryText);
  const inferredProtein = (category === 'Food' && explicitProtein == null)
    ? estimateProteinFromTitle(title, carbs, cals)
    : null;
  const protein = explicitProtein ?? inferredProtein;

  const normalized = {
    source: {
      file: 'health_log.md',
      line: lineNumber,
      rawRow: line
    },
    timestamp,
    date,
    time: cleanWhitespace(time),
    user,
    category,
    mealType,
    title,
    notes: cleanWhitespace([
      bgText ? `BG: ${bgText}` : null,
      protein != null
        ? `Protein: ${protein}g${explicitProtein == null && category === 'Food' ? ' (inferred)' : ''}`
        : null,
      predictions.raw ? predictions.raw.replace(/^\(|\)$/g, '') : null
    ].filter(Boolean).join('; ')) || null,
    photoUrls: resolvedPhotos,
    carbsEst: carbs,
    caloriesEst: cals,
    proteinEst: protein,
    predicted: {
      peakBgText: predictions.peakBgText,
      peakTimeText: predictions.peakTimeText
    },
    actual: {
      preMealBg: null,
      peakBg: null,
      peakTime: null,
      bgDelta: null,
      timeToPeakMin: null,
      peakBgDelta: null,
      peakTimeDeltaMin: null,
      twoHourPeakBg: null
    },
    sync: {
      nightscout: 'pending',
      notion: 'pending',
      gallery: 'pending',
      outcomesBackfilled: false
    }
  };

  normalized.entryKey = buildEntryKey(normalized);
  normalized.contentHash = buildContentHash(normalized);
  return normalized;
}

function main() {
  const content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n');
  const entries = [];
  const pendingPhotos = loadPendingPhotoEntries();

  for (let i = 0; i < lines.length; i++) {
    const row = parseRow(lines[i], i + 1, pendingPhotos);
    if (row) entries.push(row);
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: LOG_PATH,
    entryCount: entries.length,
    entries
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Normalized ${entries.length} entries.`);
  console.log(`Wrote ${OUTPUT_PATH}`);

  const state = loadSyncState(SYNC_STATE_PATH);
  for (const entry of entries) {
    upsertEntry(state, entry.entryKey, {
      timestamp: entry.timestamp,
      content_hash: entry.contentHash,
      user: entry.user,
      category: entry.category,
      meal_type: entry.mealType,
      title: entry.title,
      photo_urls: entry.photoUrls,
      outcomes_backfilled: entry.actual?.peakBg != null
    });
  }
  saveSyncState(SYNC_STATE_PATH, state);
  console.log(`Updated ${SYNC_STATE_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseRow,
  buildEntryKey,
  buildContentHash,
  extractPhotos,
  stripPhotos,
  main
};
