#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const PENDING_PATH = path.join(WORKSPACE, 'data', 'pending_photo_entries.json');
const API_KEY = '6d207e02198a847aa98d0a2a901485a5';
const MAX_ATTEMPTS = 8;
const BACKOFF_MINUTES = [1, 5, 15, 60, 120, 240, 480, 720];

function loadPending() {
  if (!fs.existsSync(PENDING_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function savePending(pending) {
  fs.writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2) + '\n');
}

function nextAttemptIso(attempts) {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1);
  return new Date(Date.now() + BACKOFF_MINUTES[idx] * 60 * 1000).toISOString();
}

function uploadPhoto(photoPath) {
  try {
    const result = execSync(
      `curl -s -X POST "https://freeimage.host/api/1/upload" -F "key=${API_KEY}" -F "source=@${photoPath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const data = JSON.parse(result);
    return data.image?.url || null;
  } catch {
    return null;
  }
}

function computeSinceIso(timestamps) {
  const valid = timestamps
    .map(ts => new Date(ts).getTime())
    .filter(ms => Number.isFinite(ms));
  if (valid.length === 0) return null;
  const minMs = Math.min(...valid);
  return new Date(minMs - 2 * 60 * 60 * 1000).toISOString();
}

function triggerIncrementalSync(sinceIso) {
  const sinceArg = sinceIso ? ` --since=${sinceIso}` : '';
  execSync(`cd ${WORKSPACE} && node scripts/health-sync/normalize_health_log.js`, {
    stdio: 'inherit',
    timeout: 120000
  });
  execSync(`cd ${WORKSPACE} && node scripts/health-sync/unified_sync.js${sinceArg}`, {
    stdio: 'inherit',
    timeout: 180000
  });
}

async function main() {
  const pending = loadPending();
  if (pending.length === 0) {
    console.log(JSON.stringify({ retried: 0, uploaded: 0, unresolved: 0, skipped: 'no_pending_entries' }, null, 2));
    return;
  }

  const now = Date.now();
  let retried = 0;
  let uploaded = 0;
  const uploadedTimestamps = [];

  for (const item of pending) {
    const hasUrl = /^https?:\/\//i.test(String(item.photoUrl || ''));
    if (hasUrl) continue;

    const attempts = Number.isFinite(item.attempts) ? item.attempts : 0;
    if (attempts >= MAX_ATTEMPTS) continue;

    const dueAt = item.nextAttemptAt ? new Date(item.nextAttemptAt).getTime() : 0;
    if (Number.isFinite(dueAt) && dueAt > now) continue;

    if (!item.sourcePath || !fs.existsSync(item.sourcePath)) {
      item.attempts = attempts + 1;
      item.lastError = 'source_file_missing';
      item.uploadStatus = 'upload_failed_pending_retry';
      item.nextAttemptAt = nextAttemptIso(item.attempts);
      continue;
    }

    retried++;
    const url = uploadPhoto(item.sourcePath);
    item.attempts = attempts + 1;
    item.updatedAt = new Date().toISOString();

    if (url) {
      item.photoUrl = url;
      item.uploadStatus = 'uploaded';
      item.uploadedAt = new Date().toISOString();
      item.lastError = null;
      item.nextAttemptAt = null;
      uploaded++;
      uploadedTimestamps.push(item.timestamp || item.updatedAt || new Date().toISOString());
      continue;
    }

    item.uploadStatus = 'upload_failed_pending_retry';
    item.lastError = 'photo_upload_failed';
    item.nextAttemptAt = nextAttemptIso(item.attempts);
  }

  savePending(pending);

  if (uploaded > 0) {
    try {
      const { main: resolveLinks } = require('./resolve_pending_photo_links');
      await resolveLinks();
    } catch (e) {
      console.error(`resolve_pending_photo_links_failed:${e.message}`);
    }

    try {
      const sinceIso = computeSinceIso(uploadedTimestamps);
      triggerIncrementalSync(sinceIso);
    } catch (e) {
      console.error(`incremental_sync_after_upload_failed:${e.message}`);
    }
  }

  const unresolved = pending.filter(item => !/^https?:\/\//i.test(String(item.photoUrl || ''))).length;
  const result = { retried, uploaded, unresolved };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
