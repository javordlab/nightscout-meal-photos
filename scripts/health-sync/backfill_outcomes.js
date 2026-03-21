#!/usr/bin/env node
// backfill_outcomes.js - Phase 3: automated glucose outcome calculation
const https = require('https');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const GALLERY_PATH = path.join(WORKSPACE, 'nightscout-meal-photos', 'data', 'notion_meals.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'backfill_outcomes.log.jsonl');

const NOTION_KEY = process.env.NOTION_KEY || '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';
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_SECRET = process.env.NIGHTSCOUT_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_DB_ID = process.env.NOTION_DB_ID || '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

const { loadSyncState, saveSyncState, getEntry } = require('./sync_state');

// --- Logging ---
function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

// --- Nightscout Glucose Fetch ---
function fetchGlucose(sinceIso, count = 5000) {
  return new Promise((resolve, reject) => {
    const sinceMs = new Date(sinceIso).getTime();
    const url = `${NIGHTSCOUT_URL}/api/v1/entries.json?find[date][$gte]=${sinceMs}&count=${count}`;
    const options = {
      headers: { 'api-secret': NIGHTSCOUT_SECRET, 'Content-Type': 'application/json' }
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '[]')); } catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Glucose Analysis ---
function getPreMealBg(glucoseEntries, mealTimeIso, windowMin = 15, verbose = false) {
  const target = new Date(mealTimeIso).getTime();
  const windowMs = windowMin * 60 * 1000;
  if (verbose) console.log(`  Target ms: ${target}, ISO: ${mealTimeIso}`);
  let closest = null;
  let minDiff = Infinity;
  let checked = 0;
  for (const e of glucoseEntries) {
    const t = e.date || e.mills;
    if (typeof t !== 'number') continue;
    checked++;
    const diff = Math.abs(t - target);
    if (diff < windowMs && diff < minDiff) {
      minDiff = diff;
      closest = e;
    }
  }
  if (verbose) console.log(`  Checked ${checked} entries, closest: ${closest ? JSON.stringify({t:closest.sgv,ms:closest.date||closest.mills}) : 'none'}`);
  return closest ? closest.sgv : null;
}

function getPeakInWindow(glucoseEntries, mealTimeIso, hours = 3) {
  const start = new Date(mealTimeIso).getTime();
  const end = start + hours * 60 * 60 * 1000;
  let peakBg = 0;
  let peakTime = null;
  for (const e of glucoseEntries) {
    const t = e.date || e.mills;
    if (t >= start && t <= end && e.sgv > peakBg) {
      peakBg = e.sgv;
      peakTime = new Date(t).toISOString();
    }
  }
  return peakBg > 0 ? { peakBg, peakTime } : null;
}

function getTwoHourPeak(glucoseEntries, mealTimeIso) {
  const start = new Date(mealTimeIso).getTime();
  const end = start + 2 * 60 * 60 * 1000;
  let peakBg = 0;
  for (const e of glucoseEntries) {
    const t = e.date || e.mills;
    if (t >= start && t <= end && e.sgv > peakBg) {
      peakBg = e.sgv;
    }
  }
  return peakBg > 0 ? peakBg : null;
}

function calculateOutcomes(glucoseEntries, mealTimeIso, predicted, verbose = false) {
  try {
    const preMealBg = getPreMealBg(glucoseEntries, mealTimeIso, 15, verbose);
    const peakData = getPeakInWindow(glucoseEntries, mealTimeIso, 3);
    const twoHourPeak = getTwoHourPeak(glucoseEntries, mealTimeIso);

    if (!preMealBg) {
      if (verbose) console.log('  No pre-meal BG found');
      return null;
    }
    if (!peakData) {
      if (verbose) console.log('  No peak data found');
      return null;
    }
    if (verbose) console.log(`  Pre: ${preMealBg}, Peak: ${peakData.peakBg}`);

    const delta = peakData.peakBg - preMealBg;
    if (verbose) console.log(`  Delta: ${delta}, calculating rest...`);
    const timeToPeakMin = Math.round((new Date(peakData.peakTime).getTime() - new Date(mealTimeIso).getTime()) / (60 * 1000));

  // Calculate deltas from predicted
  let peakBgDelta = null;
  let peakTimeDeltaMin = null;
  if (predicted?.peakBgRange) {
    const [low, high] = predicted.peakBgRange;
    const predictedMid = (low + high) / 2;
    peakBgDelta = peakData.peakBg - predictedMid;
  }
  if (predicted?.peakTime) {
    const predictedTime = new Date(predicted.peakTime).getTime();
    peakTimeDeltaMin = Math.round((new Date(peakData.peakTime).getTime() - predictedTime) / (60 * 1000));
  }

  const outcomes = {
    preMealBg,
    peakBg: peakData.peakBg,
    peakTime: peakData.peakTime,
    bgDelta: delta,
    timeToPeakMin,
    peakBgDelta,
    peakTimeDeltaMin,
    twoHourPeakBg: twoHourPeak
  };
  if (verbose) console.log(`  Outcomes calculated: delta=${outcomes.bgDelta}, timeToPeak=${outcomes.timeToPeakMin}`);
  return outcomes;
  } catch (e) {
    if (verbose) console.log(`  Error in calculateOutcomes: ${e.message}`);
    return null;
  }
}

// --- Notion Update ---
function notionPatch(pageId, properties) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1/pages/${pageId}`;
    const data = JSON.stringify({ properties });
    const options = {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- Gallery Update ---
function updateGallery(galleryItems, entryKey, outcomes) {
  const idx = galleryItems.findIndex(i => i.entry_key === entryKey);
  if (idx < 0) return false;
  galleryItems[idx].preMeal = outcomes.preMealBg;
  galleryItems[idx].delta = outcomes.bgDelta;
  galleryItems[idx].peak = outcomes.peakBg;
  return true;
}

// --- Main ---
async function main(options = {}) {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const state = loadSyncState(SYNC_STATE_PATH);
  const galleryItems = fs.existsSync(GALLERY_PATH) ? JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8')) : [];

  const dryRun = options.dryRun || false;
  const since = options.since ? new Date(options.since) : null;
  const minAgeHours = options.minAgeHours || 3;
  const now = new Date();

  // Filter eligible Food entries
  const eligible = (normalized.entries || []).filter(entry => {
    if (entry.category !== 'Food') return false;
    if (entry.actual?.outcomesBackfilled) return false;
    const entryTime = new Date(entry.timestamp);
    if (since && entryTime < since) return false;
    const ageHours = (now - entryTime) / (1000 * 60 * 60);
    return ageHours >= minAgeHours;
  });

  console.log(`Found ${eligible.length} eligible entries for outcome backfill`);

  if (eligible.length === 0) {
    return { processed: 0, updated: 0, errors: 0 };
  }

  // Fetch glucose data once (covering all eligible entries)
  const earliestEntry = new Date(Math.min(...eligible.map(e => new Date(e.timestamp))));
  const glucoseSince = new Date(earliestEntry.getTime() - 60 * 60 * 1000).toISOString();
  console.log(`Fetching glucose since ${glucoseSince}`);
  const glucoseEntries = await fetchGlucose(glucoseSince);
  console.log(`Fetched ${glucoseEntries.length} glucose readings`);

  const results = { processed: 0, updated: 0, notionUpdated: 0, galleryUpdated: 0, errors: [] };

  for (const entry of eligible) {
    results.processed++;
    const syncEntry = getEntry(state, entry.entryKey);
    console.log(`\nProcessing: ${entry.title} @ ${entry.timestamp}`);
    console.log(`  Glucose window: ${entry.timestamp} +/- 15min`);

    // Calculate outcomes
    const outcomes = calculateOutcomes(glucoseEntries, entry.timestamp, entry.predicted);
    if (!outcomes) {
      log({ op: 'no_outcomes', entryKey: entry.entryKey, reason: 'insufficient_glucose_data' });
      continue;
    }

    // Update Notion
    const notionPageId = syncEntry?.notion?.page_id;
    if (notionPageId && !dryRun) {
      try {
        await notionPatch(notionPageId, {
          'Pre-Meal BG': outcomes.preMealBg ? { number: outcomes.preMealBg } : null,
          '2hr Peak BG': outcomes.twoHourPeakBg ? { number: outcomes.twoHourPeakBg } : null,
          'Peak Time': outcomes.peakTime ? { date: { start: outcomes.peakTime } } : null,
          'BG Delta': outcomes.bgDelta != null ? { number: outcomes.bgDelta } : null,
          'Time to Peak (min)': outcomes.timeToPeakMin ? { number: outcomes.timeToPeakMin } : null,
          'Peak BG Delta': outcomes.peakBgDelta != null ? { number: outcomes.peakBgDelta } : null,
          'Peak Time Delta (min)': outcomes.peakTimeDeltaMin != null ? { number: outcomes.peakTimeDeltaMin } : null
        });
        results.notionUpdated++;
        log({ op: 'notion_outcomes', entryKey: entry.entryKey, pageId: notionPageId, outcomes });
      } catch (e) {
        results.errors.push({ entryKey: entry.entryKey, subsystem: 'notion', error: e.message });
        log({ op: 'notion_error', entryKey: entry.entryKey, error: e.message });
      }
    }

    // Update Gallery
    if (!dryRun) {
      const galleryUpdated = updateGallery(galleryItems, entry.entryKey, outcomes);
      if (galleryUpdated) {
        results.galleryUpdated++;
        log({ op: 'gallery_outcomes', entryKey: entry.entryKey, outcomes });
      }
    }

    // Mark as backfilled in sync state
    if (!dryRun) {
      state.entries[entry.entryKey] = state.entries[entry.entryKey] || {};
      state.entries[entry.entryKey].outcomes_backfilled = true;
      state.entries[entry.entryKey].actual_outcomes = outcomes;
      results.updated++;
    }
  }

  // Save state
  if (!dryRun) {
    saveSyncState(SYNC_STATE_PATH, state);
    fs.writeFileSync(GALLERY_PATH, JSON.stringify(galleryItems, null, 2) + '\n');
  }

  console.log(JSON.stringify(results, null, 2));
  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.split('=')[1] : null;
  const minAgeArg = args.find(a => a.startsWith('--min-age='));
  const minAgeHours = minAgeArg ? parseInt(minAgeArg.split('=')[1], 10) : 3;

  main({ dryRun, since, minAgeHours }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, calculateOutcomes, fetchGlucose, getPreMealBg, getPeakInWindow };
