#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const LOG_PATH = path.join(WORKSPACE, 'health_log.md');
const PENDING_PATH = path.join(WORKSPACE, 'data', 'pending_photo_entries.json');

function cleanWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function parseRow(line) {
  const parts = line.split('|').map(x => x.trim());
  if (parts.length < 9) return null;
  if (!/^202\d-\d\d-\d\d$/.test(parts[1])) return null;

  const date = parts[1];
  const time = parts[2];
  const user = parts[3];
  const category = parts[4];
  const mealType = parts[5];
  const carbsIdx = parts.length - 3;
  const calsIdx = parts.length - 2;
  const entryText = parts.slice(6, carbsIdx).join(' | ');

  const hasPendingMarker = /\[[^\]]*\]\(\s*pending\s*\)/i.test(entryText);
  const hasPhotoLink = /\[[^\]]*\]\(\s*https?:\/\//i.test(entryText);

  return {
    date,
    time,
    user,
    category,
    mealType,
    carbs: parts[carbsIdx],
    cals: parts[calsIdx],
    timestamp: toIso(date, time),
    entryText,
    hasPendingMarker,
    hasPhotoLink,
  };
}

function loadPendingPhotos() {
  if (!fs.existsSync(PENDING_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(item => item)
      .map(item => ({
        ...item,
        tsMs: new Date(item.timestamp).getTime(),
        mealTypeNorm: cleanWhitespace(item.mealType || '').toLowerCase(),
        photoUrl: /^https?:\/\//i.test(String(item.photoUrl || '')) ? String(item.photoUrl) : null
      }))
      .filter(item => Number.isFinite(item.tsMs));
  } catch {
    return [];
  }
}

function findPendingPhotoUrl(row, pendingPhotos) {
  if (!row || row.hasPhotoLink) return null;

  const categoryNorm = cleanWhitespace(row.category || '').toLowerCase();
  // Safety: automatic attachment is only valid for Food entries.
  // Non-food rows may contain words like lunch/dinner but should never inherit meal photos.
  if (categoryNorm !== 'food') return null;
  const rowTs = new Date(row.timestamp).getTime();
  if (!Number.isFinite(rowTs)) return null;

  const mealTypeNorm = cleanWhitespace(row.mealType || '').toLowerCase();
  const maxDiffMs = row.hasPendingMarker ? 10 * 60 * 1000 : 2 * 60 * 1000;

  const baseCandidates = pendingPhotos
    .filter(item => item.photoUrl)
    .map(item => ({
      ...item,
      diffMs: Math.abs(item.tsMs - rowTs),
      mealMatch: item.mealTypeNorm === mealTypeNorm,
    }))
    .filter(item => item.diffMs <= maxDiffMs)
    .sort((a, b) => a.diffMs - b.diffMs);

  if (baseCandidates.length === 0) return null;

  if (row.hasPendingMarker) {
    baseCandidates.sort((a, b) => {
      if (a.mealMatch !== b.mealMatch) return a.mealMatch ? -1 : 1;
      return a.diffMs - b.diffMs;
    });
    return baseCandidates[0].photoUrl;
  }

  // For rows missing any photo link (no pending marker), prefer strict meal match first.
  const mealMatched = baseCandidates.filter(c => c.mealMatch);
  if (mealMatched.length > 0) {
    return mealMatched[0].photoUrl;
  }

  // Fallback: if exactly one very-close candidate exists, allow attach even if meal label differs
  // (e.g. pipeline inferred Lunch but user logged as Snack).
  if (baseCandidates.length === 1) {
    return baseCandidates[0].photoUrl;
  }

  return null;
}

function rebuildRow(row, entryText) {
  return `| ${row.date} | ${row.time} | ${row.user} | ${row.category} | ${row.mealType} | ${entryText} | ${row.carbs} | ${row.cals} |`;
}

function applyReplacement(line, row, url) {
  let entryText = row.entryText;

  // If same URL already exists, remove pending marker and leave row untouched otherwise.
  if (entryText.includes(`](${url})`)) {
    entryText = entryText.replace(/\s*\[[^\]]*\]\(\s*pending\s*\)/ig, '');
    return rebuildRow(row, cleanWhitespace(entryText));
  }

  if (row.hasPendingMarker) {
    entryText = entryText.replace(/\[[^\]]*\]\(\s*pending\s*\)/ig, `[📷](${url})`);
  } else if (!row.hasPhotoLink) {
    entryText = `${entryText} [📷](${url})`;
  }

  return rebuildRow(row, cleanWhitespace(entryText));
}

async function main() {
  if (!fs.existsSync(LOG_PATH)) {
    throw new Error(`health_log_not_found:${LOG_PATH}`);
  }

  const pendingPhotos = loadPendingPhotos();
  if (pendingPhotos.length === 0) {
    return { updated: 0, skipped: 'no_pending_photo_entries' };
  }

  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
  let updated = 0;

  for (let i = 0; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    if (!row) continue;
    if (row.hasPhotoLink && !row.hasPendingMarker) continue;

    const resolvedUrl = findPendingPhotoUrl(row, pendingPhotos);
    if (!resolvedUrl) continue;

    const next = applyReplacement(lines[i], row, resolvedUrl);
    if (next !== lines[i]) {
      lines[i] = next;
      updated++;
    }
  }

  if (updated > 0) {
    fs.writeFileSync(LOG_PATH, `${lines.join('\n')}`);
  }

  return { updated };
}

if (require.main === module) {
  main()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

module.exports = { main };
