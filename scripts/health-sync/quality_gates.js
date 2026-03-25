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
  /meal photo\s*\(auto-estimated nutrition\)/i,
  /pred:\s*tbd/i
];

const BG_TAG_REGEX = /\bBG:\s*[^;()]+/i;
const PRED_TAG_REGEX = /\bPred:\s*[^;()]+/i;
const MEAL_TYPE_PREFIX_REGEX = /^(Breakfast|Lunch|Snack|Dinner|Dessert):\s+/i;

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

function validateEntry(entry, context = {}) {
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

    const title = String(entry.title || '').trim();
    const notes = String(entry.notes || '').trim();
    const combinedText = `${title} ${notes}`.trim();

    if (isPlaceholderText(combinedText)) {
      errors.push({ reason: 'placeholder_food_entry_blocked' });
    }

    // REQUIRED format guardrails for all Food entries:
    // 1) Meal type prefix in title (e.g., "Dinner: ...")
    // 2) BG annotation present (value + trend text is expected upstream)
    // 3) Pred annotation present (range/time is expected upstream)
    if (!MEAL_TYPE_PREFIX_REGEX.test(title)) {
      errors.push({ reason: 'missing_meal_type_prefix_in_food_title' });
    }

    if (entry.mealType && title) {
      const normalizedMealType = String(entry.mealType).trim().toLowerCase();
      const titlePrefix = (title.match(/^([A-Za-z]+):/) || [])[1];
      if (titlePrefix && titlePrefix.toLowerCase() !== normalizedMealType) {
        errors.push({
          reason: 'meal_type_prefix_mismatch',
          expectedMealType: entry.mealType,
          titlePrefix
        });
      }
    }

    if (!BG_TAG_REGEX.test(combinedText)) {
      errors.push({ reason: 'missing_bg_annotation_for_food' });
    }

    if (!PRED_TAG_REGEX.test(combinedText)) {
      errors.push({ reason: 'missing_prediction_annotation_for_food' });
    }

    if (entry.proteinEst == null) {
      errors.push({ reason: 'missing_protein_required_for_food' });
    }

    if (entry.carbsEst == null) {
      errors.push({ reason: 'missing_carbs_required' });
    }

    if (entry.caloriesEst == null) {
      warnings.push({ reason: 'missing_calories_estimate' });
    }

    if (!entry.photoUrls || entry.photoUrls.length === 0) {
      const imageOriginMatch = typeof context.findImageOriginMatch === 'function'
        ? context.findImageOriginMatch(entry)
        : null;

      if (imageOriginMatch) {
        errors.push({
          reason: 'missing_photo_url_for_image_origin_entry',
          imageOriginType: imageOriginMatch.contentType || imageOriginMatch.mediaKind || 'image',
          imageOriginMessageId: imageOriginMatch.messageId || null,
          imageOriginDiffMinutes: imageOriginMatch.diffMinutes ?? null
        });
      }

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

function validateEntries(entries, context = {}) {
  const report = {
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    errors: [],
    warnings: []
  };

  for (const entry of entries) {
    const result = validateEntry(entry, context);
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
