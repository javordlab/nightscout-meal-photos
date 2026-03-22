#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const INTERNAL_PHOTO_DIRS = [
  '/Users/javier/.openclaw/media/inbound',
  '/Users/javier/.openclaw/workspace/inbound_photos',
  '/Users/javier/.openclaw/workspace/input'
];

const PLACEHOLDER_PATTERNS = [
  /\[photo received - awaiting manual description\]/i,
  /photo\s*-?\s*needs\s*description/i,
  /pred:\s*tbd/i
];

function isPlaceholderText(text) {
  const value = String(text || '');
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function parseEntryTimeMs(entry) {
  const ms = new Date(entry.timestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function hasInternalPhotoNearTimestamp(entry, maxWindowMinutes = 45) {
  const targetMs = parseEntryTimeMs(entry);
  if (!targetMs) return { found: false, file: null, diffMinutes: null };

  let best = null;
  let bestDiff = maxWindowMinutes * 60 * 1000;

  for (const dir of INTERNAL_PHOTO_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter((f) => /\.(jpg|jpeg|png|heic|webp)$/i.test(f))
      .map((f) => path.join(dir, f));

    for (const filePath of files) {
      try {
        const stats = fs.statSync(filePath);
        const diff = Math.abs(stats.mtime.getTime() - targetMs);
        if (diff <= bestDiff) {
          bestDiff = diff;
          best = filePath;
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  if (!best) return { found: false, file: null, diffMinutes: null };
  return {
    found: true,
    file: best,
    diffMinutes: Math.round(bestDiff / 60000)
  };
}

function validateEntry(entry) {
  const errors = [];
  const warnings = [];

  if (!entry || typeof entry !== 'object') {
    return { errors: [{ reason: 'invalid_entry_object' }], warnings: [] };
  }

  if (!entry.timestamp) errors.push({ reason: 'missing_timestamp' });
  if (!entry.category) errors.push({ reason: 'missing_category' });

  if (entry.category === 'Food') {
    if (!entry.title || !String(entry.title).trim()) {
      errors.push({ reason: 'missing_food_title' });
    }

    const combinedText = `${entry.title || ''} ${entry.notes || ''}`.trim();
    if (isPlaceholderText(combinedText)) {
      errors.push({ reason: 'placeholder_food_entry_blocked' });
    }

    const requiresProtein = String(entry.mealType || '').toLowerCase() === 'breakfast';
    if (requiresProtein && entry.proteinEst == null) {
      errors.push({ reason: 'missing_protein_required_for_breakfast' });
    }

    if (entry.carbsEst == null) {
      errors.push({ reason: 'missing_carbs_required' });
    }

    if (entry.caloriesEst == null) {
      warnings.push({ reason: 'missing_calories_estimate' });
    }

    if (!entry.photoUrls || entry.photoUrls.length === 0) {
      const internal = hasInternalPhotoNearTimestamp(entry);
      if (internal.found) {
        warnings.push({
          reason: 'photo_missing_but_found_in_internal_folder',
          file: internal.file,
          diffMinutes: internal.diffMinutes
        });
      } else {
        warnings.push({ reason: 'missing_photo_urls' });
      }
    }
  }

  return { errors, warnings };
}

function validateEntries(entries) {
  const report = {
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    errors: [],
    warnings: []
  };

  for (const entry of entries) {
    const result = validateEntry(entry);
    for (const err of result.errors) {
      report.errors.push({
        entryKey: entry.entryKey,
        timestamp: entry.timestamp,
        title: entry.title,
        ...err
      });
    }
    for (const warn of result.warnings) {
      report.warnings.push({
        entryKey: entry.entryKey,
        timestamp: entry.timestamp,
        title: entry.title,
        ...warn
      });
    }
  }

  return report;
}

module.exports = {
  INTERNAL_PHOTO_DIRS,
  isPlaceholderText,
  hasInternalPhotoNearTimestamp,
  validateEntry,
  validateEntries
};
