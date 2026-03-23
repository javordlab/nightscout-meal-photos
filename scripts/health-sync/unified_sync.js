#!/usr/bin/env node
// unified_sync.js - Phase 2: idempotent orchestrator for Nightscout + Notion + Gallery
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = process.cwd();
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const GALLERY_PATH = path.join(WORKSPACE, 'nightscout-meal-photos', 'data', 'notion_meals.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'unified_sync.log.jsonl');
const LOCK_PATH = path.join(WORKSPACE, 'data', 'sync.lock');

// --- Lock Management ---
function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const lockTime = fs.statSync(LOCK_PATH).mtime;
    const now = new Date();
    // Auto-release lock if older than 10 minutes
    if (now - lockTime > 10 * 60 * 1000) {
      console.warn('⚠️ Found stale lock file, auto-releasing...');
      releaseLock();
    } else {
      console.error(`❌ Sync already in progress (Lock created at: ${lockTime.toISOString()})`);
      process.exit(1);
    }
  }
  fs.writeFileSync(LOCK_PATH, process.pid.toString());
}

function releaseLock() {
  if (fs.existsSync(LOCK_PATH)) {
    fs.unlinkSync(LOCK_PATH);
  }
}

const NOTION_KEY = process.env.NOTION_KEY || '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';
const NOTION_DB_ID = process.env.NOTION_DB_ID || '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_SECRET = process.env.NIGHTSCOUT_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const { loadSyncState, saveSyncState, upsertEntry, getEntry } = require('./sync_state');
const { validateEntry } = require('./quality_gates');

// --- Logging ---
function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetries(label, fn, retries = 3, backoffMs = 500) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const value = await fn(attempt);
      if (attempt > 1) {
        log({ op: `${label}_retry_success`, attempt });
      }
      return value;
    } catch (error) {
      lastError = error;
      log({ op: `${label}_retry_error`, attempt, error: error.message });
      if (attempt < retries) {
        await sleep(backoffMs * attempt);
      }
    }
  }
  throw lastError || new Error(`${label}_failed_after_retries`);
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

