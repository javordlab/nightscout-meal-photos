#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKSPACE = process.cwd();
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const OUTPUT_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');

const { loadSyncState, saveSyncState, upsertEntry } = require('./sync_state');

const PHOTO_REGEX = /\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
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
  return [...entryText.matchAll(PHOTO_REGEX)].map(m => m[1]);
}

function stripPhotos(entryText) {
  return cleanWhitespace(entryText.replace(PHOTO_REGEX, ''));
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
  const d = new Date(`${dateValue}T00:00:00Z`);
  const dstStart = new Date('2026-03-08T00:00:00Z');
  const dstEnd = new Date('2026-11-01T00:00:00Z');
  return (d >= dstStart && d < dstEnd) ? '-07:00' : '-08:00';
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
    predicted: entry.predicted,
    actual: entry.actual
  };
  return sha256(JSON.stringify(clone));
}

function parseRow(line, lineNumber) {
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
  const carbs = parseNumber(parts[carbsIdx]);
  const cals = parseNumber(parts[calsIdx]);

  const timestamp = toIso(date, time);
  const photos = extractPhotos(entryText);
  const predictions = extractPredictions(entryText);
  const bgText = extractBgText(entryText);
  const protein = extractProtein(entryText);
  const title = stripMetadata(entryText);

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
      protein ? `Protein: ${protein}g` : null,
      predictions.raw ? predictions.raw.replace(/^\(|\)$/g, '') : null
    ].filter(Boolean).join('; ')) || null,
    photoUrls: photos,
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

  for (let i = 0; i < lines.length; i++) {
    const row = parseRow(lines[i], i + 1);
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
