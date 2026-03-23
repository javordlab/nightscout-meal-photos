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
const MAX_RETRIES = 3;

// Extract file number prefix (e.g., "file_154" from "file_154---uuid.jpg")
function getFilePrefix(filename) {
  const match = filename.match(/^(file_\d+)/);
  return match ? match[1] : filename;
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
  if (!Array.isArray(envelopes) || envelopes.length === 0) return null;
  const targetTypes = mapExtToEnvelopeType(file.path);
  const fileTs = file.mtime.getTime();

  const candidates = envelopes
    .filter(e => targetTypes.includes(e.contentType))
    .filter(e => !state.linkedEnvelopeIds.includes(getEnvelopeKey(e)))
    .map(e => ({ ...e, diffMs: Math.abs(e.tsMs - fileTs) }))
    .filter(e => e.diffMs <= 3 * 60 * 1000)
    .sort((a, b) => a.diffMs - b.diffMs);

  return candidates[0] || null;
}

// Get current BG from Nightscout
async function getCurrentBG() {
  try {
    const result = execSync(
      'curl -s "https://p01--sefi--s66fclg7g2lm.code.run/api/v1/entries.json?count=1" -H "API-SECRET: JaviCare2026"',
      { encoding: 'utf8', timeout: 10000 }
    );
    const data = JSON.parse(result);
    if (data && data[0]) {
      return { sgv: data[0].sgv, direction: data[0].direction };
    }
  } catch (e) {
    console.log('BG fetch failed:', e.message);
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
    return data.image?.url || null;
  } catch (e) {
    console.error('Upload failed:', e.message);
    return null;
  }
}

// Analyze photo with vision model
async function analyzePhoto(photoPath) {
  // Use actual file modification time as timestamp
  const stats = fs.statSync(photoPath);
  const timestamp = stats.mtime;
  const hour = timestamp.getHours();
  
  // Determine meal type based on time
  let mealType = 'Snack';
  if (hour >= 6 && hour < 11) mealType = 'Breakfast';
  else if (hour >= 11 && hour < 15) mealType = 'Lunch';
  else if (hour >= 17 && hour < 21) mealType = 'Dinner';
  else if (hour >= 14 && hour < 17) mealType = 'Snack';
  else if (hour >= 20) mealType = 'Dessert';
  
  // Try to analyze with image tool if available
  let description = '[Photo received - awaiting manual description]';
  let analysis = null;
  
  try {
    // Check if this photo is already in a manual log entry
    const logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
    const fileName = path.basename(photoPath);
    const prefix = getFilePrefix(fileName);
    
    // If entry with this timestamp already exists with proper description, skip
    const dateStr = timestamp.toISOString().split('T')[0];
    const timeStr = timestamp.toISOString().split('T')[1].slice(0, 5);
    const pattern = new RegExp(`\\| ${dateStr} \\| ${timeStr}.*${mealType}.*(?!\\[Photo - needs description\\])`);
    
    if (pattern.test(logContent)) {
      console.log(`Entry already exists for ${dateStr} ${timeStr} ${mealType}, skipping`);
      return { skip: true };
    }
  } catch (e) {
    console.log('Could not check existing entries:', e.message);
  }
  
  return {
    timestamp: timestamp,
    mealType: mealType,
    description: description,
    needsManualEntry: true
  };
}

