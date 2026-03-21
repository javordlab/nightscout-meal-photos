#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const OUTPUT_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');

const { loadSyncState, saveSyncState, upsertEntry } = require('./sync_state');

const PHOTO_REGEX = /\[📷\]\((https?:\/\/[^)]+)\)/g;
const PRED_REGEX = /\(Pred:\s*([^@)]+?)\s*@\s*([^)]+)\)/i;
const BG_REGEX = /\(BG:\s*([^)]*?)\)/i;

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

function stripMetadata(entryText) {
  let text = stripPhotos(entryText);
  text = cleanWhitespace(text.replace(BG_REGEX, '').replace(PRED_REGEX, ''));
  return text;
}

function parseNumber(value) {
  if (!value || value === 'null') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferOffset(date, timeValue) {
  if (/[-+]\d\d:\d\d$/.test(timeValue)) {
    return timeValue.match(/([-+]\d\d:\d\d)$/)[1];
  }

  const d = new Date(`${date}T${timeValue}:00Z`);
  const dstStart = new Date('2026-03-08T10:00:00Z');
  return d >= dstStart ? '-07:00' : '-08:00';
}

function toIso(date, timeCell) {
  const trimmed = cleanWhitespace(timeCell);
  const parts = trimmed.split(' ');
  const timeOnly = parts[0];
  const offset = parts[1] || inferOffset(date, trimmed);
  return `${date}T${timeOnly}:00${offset}`;
}

function buildEntryKey(entry) {
  const basis = [
    entry.timestamp,
    entry.user,
    entry.category,
    entry.mealType,
    normalizeTitle(entry.title)
  ].join('|');
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
  const entryText = parts[6];
  const carbs = parseNumber(parts[7]);
  const cals = parseNumber(parts[8]);

  const timestamp = toIso(date, time);
  const photos = extractPhotos(entryText);
  const predictions = extractPredictions(entryText);
  const bgText = extractBgText(entryText);
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
      predictions.raw ? predictions.raw.replace(/^\(|\)$/g, '') : null
    ].filter(Boolean).join('; ')) || null,
    photoUrls: photos,
    carbsEst: carbs,
    caloriesEst: cals,
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
  if (!fs.existsSync(LOG_PATH)) {
    throw new Error(`health_log.md not found: ${LOG_PATH}`);
  }

  const raw = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = raw.split('\n');
  const entries = [];
  const syncState = loadSyncState(SYNC_STATE_PATH);

  lines.forEach((line, index) => {
    if (!line.trim().startsWith('| 202')) return;
    const parsed = parseRow(line, index + 1);
    if (!parsed) return;

    const existingState = syncState.entries[parsed.entryKey] || {};
    parsed.sync = {
      nightscout: existingState.nightscout?.treatment_id ? 'linked' : 'pending',
      notion: existingState.notion?.page_id ? 'linked' : 'pending',
      gallery: existingState.gallery?.gallery_id ? 'linked' : 'pending',
      outcomesBackfilled: Boolean(existingState.outcomes_backfilled)
    };

    upsertEntry(syncState, parsed.entryKey, {
      timestamp: parsed.timestamp,
      content_hash: parsed.contentHash,
      user: parsed.user,
      category: parsed.category,
      meal_type: parsed.mealType,
      title: parsed.title,
      photo_urls: parsed.photoUrls,
      outcomes_backfilled: existingState.outcomes_backfilled || false
    });

    entries.push(parsed);
  });

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    source: LOG_PATH,
    entryCount: entries.length,
    entries
  }, null, 2) + '\n');

  saveSyncState(SYNC_STATE_PATH, syncState);

  console.log(`Normalized ${entries.length} entries.`);
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Updated ${SYNC_STATE_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  parseRow,
  buildEntryKey,
  buildContentHash,
  extractPhotos,
  stripPhotos,
  main
};
