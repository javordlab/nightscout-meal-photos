#!/usr/bin/env node
// unified_sync.js - Phase 2: idempotent orchestrator for Nightscout + Notion + Gallery
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const GALLERY_PATH = path.join(WORKSPACE, 'nightscout-meal-photos', 'data', 'notion_meals.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'unified_sync.log.jsonl');

const NOTION_KEY = process.env.NOTION_KEY || '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';
const NOTION_DB_ID = process.env.NOTION_DB_ID || '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_SECRET = process.env.NIGHTSCOUT_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const { loadSyncState, saveSyncState, upsertEntry, getEntry } = require('./sync_state');

// --- Logging ---
function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

// --- Nightscout ---
function nsRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = `${NIGHTSCOUT_URL}${endpoint}`;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      headers: {
        'api-secret': NIGHTSCOUT_SECRET,
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '[]')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function entryToNightscout(entry) {
  const eventType = entry.category === 'Food' ? 'Meal Bolus' : (entry.category === 'Activity' ? 'Exercise' : 'Note');
  const photo = entry.photoUrls?.[0];
  const notes = [
    entry.title,
    entry.carbsEst ? `(~${entry.carbsEst}g carbs, ~${entry.caloriesEst} kcal)` : null,
    photo ? `📷 ${photo}` : null,
    `[entry_key:${entry.entryKey}]`
  ].filter(Boolean).join(' ');

  return {
    enteredBy: 'javordclaw-ssot',
    eventType,
    carbs: entry.carbsEst,
    notes,
    created_at: entry.timestamp
  };
}

async function syncNightscout(entry, state) {
  const existing = getEntry(state, entry.entryKey)?.nightscout;
  const payload = entryToNightscout(entry);

  if (existing?.treatment_id) {
    try {
      const res = await nsRequest('PUT', '/api/v1/treatments.json', { ...payload, _id: existing.treatment_id });
      log({ op: 'ns_update', entryKey: entry.entryKey, treatmentId: existing.treatment_id, res });
      return { status: 'updated', treatmentId: existing.treatment_id };
    } catch (e) {
      log({ op: 'ns_update_error', entryKey: entry.entryKey, error: e.message });
      return { status: 'error', error: e.message };
    }
  }

  try {
    const res = await nsRequest('POST', '/api/v1/treatments.json', payload);
    let treatmentId = null;
    const isArray = Array.isArray(res);
    const hasFirstId = isArray && res.length > 0 && res[0] && res[0]._id;
    const hasDirectId = res && res._id;
    if (hasFirstId) {
      treatmentId = res[0]._id;
    } else if (hasDirectId) {
      treatmentId = res._id;
    }
    if (!treatmentId) {
      log({ op: 'ns_create_no_id', entryKey: entry.entryKey, isArray, hasFirstId, hasDirectId, resType: typeof res, resPreview: JSON.stringify(res).slice(0, 200) });
      return { status: 'error', error: 'no_treatment_id_returned' };
    }
    upsertEntry(state, entry.entryKey, {
      nightscout: { treatment_id: treatmentId, last_synced_at: new Date().toISOString() }
    });
    log({ op: 'ns_create', entryKey: entry.entryKey, treatmentId });
    return { status: 'created', treatmentId };
  } catch (e) {
    log({ op: 'ns_create_error', entryKey: entry.entryKey, error: e.message });
    return { status: 'error', error: e.message };
  }
}

// --- Notion ---
function notionRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1${endpoint}`;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function entryToNotion(entry) {
  const photo = entry.photoUrls?.[0];
  const properties = {
    Entry: { title: [{ text: { content: entry.title } }] },
    Date: { date: { start: entry.timestamp } },
    User: { select: { name: entry.user } },
    Category: { select: { name: entry.category } },
    'Meal Type': { select: { name: entry.mealType || '-' } },
    'Carbs (est)': entry.carbsEst != null ? { number: entry.carbsEst } : null,
    'Calories (est)': entry.caloriesEst != null ? { number: entry.caloriesEst } : null,
    Photo: photo ? { url: photo } : null
  };
  Object.keys(properties).forEach(k => {
    if (properties[k] == null) delete properties[k];
  });
  return { parent: { database_id: NOTION_DB_ID }, properties };
}

async function syncNotion(entry, state) {
  const existing = getEntry(state, entry.entryKey)?.notion;
  const payload = entryToNotion(entry);

  if (existing?.page_id) {
    try {
      await notionRequest('PATCH', `/pages/${existing.page_id}`, { properties: payload.properties });
      log({ op: 'notion_patch', entryKey: entry.entryKey, pageId: existing.page_id });
      return { status: 'patched', pageId: existing.page_id };
    } catch (e) {
      log({ op: 'notion_patch_error', entryKey: entry.entryKey, error: e.message });
      return { status: 'error', error: e.message };
    }
  }

  try {
    const res = await notionRequest('POST', '/pages', payload);
    const pageId = res?.id;
    if (pageId) {
      upsertEntry(state, entry.entryKey, {
        notion: { page_id: pageId, last_synced_at: new Date().toISOString() }
      });
    }
    log({ op: 'notion_create', entryKey: entry.entryKey, pageId });
    return { status: 'created', pageId };
  } catch (e) {
    log({ op: 'notion_create_error', entryKey: entry.entryKey, error: e.message });
    return { status: 'error', error: e.message };
  }
}

// --- Gallery ---
function syncGallery(entry, state, galleryItems) {
  const existing = getEntry(state, entry.entryKey)?.gallery;
  const photo = entry.photoUrls?.[0];
  if (!photo) return { status: 'skipped', reason: 'no_photo' };

  const match = galleryItems.find(i => i.photo === photo);
  if (match) {
    if (!existing?.gallery_id) {
      upsertEntry(state, entry.entryKey, {
        gallery: { gallery_id: match.id, last_synced_at: new Date().toISOString() }
      });
      log({ op: 'gallery_link', entryKey: entry.entryKey, galleryId: match.id });
    }
    return { status: 'linked', galleryId: match.id };
  }

  const newItem = {
    id: `manual-${entry.timestamp.replace(/:/g, '-')}`,
    entry_key: entry.entryKey,
    title: `${entry.mealType ? entry.mealType + ': ' : ''}${entry.title}`,
    type: entry.mealType || 'Food',
    date: entry.timestamp,
    photo,
    carbs: entry.carbsEst,
    cals: entry.caloriesEst,
    preMeal: entry.actual?.preMealBg || null,
    delta: entry.actual?.bgDelta || null,
    peak: entry.actual?.peakBg || null
  };
  galleryItems.push(newItem);
  upsertEntry(state, entry.entryKey, {
    gallery: { gallery_id: newItem.id, last_synced_at: new Date().toISOString() }
  });
  log({ op: 'gallery_create', entryKey: entry.entryKey, galleryId: newItem.id });
  return { status: 'created', galleryId: newItem.id };
}

// --- Main ---
async function main(options = {}) {
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const state = loadSyncState(SYNC_STATE_PATH);
  const galleryItems = fs.existsSync(GALLERY_PATH) ? JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8')) : [];

  const dryRun = options.dryRun || false;
  const onlyNew = options.onlyNew || false;
  const since = options.since ? new Date(options.since) : null;

  const results = { nightscout: [], notion: [], gallery: [], errors: [] };

  for (const entry of normalized.entries) {
    if (since && new Date(entry.timestamp) < since) continue;
    if (onlyNew) {
      const s = getEntry(state, entry.entryKey);
      if (s?.nightscout?.treatment_id && s?.notion?.page_id) continue;
    }

    // Nightscout
    try {
      const ns = dryRun ? { status: 'dry', treatmentId: null } : await syncNightscout(entry, state);
      results.nightscout.push({ entryKey: entry.entryKey, ...ns });
    } catch (e) {
      results.errors.push({ subsystem: 'nightscout', entryKey: entry.entryKey, error: e.message });
    }

    // Notion
    try {
      const nt = dryRun ? { status: 'dry', pageId: null } : await syncNotion(entry, state);
      results.notion.push({ entryKey: entry.entryKey, ...nt });
    } catch (e) {
      results.errors.push({ subsystem: 'notion', entryKey: entry.entryKey, error: e.message });
    }

    // Gallery
    try {
      const gl = syncGallery(entry, state, galleryItems);
      results.gallery.push({ entryKey: entry.entryKey, ...gl });
    } catch (e) {
      results.errors.push({ subsystem: 'gallery', entryKey: entry.entryKey, error: e.message });
    }
  }

  // Save state
  if (!dryRun) {
    saveSyncState(SYNC_STATE_PATH, state);
    fs.writeFileSync(GALLERY_PATH, JSON.stringify(galleryItems, null, 2) + '\n');
  }

  const summary = {
    dryRun,
    processed: normalized.entries.length,
    nightscout: results.nightscout.filter(r => r.status === 'created' || r.status === 'updated').length,
    notion: results.notion.filter(r => r.status === 'created' || r.status === 'patched').length,
    gallery: results.gallery.filter(r => r.status === 'created' || r.status === 'linked').length,
    errors: results.errors.length
  };

  console.log(JSON.stringify(summary, null, 2));
  return { summary, results };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyNew = args.includes('--only-new');
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.split('=')[1] : null;

  main({ dryRun, onlyNew, since }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, syncNightscout, syncNotion, syncGallery };