// Add entry to health_log.md
function addToLog(entry) {
  const date = entry.timestamp.toISOString().split('T')[0];
  const time = entry.timestamp.toISOString().split('T')[1].slice(0, 5);
  const tzOffset = entry.timestamp.getTimezoneOffset() === 480 ? '-08:00' : '-07:00'; // PDT/PST
  
  const logLine = `| ${date} | ${time} ${tzOffset} | Maria Dennis | Food | ${entry.mealType} | ${entry.mealType}: ${entry.description} (BG: ${entry.bg || 'Unknown'}) (Pred: TBD) [📷](${entry.photoUrl}) | ${entry.carbs || 'null'} | ${entry.cals || 'null'} |`;
  
  // Read current log
  let logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
  
  // Insert after header (first 2 lines)
  const lines = logContent.split('\n');
  lines.splice(2, 0, logLine);
  
  fs.writeFileSync(HEALTH_LOG, lines.join('\n'));
  console.log(`Added: ${entry.mealType} at ${time}`);
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

// Main processing loop
async function main() {
  console.log('Photo Pipeline Starting...', new Date().toISOString());

  // Refresh Telegram message type envelopes (best effort)
  try {
    execSync('cd /Users/javier/.openclaw/workspace && node scripts/telegram_classify_updates.js', {
      stdio: 'pipe',
      timeout: 30000
    });
  } catch (e) {
    console.log('Telegram classifier refresh skipped:', e.message);
  }

  const state = loadState();
  const envelopes = loadTelegramEnvelopes();
  const allFiles = fs.readdirSync(INBOUND_DIR)
    .filter(f => f.match(/\.(jpg|jpeg|png)$/i));
  
  // Build map of prefixes to actual files
  const prefixToFile = new Map();
  for (const f of allFiles) {
    const prefix = getFilePrefix(f);
    if (!prefixToFile.has(prefix)) {
      prefixToFile.set(prefix, f);
    }
  }
  
  // Filter out already processed (by prefix)
  const filesToProcess = [];
  for (const [prefix, filename] of prefixToFile) {
    if (!state.processed.includes(prefix) && !state.failed.find(f => f.file === prefix)) {
      filesToProcess.push({
        name: filename,
        prefix: prefix,
        path: path.join(INBOUND_DIR, filename),
        mtime: fs.statSync(path.join(INBOUND_DIR, filename)).mtime
      });
    }
  }
  
  // Sort by modification time (oldest first)
  filesToProcess.sort((a, b) => a.mtime - b.mtime);
  
  if (filesToProcess.length === 0) {
    console.log('No new photos to process');
    return;
  }
  
  console.log(`Found ${filesToProcess.length} unprocessed photos`);
  
  // Get current BG once for all entries
  const bg = await getCurrentBG();
  
  for (const file of filesToProcess) {
    console.log(`\nProcessing: ${file.name} (prefix: ${file.prefix})`);
    const matchedEnvelope = findEnvelopeForFile(file, envelopes, state);

    try {
      // Analyze photo
      const analysis = await analyzePhoto(file.path);

      // Skip if entry already exists
      if (analysis.skip) {
        markLinkedEnvelope(state, matchedEnvelope);
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
        state.processed.push(file.prefix);
        continue;
      }
      
      // Create entry
      const entry = {
        timestamp: analysis.timestamp,
        mealType: analysis.mealType,
        description: analysis.description,
        photoUrl: photoUrl,
        bg: bg ? `${bg.sgv} mg/dL ${bg.direction}` : 'Unknown',
        carbs: null, // Will need manual backfill
        cals: null
      };

      if (analysis.needsManualEntry) {
        queuePendingPhoto({
          filePrefix: file.prefix,
          sourcePath: file.path,
          timestamp: analysis.timestamp.toISOString(),
          mealType: analysis.mealType,
          photoUrl,
          uploadStatus: 'uploaded',
          reason: 'nutrition_metadata_required_before_log',
          messageId: matchedEnvelope?.messageId || null,
          updateId: matchedEnvelope?.updateId || null,
          contentType: matchedEnvelope?.contentType || null,
          mediaKind: matchedEnvelope?.mediaKind || detectMediaKind(file.path),
          fileId: matchedEnvelope?.fileId || null,
          fileUniqueId: matchedEnvelope?.fileUniqueId || null
        });
        console.log(`Queued pending nutrition metadata for ${file.prefix}; skipped placeholder log creation.`);
        markLinkedEnvelope(state, matchedEnvelope);
        state.processed.push(file.prefix);
        continue;
      }
      
      // Add to log
      addToLog(entry);
      
      // Mark as processed (by prefix)
      markLinkedEnvelope(state, matchedEnvelope);
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
  
  state.lastRun = new Date().toISOString();
  saveState(state);
  
  console.log('\nPipeline Complete');
  console.log(`Processed: ${state.processed.length} total`);
  console.log(`Failed: ${state.failed.length} total`);
  
  // Run sync after adding entries
  console.log('\nTriggering unified sync...');
  try {
    execSync('cd /Users/javier/.openclaw/workspace && node scripts/health-sync/unified_sync.js --since=$(date -v-2d +%Y-%m-%d)', {
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (e) {
    console.error('Unified sync failed, falling back to radial dispatcher:', e.message);
    try {
      execSync('cd /Users/javier/.openclaw/workspace && node scripts/radial_dispatcher.js', {
        stdio: 'inherit',
        timeout: 120000
      });
    } catch (fallbackErr) {
      console.error('Fallback sync failed:', fallbackErr.message);
    }
  }
}

main().catch(console.error);
