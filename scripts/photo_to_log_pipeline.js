#!/usr/bin/env node
/**
 * Photo-to-Log Pipeline
 * Watches /Users/javier/.openclaw/media/inbound/ for new photos
 * Processes them with OCR/nutrition extraction
 * Adds entries to health_log.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const INBOUND_DIR = '/Users/javier/.openclaw/media/inbound/';
const STATE_FILE = '/Users/javier/.openclaw/workspace/.photo_pipeline_state.json';
const HEALTH_LOG = '/Users/javier/.openclaw/workspace/health_log.md';
const PENDING_FILE = '/Users/javier/.openclaw/workspace/data/pending_photo_entries.json';
const TELEGRAM_ENVELOPES_PATH = '/Users/javier/.openclaw/workspace/data/telegram_media_envelopes.jsonl';
const PHOTO_LINK_METRICS_PATH = '/Users/javier/.openclaw/workspace/data/photo_link_metrics.json';
const PHOTO_LINK_METRICS_LOG_PATH = '/Users/javier/.openclaw/workspace/data/photo_link_metrics.log.jsonl';
const MAX_RETRIES = 3;
const NIGHTSCOUT_URL = process.env.NIGHTSCOUT_URL || 'https://p01--sefi--s66fclg7g2lm.code.run';
const NIGHTSCOUT_API_SECRET = process.env.NIGHTSCOUT_API_SECRET || 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

// Extract file number prefix (e.g., "file_154" from "file_154---uuid.jpg")
function getFilePrefix(filename) {
  const match = filename.match(/^(file_\d+)/);
  return match ? match[1] : filename;
}

// Extract suffix token after "---" (best-effort Telegram/media unique id bridge)
function getFileUniqueCandidate(filename) {
  const base = path.basename(String(filename || ''));
  const match = base.match(/^file_\d+---([^./]+)\.[a-z0-9]+$/i);
  return match ? String(match[1]).trim() : null;
}

// Find actual file on disk matching a file prefix
function findFileByPrefix(prefix) {
  const files = fs.readdirSync(INBOUND_DIR)
    .filter(f => f.match(/\.(jpg|jpeg|png)$/i));
  
  for (const f of files) {
    if (getFilePrefix(f) === prefix) {
      return f;
    }
  }
  return null;
}

// Load processed files state (now tracks by prefix, not full filename)
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Migrate old state if needed
    if (state.processed && state.processed.length > 0 && state.processed[0].includes('---')) {
      console.log('Migrating state to use file prefixes...');
      state.processed = [...new Set(state.processed.map(getFilePrefix))];
      state.failed = state.failed.map(f => ({ ...f, file: getFilePrefix(f.file) }));
    }
    if (!Array.isArray(state.linkedEnvelopeIds)) state.linkedEnvelopeIds = [];
    return state;
  }
  return { processed: [], failed: [], linkedEnvelopeIds: [], lastRun: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearFailure(state, prefix) {
  state.failed = (state.failed || []).filter(f => f.file !== prefix);
}

function loadTelegramEnvelopes() {
  if (!fs.existsSync(TELEGRAM_ENVELOPES_PATH)) return [];
  const lines = fs.readFileSync(TELEGRAM_ENVELOPES_PATH, 'utf8').split('\n').filter(Boolean);
  const items = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj || !obj.timestamp) continue;
      obj.tsMs = new Date(obj.timestamp).getTime();
      if (!Number.isFinite(obj.tsMs)) continue;
      items.push(obj);
    } catch {
      // ignore malformed lines
    }
  }
  return items.sort((a, b) => a.tsMs - b.tsMs);
}

function mapExtToEnvelopeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) return ['PHOTO', 'IMAGE_DOCUMENT'];
  if (['.ogg', '.mp3', '.m4a', '.wav'].includes(ext)) return ['VOICE'];
  if (['.mp4', '.mov', '.webm'].includes(ext)) return ['VIDEO'];
  return ['DOCUMENT_NON_IMAGE'];
}

function getEnvelopeKey(envelope) {
  return envelope?.envelopeId || `${envelope?.updateId}:${envelope?.messageId}`;
}

function markLinkedEnvelope(state, envelope) {
  if (!envelope) return;
  const key = getEnvelopeKey(envelope);
  if (!key) return;
  if (!state.linkedEnvelopeIds.includes(key)) state.linkedEnvelopeIds.push(key);
}

function findEnvelopeForFile(file, envelopes, state) {
  if (!Array.isArray(envelopes) || envelopes.length === 0) {
    return { envelope: null, strategy: 'none' };
  }

  const targetTypes = mapExtToEnvelopeType(file.path);
  const fileTs = file.mtime.getTime();
  const fileUniqueCandidate = String(file.fileUniqueCandidate || '').trim();

  const FOOD_LOG_CHAT_ID = -5262020908;
  const base = envelopes
    .filter(e => targetTypes.includes(e.contentType))
    .filter(e => e.chatId === FOOD_LOG_CHAT_ID) // Only process photos from the Food Log group
    .filter(e => !state.linkedEnvelopeIds.includes(getEnvelopeKey(e)));

  // P0 deterministic linking: file_unique_id first (single-source envelope stream)
  if (fileUniqueCandidate) {
    const exact = base.find(e => String(e.fileUniqueId || '').trim() === fileUniqueCandidate);
    if (exact) return { envelope: exact, strategy: 'file_unique_id' };
  }

  // Fallback: nearest timestamp with caption priority
  const candidates = base
    .map(e => ({
      ...e,
      diffMs: Math.abs(e.tsMs - fileTs),
      hasCaption: cleanText(e.captionOrText || '').length > 0
    }))
    .filter(e => e.diffMs <= 20 * 60 * 1000)
    .sort((a, b) => {
      if (a.hasCaption !== b.hasCaption) return a.hasCaption ? -1 : 1;
      return a.diffMs - b.diffMs;
    });

  if (candidates[0]) return { envelope: candidates[0], strategy: 'timestamp_fallback' };
  return { envelope: null, strategy: 'none' };
}

function fetchBgEntries(fromMs, toMs, count = 50) {
  try {
    const cmd = [
      'curl -sG',
      `"${NIGHTSCOUT_URL}/api/v1/entries.json"`,
      `-H "API-SECRET: ${NIGHTSCOUT_API_SECRET}"`,
      `--data-urlencode "find[date][$gte]=${fromMs}"`,
      `--data-urlencode "find[date][$lte]=${toMs}"`,
      `--data-urlencode "count=${count}"`
    ].join(' ');

    const result = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    const data = JSON.parse(result);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.log('BG fetch failed:', e.message);
    return [];
  }
}

// Get nearest BG around a timestamp (preferred), fallback to latest
async function getBGNearTimestamp(ts) {
  const targetMs = ts instanceof Date ? ts.getTime() : Date.now();
  const rows = fetchBgEntries(targetMs - 20 * 60 * 1000, targetMs + 20 * 60 * 1000, 200);
  if (rows.length > 0) {
    rows.sort((a, b) => Math.abs((a.date || 0) - targetMs) - Math.abs((b.date || 0) - targetMs));
    const best = rows[0];
    return { sgv: best.sgv, direction: best.direction || 'Flat' };
  }

  // fallback latest
  try {
    const result = execSync(
      `curl -s "${NIGHTSCOUT_URL}/api/v1/entries.json?count=1" -H "API-SECRET: ${NIGHTSCOUT_API_SECRET}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const data = JSON.parse(result);
    if (data && data[0]) {
      return { sgv: data[0].sgv, direction: data[0].direction || 'Flat' };
    }
  } catch (e) {
    console.log('BG fallback fetch failed:', e.message);
  }
  return null;
}

// Upload photo to get URL
async function uploadPhoto(photoPath) {
  const API_KEY = '6d207e02198a847aa98d0a2a901485a5';
  try {
    const result = execSync(
      `curl -s -X POST "https://freeimage.host/api/1/upload" -F "key=${API_KEY}" -F "source=@${photoPath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const data = JSON.parse(result);
    const url = data.image?.url || null;
    
    if (!url) {
      console.error(`Upload did not return URL. Response keys: ${Object.keys(data).join(', ')}`);
      console.error(`Full response (first 500 chars): ${JSON.stringify(data).substring(0, 500)}`);
    }
    
    return url;
  } catch (e) {
    console.error(`Upload failed for ${photoPath}: ${e.message}`);
    return null;
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseNutritionFromText(text) {
  const t = cleanText(text);
  const extract = (regex) => {
    const m = t.match(regex);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };

  return {
    carbs: extract(/carbs?\s*[:=~]?\s*(\d+(?:\.\d+)?)/i) || extract(/(\d+(?:\.\d+)?)\s*g\s*carbs?/i),
    cals: extract(/(?:cals?|calories|kcal)\s*[:=~]?\s*(\d+(?:\.\d+)?)/i) || extract(/(\d+(?:\.\d+)?)\s*kcal/i),
    protein: extract(/protein\s*[:=~]?\s*(\d+(?:\.\d+)?)/i) || extract(/(\d+(?:\.\d+)?)\s*g\s*protein/i)
  };
}

function estimateNutritionFromDescription(description, mealType) {
  const text = cleanText(description).toLowerCase();
  const defaults = {
    Breakfast: { carbs: 30, cals: 320, protein: 14 },
    Lunch: { carbs: 42, cals: 500, protein: 20 },
    Dinner: { carbs: 48, cals: 580, protein: 24 },
    Snack: { carbs: 15, cals: 180, protein: 6 },
    Dessert: { carbs: 24, cals: 240, protein: 3 }
  };

  const base = { ...(defaults[mealType] || defaults.Snack) };

  if (/apple|orange|grapes?|strawberr|dragon fruit|kiwi|guava/.test(text)) {
    base.carbs += 8;
    base.cals += 35;
  }
  if (/bread|toast|tortilla|bun|bao|rice|noodle|pasta|potato/.test(text)) {
    base.carbs += 12;
    base.cals += 90;
  }
  if (/cake|cookie|chocolate|dessert|sweet/.test(text)) {
    base.carbs += 16;
    base.cals += 120;
    base.protein = Math.max(2, base.protein - 2);
  }
  if (/egg|eggs|beef|pork|chicken|fish|salmon|tuna|prosciutto|pastrami|meat|tofu|lentil|beans/.test(text)) {
    base.protein += 8;
    base.cals += 60;
  }
  if (/cheese|milk|yogurt|nuts|peanut butter|avocado/.test(text)) {
    base.protein += 4;
    base.cals += 80;
  }

  base.carbs = Math.max(4, Math.min(95, Math.round(base.carbs)));
  base.cals = Math.max(60, Math.min(1200, Math.round(base.cals)));
  base.protein = Math.max(1, Math.min(65, Math.round(base.protein)));

  return base;
}

function estimatePrediction(carbs, timestamp) {
  const c = Number.isFinite(carbs) ? carbs : 25;
  const peak = Math.min(300, Math.max(120, Math.round(110 + c * 3.2)));
  const low = Math.max(95, peak - 10);
  const high = Math.min(320, peak + 10);

  const peakTime = new Date(timestamp.getTime() + 95 * 60 * 1000);
  const hours = peakTime.getHours();
  const mins = String(peakTime.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = ((hours + 11) % 12) + 1;

  return `Pred: ${low}-${high} mg/dL @ ${h12}:${mins} ${ampm}`;
}

function normalizeDescription(description, mealType) {
  const text = cleanText(description);
  if (!text) return 'Meal photo (auto-estimated nutrition)';
  const prefix = new RegExp(`^${mealType}:\\s*`, 'i');
  return cleanText(text.replace(prefix, ''));
}

// Analyze photo + caption text for immediate, best-effort nutrition
async function analyzePhoto(photoPath, matchedEnvelope = null) {
  const stats = fs.statSync(photoPath);
  const timestamp = stats.mtime;
  const hour = timestamp.getHours();

  let mealType = 'Snack';
  if (hour >= 6 && hour < 11) mealType = 'Breakfast';
  else if (hour >= 11 && hour < 15) mealType = 'Lunch';
  else if (hour >= 17 && hour < 21) mealType = 'Dinner';
  else if (hour >= 20) mealType = 'Dessert';

  let description = normalizeDescription(matchedEnvelope?.captionOrText || '', mealType);

  try {
    const logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
    // Duplicate-check must use host-local wall clock time (not UTC) to match health_log.md rows.
    const dtf = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = dtf.formatToParts(timestamp);
    const getPart = (type) => parts.find(p => p.type === type)?.value;
    const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const timeStr = `${getPart('hour')}:${getPart('minute')}`;
    const pattern = new RegExp(`\\| ${dateStr} \\| ${timeStr}[^|]*\\| Food \\| ${mealType} \\|[^\\n]*`);
    const match = logContent.match(pattern);
    if (match) {
      if (match[0].includes('📷')) {
        console.log(`Entry already exists with photo for ${dateStr} ${timeStr} ${mealType}, skipping`);
        return { skip: true };
      }
      // Entry exists but has no photo — upload and patch
      console.log(`Entry exists without photo for ${dateStr} ${timeStr} ${mealType}, will add photo`);
      return { skip: false, patchExisting: true, existingLine: match[0] };
    }
  } catch (e) {
    console.log('Could not check existing entries:', e.message);
  }

  const parsed = parseNutritionFromText(description);
  const estimated = estimateNutritionFromDescription(description, mealType);
  const carbs = parsed.carbs ?? estimated.carbs;
  const cals = parsed.cals ?? estimated.cals;
  const protein = parsed.protein ?? estimated.protein;

  return {
    timestamp,
    mealType,
    description,
    carbs,
    cals,
    protein,
    predText: estimatePrediction(carbs, timestamp),
    needsRefinement: !parsed.carbs || !parsed.cals || !parsed.protein
  };
}

// Add entry to health_log.md
function addToLog(entry) {
  // Use Intl.DateTimeFormat to get parts in the host's actual timezone (no hardcoded offset)
  const dtf = new Intl.DateTimeFormat('en-CA', { 
    year: 'numeric', month: '2-digit', day: '2-digit', 
    hour: '2-digit', minute: '2-digit', hour12: false 
  });
  const parts = dtf.formatToParts(entry.timestamp);
  const getPart = (type) => parts.find(p => p.type === type).value;
  
  const date = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  const time = `${getPart('hour')}:${getPart('minute')}`;

  // Get current timezone offset formatted as [+-]HH:mm (e.g., -07:00)
  const offsetTotalMins = -entry.timestamp.getTimezoneOffset();
  const offsetSign = offsetTotalMins >= 0 ? '+' : '-';
  const offsetHrs = String(Math.floor(Math.abs(offsetTotalMins) / 60)).padStart(2, '0');
  const offsetMins = String(Math.abs(offsetTotalMins) % 60).padStart(2, '0');
  const tzOffset = `${offsetSign}${offsetHrs}:${offsetMins}`;

  const macros = `(Protein: ${entry.protein}g | Carbs: ~${entry.carbs}g | Cals: ~${entry.cals})`;
  const logLine = `| ${date} | ${time} ${tzOffset} | Maria Dennis | Food | ${entry.mealType} | ${entry.mealType}: ${entry.description} (BG: ${entry.bg || 'Unknown'}) (${entry.predText}) ${macros} [📷](${entry.photoUrl}) | ${entry.carbs} | ${entry.cals} |`;

  let logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
  const lines = logContent.split('\n');
  lines.splice(2, 0, logLine);

  fs.writeFileSync(HEALTH_LOG, lines.join('\n'));
  console.log(`Added: ${entry.mealType} at ${time}`);
}

// Patch an existing health_log.md line to add a photo URL
function patchPhotoUrl(existingLine, photoUrl) {
  const logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
  // Insert [📷](url) before the last two pipe-separated fields (carbs | cals |)
  // The line ends with: ...) | carbs | cals |
  // We want: ...) [📷](url) | carbs | cals |
  const patched = existingLine.replace(/(\s*\|\s*\d+\s*\|\s*[\d.]+\s*\|)$/, ` [📷](${photoUrl})$1`);
  if (patched === existingLine) {
    // Fallback: append before trailing |
    const fallback = existingLine.replace(/\|([^|]*)$/, `[📷](${photoUrl}) |$1`);
    fs.writeFileSync(HEALTH_LOG, logContent.replace(existingLine, fallback));
    console.log(`Patched photo URL (fallback) into existing entry`);
    return;
  }
  fs.writeFileSync(HEALTH_LOG, logContent.replace(existingLine, patched));
  console.log(`Patched photo URL into existing entry`);
}

function detectMediaKind(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) return 'image';
  if (['.ogg', '.mp3', '.m4a', '.wav'].includes(ext)) return 'audio';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  return 'document';
}

function queuePendingPhoto(item) {
  const pending = fs.existsSync(PENDING_FILE)
    ? JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))
    : [];

  const idx = pending.findIndex(p => p.filePrefix === item.filePrefix || (item.messageId && p.messageId === item.messageId));
  const nowIso = new Date().toISOString();
  if (idx === -1) {
    pending.push({
      queuedAt: nowIso,
      attempts: 0,
      uploadStatus: item.photoUrl ? 'uploaded' : 'upload_failed_pending_retry',
      mediaKind: detectMediaKind(item.sourcePath),
      ...item
    });
  } else {
    const prev = pending[idx];
    pending[idx] = {
      ...prev,
      ...item,
      queuedAt: prev.queuedAt || nowIso,
      attempts: Number.isFinite(prev.attempts) ? prev.attempts : 0,
      uploadStatus: item.photoUrl ? 'uploaded' : (item.uploadStatus || prev.uploadStatus || 'upload_failed_pending_retry'),
      mediaKind: prev.mediaKind || detectMediaKind(item.sourcePath || prev.sourcePath),
      updatedAt: nowIso
    };
  }

  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2) + '\n');
}

function writeLinkMetrics(metrics) {
  const snapshot = {
    ts: new Date().toISOString(),
    ...metrics,
    fileUniqueRate: metrics.totalFiles > 0 ? Number((metrics.matchedByFileUniqueId / metrics.totalFiles).toFixed(3)) : 0,
    fallbackRate: metrics.totalFiles > 0 ? Number((metrics.matchedByTimestamp / metrics.totalFiles).toFixed(3)) : 0,
    unmatchedRate: metrics.totalFiles > 0 ? Number((metrics.unmatched / metrics.totalFiles).toFixed(3)) : 0
  };

  fs.writeFileSync(PHOTO_LINK_METRICS_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  fs.appendFileSync(PHOTO_LINK_METRICS_LOG_PATH, JSON.stringify(snapshot) + '\n');

  const fallbackHigh = snapshot.fallbackRate >= 0.2;
  const hasUnmatched = snapshot.unmatched > 0;
  if (fallbackHigh || hasUnmatched) {
    console.log(`⚠️ Link quality alert: file_unique_id=${snapshot.fileUniqueRate}, fallback=${snapshot.fallbackRate}, unmatched=${snapshot.unmatched}`);
  } else {
    console.log(`✅ Link quality: file_unique_id=${snapshot.fileUniqueRate}, fallback=${snapshot.fallbackRate}, unmatched=${snapshot.unmatched}`);
  }
}

// Main processing loop
async function main() {
  // Fast-exit: check for unprocessed files before any network calls
  const state = loadState();
  const allFiles = fs.readdirSync(INBOUND_DIR)
    .filter(f => f.match(/\.(jpg|jpeg|png)$/i));

  const prefixToFile = new Map();
  for (const f of allFiles) {
    const prefix = getFilePrefix(f);
    if (!prefixToFile.has(prefix)) prefixToFile.set(prefix, f);
  }

  const filesToProcess = [];
  for (const [prefix, filename] of prefixToFile) {
    const failEntry = state.failed.find(f => f.file === prefix);
    const retries = failEntry ? Number(failEntry.retries || 0) : 0;
    if (!state.processed.includes(prefix) && retries < MAX_RETRIES) {
      filesToProcess.push({
        name: filename,
        prefix: prefix,
        fileUniqueCandidate: getFileUniqueCandidate(filename),
        path: path.join(INBOUND_DIR, filename),
        mtime: fs.statSync(path.join(INBOUND_DIR, filename)).mtime
      });
    }
  }

  if (filesToProcess.length === 0) {
    console.log('No new photos to process');
    return;
  }

  console.log('Photo Pipeline Starting...', new Date().toISOString());
  console.log(`Found ${filesToProcess.length} unprocessed photos`);

  // Refresh Telegram envelopes now that we know there's work to do
  try {
    execSync('cd /Users/javier/.openclaw/workspace && node scripts/telegram_ingest_updates.js', {
      stdio: 'pipe',
      timeout: 30000
    });
    execSync('cd /Users/javier/.openclaw/workspace && node scripts/telegram_classify_updates.js', {
      stdio: 'pipe',
      timeout: 30000
    });
  } catch (e) {
    console.log('Telegram ingest/classifier refresh skipped:', e.message);
  }

  const envelopes = loadTelegramEnvelopes();

  // Sort by modification time (oldest first)
  filesToProcess.sort((a, b) => a.mtime - b.mtime);

  const linkMetrics = {
    totalFiles: filesToProcess.length,
    matchedByFileUniqueId: 0,
    matchedByTimestamp: 0,
    unmatched: 0,
    matchedWithCaption: 0
  };

  for (const file of filesToProcess) {
    console.log(`\nProcessing: ${file.name} (prefix: ${file.prefix})`);
    const envelopeMatch = findEnvelopeForFile(file, envelopes, state);
    const matchedEnvelope = envelopeMatch?.envelope || null;

    if (envelopeMatch?.strategy === 'file_unique_id') linkMetrics.matchedByFileUniqueId++;
    else if (envelopeMatch?.strategy === 'timestamp_fallback') linkMetrics.matchedByTimestamp++;
    else linkMetrics.unmatched++;
    if (matchedEnvelope && cleanText(matchedEnvelope.captionOrText || '')) linkMetrics.matchedWithCaption++;

    try {
      const matchedText = cleanText(matchedEnvelope?.captionOrText || '');
      if (!matchedText) {
        const failEntry = state.failed.find(f => f.file === file.prefix);
        if (failEntry) {
          failEntry.retries = (failEntry.retries || 0) + 1;
          failEntry.error = 'missing_caption_or_description_link';
        } else {
          state.failed.push({ file: file.prefix, retries: 1, error: 'missing_caption_or_description_link' });
        }

        const retries = (state.failed.find(f => f.file === file.prefix)?.retries) || 1;
        if (retries < MAX_RETRIES) {
          console.log(`Deferring ${file.prefix}: missing caption/description link (retry ${retries}/${MAX_RETRIES})`);
          continue;
        }

        // No envelope from the Food Log group found after all retries — photo came from a DM or
        // unknown source. Skip permanently to avoid logging non-meal photos.
        console.log(`Skipping ${file.prefix} permanently: no Food Log group envelope found after ${MAX_RETRIES} retries. Photo likely from a DM — not a meal entry.`);
        state.processed.push(file.prefix);
        clearFailure(state, file.prefix);
        continue;
      }

      // Analyze photo + caption metadata
      const analysis = await analyzePhoto(file.path, matchedEnvelope);

      // Skip if entry already exists
      if (analysis.skip) {
        markLinkedEnvelope(state, matchedEnvelope);
        clearFailure(state, file.prefix);
        state.processed.push(file.prefix);
        console.log(`Skipping ${file.name} - entry already exists`);
        continue;
      }

      // Upload to get URL (or queue for retry on failure)
      let photoUrl = await uploadPhoto(file.path);
      if (!photoUrl) {
        queuePendingPhoto({
          filePrefix: file.prefix,
          sourcePath: file.path,
          timestamp: analysis.timestamp.toISOString(),
          mealType: analysis.mealType,
          photoUrl: null,
          uploadStatus: 'upload_failed_pending_retry',
          reason: 'upload_failed_retry_pending',
          lastError: 'photo_upload_failed',
          nextAttemptAt: new Date(Date.now() + 60 * 1000).toISOString(),
          messageId: matchedEnvelope?.messageId || null,
          updateId: matchedEnvelope?.updateId || null,
          contentType: matchedEnvelope?.contentType || null,
          mediaKind: matchedEnvelope?.mediaKind || detectMediaKind(file.path),
          fileId: matchedEnvelope?.fileId || null,
          fileUniqueId: matchedEnvelope?.fileUniqueId || null
        });
        console.log(`Queued upload retry for ${file.prefix} (upload failed).`);
        markLinkedEnvelope(state, matchedEnvelope);
        clearFailure(state, file.prefix);
        state.processed.push(file.prefix);
        continue;
      }
      
      // URL-based duplicate check: if this photo URL already exists in the log,
      // the agent already logged this photo (possibly under a different time or mealType).
      const existingLogContent = fs.readFileSync(HEALTH_LOG, 'utf8');
      if (existingLogContent.includes(photoUrl)) {
        console.log(`Photo URL already in log (${photoUrl}), skipping duplicate`);
        markLinkedEnvelope(state, matchedEnvelope);
        clearFailure(state, file.prefix);
        state.processed.push(file.prefix);
        continue;
      }

      // Patch existing entry that was logged without a photo
      if (analysis.patchExisting) {
        patchPhotoUrl(analysis.existingLine, photoUrl);
        markLinkedEnvelope(state, matchedEnvelope);
        clearFailure(state, file.prefix);
        state.processed.push(file.prefix);
        console.log(`Patched photo into existing entry for ${file.name}`);
        continue;
      }

      // SAFETY CHECK: Never add entry without a real URL
      if (!photoUrl || !photoUrl.startsWith('http')) {
        console.error(`SAFETY BLOCK: Cannot add entry without valid URL. Got: "${photoUrl}"`);
        console.error(`  This would create a broken entry with file ref instead of real URL.`);
        console.error(`  Queueing for retry instead.`);
        
        queuePendingPhoto({
          filePrefix: file.prefix,
          sourcePath: file.path,
          timestamp: analysis.timestamp.toISOString(),
          mealType: analysis.mealType,
          photoUrl: null,
          uploadStatus: 'upload_failed_pending_retry',
          reason: 'safety_block_no_valid_url',
          lastError: 'upload_returned_invalid_url',
          nextAttemptAt: new Date(Date.now() + 60 * 1000).toISOString(),
          messageId: matchedEnvelope?.messageId || null,
          updateId: matchedEnvelope?.updateId || null
        });
        
        markLinkedEnvelope(state, matchedEnvelope);
        clearFailure(state, file.prefix);
        state.processed.push(file.prefix);
        continue;
      }

      const bgAtMeal = await getBGNearTimestamp(analysis.timestamp);

      // Create entry with immediate nutrition estimates (no manual gate)
      const entry = {
        timestamp: analysis.timestamp,
        mealType: analysis.mealType,
        description: analysis.description,
        photoUrl: photoUrl,
        bg: bgAtMeal ? `${bgAtMeal.sgv} mg/dL ${bgAtMeal.direction || 'Flat'}` : 'Unknown',
        carbs: analysis.carbs,
        cals: analysis.cals,
        protein: analysis.protein,
        predText: analysis.predText
      };

      // Add to log immediately (with URL verified above)
      addToLog(entry);

      // If any nutrition field was inferred (not explicitly parsed), queue for asynchronous refinement.
      if (analysis.needsRefinement) {
        queuePendingPhoto({
          filePrefix: file.prefix,
          sourcePath: file.path,
          timestamp: analysis.timestamp.toISOString(),
          mealType: analysis.mealType,
          photoUrl,
          uploadStatus: 'uploaded',
          reason: 'nutrition_inferred_needs_refinement',
          messageId: matchedEnvelope?.messageId || null,
          updateId: matchedEnvelope?.updateId || null,
          contentType: matchedEnvelope?.contentType || null,
          mediaKind: matchedEnvelope?.mediaKind || detectMediaKind(file.path),
          fileId: matchedEnvelope?.fileId || null,
          fileUniqueId: matchedEnvelope?.fileUniqueId || null
        });
        console.log(`Queued nutrition refinement for ${file.prefix} (auto-inferred macros).`);
      }
      
      // Mark as processed (by prefix)
      markLinkedEnvelope(state, matchedEnvelope);
      clearFailure(state, file.prefix);
      state.processed.push(file.prefix);
      
    } catch (e) {
      console.error(`Failed to process ${file.name}:`, e.message);
      
      // Track failures (by prefix)
      const failEntry = state.failed.find(f => f.file === file.prefix);
      if (failEntry) {
        failEntry.retries++;
        if (failEntry.retries >= MAX_RETRIES) {
          console.log(`Giving up on ${file.prefix} after ${MAX_RETRIES} retries`);
        }
      } else {
        state.failed.push({ file: file.prefix, retries: 1, error: e.message });
      }
    }
  }
  
  writeLinkMetrics(linkMetrics);

  state.lastRun = new Date().toISOString();
  saveState(state);

  const newlyProcessed = linkMetrics.totalFiles - linkMetrics.unmatched;
  console.log('\nPipeline Complete');
  console.log(`Processed: ${state.processed.length} total`);
  console.log(`Failed: ${state.failed.length} total`);

  // Only trigger sync if entries were actually written; radial_dispatcher cron handles routine sync
  if (newlyProcessed > 0) {
    console.log('\nTriggering post-log sync...');
    try {
      execSync('cd /Users/javier/.openclaw/workspace && node scripts/health-sync/trigger_post_log_sync.js --source=photo_pipeline', {
        stdio: 'inherit',
        timeout: 60000
      });
    } catch (e) {
      console.error('Post-log sync trigger failed:', e.message);
    }
  }
}

main().catch(console.error);