function getProteinEst(entry) {
  if (entry?.proteinEst != null) return entry.proteinEst;
  const notesMatch = String(entry?.notes || '').match(/Protein:\s*([\d.]+)\s*g/i);
  if (notesMatch) {
    const parsed = Number(notesMatch[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  const titleMatch = String(entry?.title || '').match(/Protein:\s*([\d.]+)\s*g/i);
  if (titleMatch) {
    const parsed = Number(titleMatch[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function entryToNightscout(entry) {
  const eventType = entry.category === 'Food' ? 'Meal Bolus' : (entry.category === 'Activity' ? 'Exercise' : 'Note');
  const photo = entry.category === 'Food' ? entry.photoUrls?.[0] : null;
  const proteinEst = getProteinEst(entry);
  const notes = [
    entry.title,
    entry.notes ? `(${entry.notes.replace(/;\s*/g, ') (')})` : null,
    entry.carbsEst != null ? `(~${entry.carbsEst}g carbs, ~${entry.caloriesEst} kcal)` : null,
    proteinEst != null ? `(~${proteinEst}g protein)` : null,
    photo ? `📷 ${photo}` : null,
    `[entry_key:${entry.entryKey}]`
  ].filter(Boolean).join(' ');

  return {
    enteredBy: 'javordclaw-ssot',
    eventType,
    carbs: entry.carbsEst,
    protein: proteinEst,
    notes,
    created_at: entry.timestamp
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findNsTreatmentByEntryKey(entryKey) {
  try {
    const token = `[entry_key:${entryKey}]`;
    const escapedToken = escapeRegex(token);
    const q = encodeURIComponent(escapedToken);
    const res = await nsRequest('GET', `/api/v1/treatments.json?find[notes][$regex]=${q}&count=10`);
    if (!Array.isArray(res) || res.length === 0) return null;
    const exact = res.find(r => (r.notes || '').includes(token));
    return exact?._id || null;
  } catch {
    return null;
  }
}

async function verifyNightscoutSync(entryKey, treatmentId) {
  const token = `[entry_key:${entryKey}]`;

  if (treatmentId) {
    try {
      const byId = await nsRequest('GET', `/api/v1/treatments.json?find[_id]=${encodeURIComponent(treatmentId)}&count=1`);
      if (Array.isArray(byId)) {
        const match = byId.find(r => r._id === treatmentId && (r.notes || '').includes(token));
        if (match) {
          return { ok: true, mode: 'id+token', treatmentId };
        }
      }
    } catch {
      // fallback below
    }
  }

  const foundByKey = await findNsTreatmentByEntryKey(entryKey);
  if (foundByKey) {
    return { ok: true, mode: 'entry_key', treatmentId: foundByKey };
  }

  return { ok: false, mode: 'none', treatmentId: null };
}

async function syncNightscout(entry, state) {
  const existing = getEntry(state, entry.entryKey)?.nightscout;
  const payload = entryToNightscout(entry);

  if (existing?.treatment_id) {
    try {
      await withRetries('ns_update', async () => {
        await nsRequest('PUT', '/api/v1/treatments.json', { ...payload, _id: existing.treatment_id });
      });

      let verified = await withRetries('ns_verify_update', () => verifyNightscoutSync(entry.entryKey, existing.treatment_id));

      if (!verified.ok) {
        log({ op: 'ns_stale_link_detected', entryKey: entry.entryKey, staleTreatmentId: existing.treatment_id });
        const recreateRes = await withRetries('ns_recreate', async () => nsRequest('POST', '/api/v1/treatments.json', payload));
        const recreatedId = (Array.isArray(recreateRes) && recreateRes[0]?._id) || recreateRes?._id || null;
        verified = await withRetries('ns_verify_recreate', () => verifyNightscoutSync(entry.entryKey, recreatedId));
        if (!verified.ok) {
          throw new Error('nightscout_verify_failed_after_recreate');
        }
      }

      const treatmentId = verified.treatmentId || existing.treatment_id;
      upsertEntry(state, entry.entryKey, {
        nightscout: { treatment_id: treatmentId, last_synced_at: new Date().toISOString() }
      });
      log({ op: 'ns_update', entryKey: entry.entryKey, treatmentId, verifyMode: verified.mode });
      return { status: 'updated', treatmentId };
    } catch (e) {
      log({ op: 'ns_update_error', entryKey: entry.entryKey, error: e.message });
      return { status: 'error', error: e.message };
    }
  }

  try {
    const res = await withRetries('ns_create', async () => nsRequest('POST', '/api/v1/treatments.json', payload));
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
      treatmentId = await findNsTreatmentByEntryKey(entry.entryKey);
      if (!treatmentId) {
        log({ op: 'ns_create_no_id', entryKey: entry.entryKey, isArray, hasFirstId, hasDirectId, resType: typeof res, resPreview: JSON.stringify(res).slice(0, 200) });
        return { status: 'error', error: 'no_treatment_id_returned' };
      }
      log({ op: 'ns_create_recovered_id', entryKey: entry.entryKey, treatmentId });
    }

    const verified = await withRetries('ns_verify_create', () => verifyNightscoutSync(entry.entryKey, treatmentId));
    if (!verified.ok) {
      throw new Error('nightscout_verify_failed_after_create');
    }

    upsertEntry(state, entry.entryKey, {
      nightscout: { treatment_id: verified.treatmentId || treatmentId, last_synced_at: new Date().toISOString() }
    });
    log({ op: 'ns_create', entryKey: entry.entryKey, treatmentId: verified.treatmentId || treatmentId, verifyMode: verified.mode });
    return { status: 'created', treatmentId: verified.treatmentId || treatmentId };
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
        'Notion-Version': '2022-06-28',
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

function parsePredictedPeakBg(entry) {
  const text = String(entry?.predicted?.peakBgText || '');
  if (!text) return null;
  const nums = text.match(/[\d.]+/g)?.map(Number).filter(Number.isFinite) || [];
  if (nums.length === 0) return null;
  return nums.length >= 2 ? Math.max(nums[0], nums[1]) : nums[0];
}

function parsePredictedPeakTimeIso(entry) {
  const text = String(entry?.predicted?.peakTimeText || '').trim();
  if (!text) return null;

  const ts = String(entry?.timestamp || '');
  const datePart = ts.split('T')[0];
  const offsetMatch = ts.match(/([+-]\d\d:\d\d|Z)$/);
  const offset = offsetMatch ? offsetMatch[1] : '-07:00';

  let start = text;
  const rangeSplit = text.split('-');
  if (rangeSplit.length >= 2) start = rangeSplit[0].trim();

  const ampm = text.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() || start.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase();
  const hhmm = start.match(/(\d{1,2}):(\d{2})/);
  if (!hhmm || !datePart) return null;

  let hh = Number(hhmm[1]);
  const mm = Number(hhmm[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  if (ampm === 'PM' && hh < 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;

  const h = String(hh).padStart(2, '0');
  const m = String(mm).padStart(2, '0');
  return `${datePart}T${h}:${m}:00${offset}`;
}

function normalizeDedupTitle(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]\(([^)]+)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getNotionEntryTitle(page) {
  const title = page?.properties?.Entry?.title;
  if (!Array.isArray(title)) return '';
  return title.map(t => t?.plain_text || '').join('').trim();
}

async function findNotionExistingPage(entry) {
  try {
    const res = await notionRequest('POST', `/databases/${NOTION_DB_ID}/query`, {
      filter: {
        and: [
          { property: 'Date', date: { equals: entry.timestamp } },
          { property: 'Category', select: { equals: entry.category } }
        ]
      },
      page_size: 50
    });

    if (!Array.isArray(res?.results) || res.results.length === 0) return null;

    const wanted = normalizeDedupTitle(entry.title);
    const candidates = res.results
      .filter(p => !p.archived)
      .map(p => {
        const title = getNotionEntryTitle(p);
        return {
          id: p.id,
          title,
          normalized: normalizeDedupTitle(title),
          created: p.created_time || ''
        };
      })
      .filter(p => p.id && p.normalized);

    if (candidates.length === 0) return null;

    const exact = candidates.find(p => p.normalized === wanted);
    if (exact) return exact.id;

    const fuzzy = candidates.find(p => p.normalized.startsWith(wanted) || wanted.startsWith(p.normalized));
    if (fuzzy) return fuzzy.id;

    candidates.sort((a, b) => String(a.created).localeCompare(String(b.created)));
    return candidates[0].id;
  } catch (error) {
    log({ op: 'notion_dedup_lookup_error', entryKey: entry.entryKey, error: error.message });
    return null;
  }
}

function entryToNotion(entry) {
  const photo = entry.category === 'Food' ? entry.photoUrls?.[0] : null;
  const proteinEst = getProteinEst(entry);
  const carbsForFallback = Number.isFinite(entry.carbsEst) ? entry.carbsEst : 0;
  const predPeakBg = parsePredictedPeakBg(entry) ??
    (entry.category === 'Food' && carbsForFallback > 0
      ? Math.min(Math.round(120 + carbsForFallback * 3.5), 300)
      : null);
  const predPeakTimeIso = parsePredictedPeakTimeIso(entry) ??
    (entry.category === 'Food' && entry.timestamp
      ? new Date(new Date(entry.timestamp).getTime() + 105 * 60 * 1000).toISOString()
      : null);
  const details = entry.notes ? ` (${entry.notes.replace(/;\s*/g, ') (')})` : '';
  const notionTitle = `${entry.title}${details}`.slice(0, 1900);

  const properties = {
    Entry: { title: [{ text: { content: notionTitle } }] },
    Date: { date: { start: entry.timestamp } },
    User: { select: { name: entry.user } },
    Category: { select: { name: entry.category } },
    'Meal Type': { select: { name: entry.mealType || '-' } },
    'Carbs (est)': entry.carbsEst != null ? { number: entry.carbsEst } : null,
    'Calories (est)': entry.caloriesEst != null ? { number: entry.caloriesEst } : null,
    'Proteins': proteinEst != null ? { number: proteinEst } : null,
    'Predicted Peak BG': predPeakBg != null ? { number: predPeakBg } : null,
    'Predicted Peak Time': predPeakTimeIso ? { date: { start: predPeakTimeIso } } : null,
    // Keep Photo always present so PATCH can clear stale URLs by sending { url: null }.
    Photo: { url: photo || null }
  };
  Object.keys(properties).forEach(k => {
    if (k === 'Photo') return;
    if (properties[k] == null) delete properties[k];
  });
  return { parent: { database_id: NOTION_DB_ID }, properties };
}

async function syncNotion(entry, state) {
  const existing = getEntry(state, entry.entryKey)?.notion;
  const payload = entryToNotion(entry);

  if (existing?.page_id) {
    try {
      const res = await notionRequest('PATCH', `/pages/${existing.page_id}`, { properties: payload.properties });
      if (res?.object === 'error') {
        log({ op: 'notion_patch_error', entryKey: entry.entryKey, pageId: existing.page_id, error: res.message, code: res.code });
        return { status: 'error', error: res.message || 'notion_patch_failed' };
      }
      log({ op: 'notion_patch', entryKey: entry.entryKey, pageId: existing.page_id });
      return { status: 'patched', pageId: existing.page_id };
    } catch (e) {
      log({ op: 'notion_patch_error', entryKey: entry.entryKey, error: e.message });
      return { status: 'error', error: e.message };
    }
  }

  const dedupPageId = await findNotionExistingPage(entry);
  if (dedupPageId) {
    try {
      const res = await notionRequest('PATCH', `/pages/${dedupPageId}`, { archived: false, properties: payload.properties });
      if (res?.object === 'error') {
        log({ op: 'notion_dedup_patch_error', entryKey: entry.entryKey, pageId: dedupPageId, error: res.message, code: res.code });
      } else {
        upsertEntry(state, entry.entryKey, {
          notion: { page_id: dedupPageId, last_synced_at: new Date().toISOString() }
        });
        log({ op: 'notion_dedup_patch', entryKey: entry.entryKey, pageId: dedupPageId });
        return { status: 'patched', pageId: dedupPageId };
      }
    } catch (e) {
      log({ op: 'notion_dedup_patch_error', entryKey: entry.entryKey, pageId: dedupPageId, error: e.message });
    }
  }

  try {
    const res = await notionRequest('POST', '/pages', payload);
    if (res?.object === 'error') {
      log({ op: 'notion_create_error', entryKey: entry.entryKey, error: res.message, code: res.code });
      return { status: 'error', error: res.message || 'notion_create_failed' };
    }

    const pageId = res?.id;
    if (!pageId) {
      log({ op: 'notion_create_error', entryKey: entry.entryKey, error: 'no_page_id_returned', resPreview: JSON.stringify(res).slice(0, 300) });
      return { status: 'error', error: 'no_page_id_returned' };
    }

    upsertEntry(state, entry.entryKey, {
      notion: { page_id: pageId, last_synced_at: new Date().toISOString() }
    });
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
  if (entry.category !== 'Food') return { status: 'skipped', reason: 'not_food' };
  const photo = entry.photoUrls?.[0];
  const proteinEst = getProteinEst(entry);
  if (!photo) return { status: 'skipped', reason: 'no_photo' };

  const displayTitle = (entry.mealType && !entry.title.startsWith(`${entry.mealType}:`))
    ? `${entry.mealType}: ${entry.title}`
    : entry.title;

  const match = galleryItems.find(i => i.photo === photo);
  if (match) {
    match.entry_key = entry.entryKey;
    match.title = displayTitle;
    match.type = entry.mealType || 'Food';
    match.date = entry.timestamp;
    match.carbs = entry.carbsEst;
    match.cals = entry.caloriesEst;
    match.protein = proteinEst;
    match.preMeal = entry.actual?.preMealBg || null;
    match.delta = entry.actual?.bgDelta || null;
    match.peak = entry.actual?.peakBg || null;

    upsertEntry(state, entry.entryKey, {
      gallery: { gallery_id: match.id, last_synced_at: new Date().toISOString() }
    });
    log({ op: 'gallery_link', entryKey: entry.entryKey, galleryId: match.id });
    return { status: 'linked', galleryId: match.id };
  }

  const newItem = {
    id: `manual-${entry.timestamp.replace(/:/g, '-')}`,
    entry_key: entry.entryKey,
    title: displayTitle,
    type: entry.mealType || 'Food',
    date: entry.timestamp,
    photo,
    carbs: entry.carbsEst,
    cals: entry.caloriesEst,
    protein: proteinEst,
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

// --- Utils ---
function getEntryKey(entry) {
  // Generate consistent entry key from timestamp + user + title
  const crypto = require('crypto');
  const base = `${entry.timestamp}|${entry.user}|${entry.title}`;
  return `sha256:${crypto.createHash('sha256').update(base).digest('hex')}`;
}

// --- Main ---
async function main(options = {}) {
  const dryRun = options.dryRun || false;
  if (!dryRun) acquireLock();
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const state = loadSyncState(SYNC_STATE_PATH);
  const galleryItems = fs.existsSync(GALLERY_PATH) ? JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8')) : [];

  const onlyNew = options.onlyNew || false;
  const since = options.since ? new Date(options.since) : null;

  const results = { nightscout: [], notion: [], gallery: [], blocked: [], errors: [] };

  // Build lookup map for existing entries by timestamp+title
  const existingByTsTitle = {};
  const duplicateTimeCheck = new Map();

  for (const [key, val] of Object.entries(state.entries)) {
    const lookupKey = `${val.timestamp}|${val.user}|${val.title}`;
    existingByTsTitle[lookupKey] = key;
  }

  for (const entry of normalized.entries) {
    if (since && new Date(entry.timestamp) < since) continue;
    
    // Strict Mode Check: Catch identical titles at the same timestamp (duplicate protection)
    const tsTitleKey = `${entry.timestamp}|${entry.user}|${entry.title}`;
    if (duplicateTimeCheck.has(tsTitleKey)) {
      console.error(`🛑 STRICT MODE ALERT: Exact duplicate detected!`);
      console.error(`   Time: ${entry.timestamp}`);
      console.error(`   Entry: ${entry.title}`);
      if (!options.force) {
         console.error(`   Use --force to override.`);
         process.exit(1);
      }
    }
    duplicateTimeCheck.set(tsTitleKey, true);

    // Use consistent entry key
    const entryKey = getEntryKey(entry);
    entry.entryKey = entryKey; // Update entry for downstream use
    
    // Check for existing entry by timestamp+title if entryKey doesn't match
    if (!state.entries[entryKey]) {
      const lookupKey = `${entry.timestamp}|${entry.user}|${entry.title}`;
      const existingKey = existingByTsTitle[lookupKey];
      if (existingKey) {
        // Migrate to new key format
        state.entries[entryKey] = state.entries[existingKey];
        delete state.entries[existingKey];
      }
    }
    
    const gate = validateEntry(entry);
    if (gate.errors.length > 0) {
      results.blocked.push({ entryKey: entry.entryKey, errors: gate.errors });
      log({ op: 'entry_blocked', entryKey: entry.entryKey, errors: gate.errors, title: entry.title });
      continue;
    }
    if (gate.warnings.length > 0) {
      log({ op: 'entry_warnings', entryKey: entry.entryKey, warnings: gate.warnings, title: entry.title });
    }

    if (onlyNew) {
      const s = getEntry(state, entryKey);
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
    blocked: results.blocked.length,
    errors: results.errors.length
  };

  if (results.blocked.length > 0 && !options.allowBlocked) {
    const blockedError = new Error(`blocked_entries:${results.blocked.length}`);
    blockedError.summary = summary;
    blockedError.blocked = results.blocked;
    log({ op: 'sync_blocked_entries', count: results.blocked.length });
    throw blockedError;
  }

  console.log(JSON.stringify(summary, null, 2));
  return { summary, results };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyNew = args.includes('--only-new');
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.split('=')[1] : null;
  const allowBlocked = args.includes('--allow-blocked');

  main({ dryRun, onlyNew, since, allowBlocked })
    .then(() => {
      if (!dryRun) releaseLock();
    })
    .catch(e => {
      console.error(e.message);
      if (!dryRun) releaseLock();
      process.exit(1);
    });
}

module.exports = { main, syncNightscout, syncNotion, syncGallery };
