#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { validateEntries } = require('./quality_gates');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const REPORT_PATH = path.join(WORKSPACE, 'data', 'health_sync_validation_report.json');
const PENDING_PHOTO_PATH = path.join(WORKSPACE, 'data', 'pending_photo_entries.json');

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function loadPendingPhotoEntries() {
  if (!fs.existsSync(PENDING_PHOTO_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_PHOTO_PATH, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(item => item && item.timestamp)
      .map(item => {
        const tsMs = new Date(item.timestamp).getTime();
        return { ...item, tsMs };
      })
      .filter(item => Number.isFinite(item.tsMs));
  } catch {
    return [];
  }
}

function isImageOriginPending(item) {
  const mediaKind = String(item.mediaKind || '').toLowerCase();
  const contentType = String(item.contentType || '').toUpperCase();
  if (mediaKind === 'image') return true;
  return ['PHOTO', 'PHOTO_TEXT', 'IMAGE_DOCUMENT'].includes(contentType);
}

function buildImageOriginMatcher(pendingItems) {
  const imageItems = pendingItems.filter(isImageOriginPending);
  return (entry) => {
    if (!entry || entry.category !== 'Food' || !entry.timestamp) return null;
    const entryTs = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(entryTs)) return null;
    const mealType = String(entry.mealType || '').toLowerCase();

    const candidates = imageItems
      .map(item => {
        const diffMs = Math.abs(item.tsMs - entryTs);
        const pendingMeal = String(item.mealType || '').toLowerCase();
        return {
          ...item,
          diffMs,
          diffMinutes: Math.round(diffMs / 60000),
          mealMatch: pendingMeal && mealType ? pendingMeal === mealType : false
        };
      })
      .filter(item => item.diffMs <= 3 * 60 * 1000)
      .sort((a, b) => {
        if (a.mealMatch !== b.mealMatch) return a.mealMatch ? -1 : 1;
        return a.diffMs - b.diffMs;
      });

    return candidates[0] || null;
  };
}

function main(options = {}) {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const since = options.since ? new Date(options.since) : null;
  const scopedEntries = (normalized.entries || []).filter((entry) => {
    if (!since) return true;
    return new Date(entry.timestamp) >= since;
  });

  const pendingPhotoEntries = loadPendingPhotoEntries();
  const findImageOriginMatch = buildImageOriginMatcher(pendingPhotoEntries);

  const report = validateEntries(scopedEntries, {
    findImageOriginMatch
  });

  for (const entry of scopedEntries) {
    if (entry.photoUrls) {
      for (const photo of entry.photoUrls) {
        if (!isValidUrl(photo)) {
          report.errors.push({ entryKey: entry.entryKey, reason: 'invalid_photo_url', value: photo, title: entry.title });
        }
      }
    }
  }

  report.entryCount = scopedEntries.length;

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Validation complete. errors=${report.errors.length}, warnings=${report.warnings.length}`);
  console.log(`Wrote ${REPORT_PATH}`);

  if (options.failOnError && report.errors.length > 0) {
    throw new Error(`validation_failed:${report.errors.length}`);
  }

  return report;
}

if (require.main === module) {
  try {
    const sinceArg = process.argv.find(a => a.startsWith('--since='));
    const since = sinceArg ? sinceArg.split('=')[1] : null;
    main({
      failOnError: process.argv.includes('--fail-on-error'),
      since
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { main };
