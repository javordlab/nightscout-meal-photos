#!/usr/bin/env node
/**
 * rescue_pending_photos.js
 *
 * Cron rescue for food-log entries where the bridge agent's freeimage.host upload
 * failed and the workflow wrote `[photo: pending upload]` as a fallback placeholder
 * (see foodlog-cwd/CLAUDE.md ~line 220).
 *
 * For every pending line:
 *  1. Parse entry timestamp
 *  2. Match against /media/inbound/bridge-<ms>.jpg within ±2 min
 *  3. Upload matched file to freeimage.host
 *  4. Replace the placeholder on the SAME line with `[photo](<iili-url>)`
 *  5. Append to data/photo_upload_log.jsonl so publish_photos can migrate to GH pages later
 *
 * Skips entries older than 48h (orphaned if inbound cleanup already ran).
 * Gives up after 3 attempts per entry (tracked in data/pending_photo_attempts.json).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { writeReceipt } = require('./cron_receipt');

const WORKSPACE    = '/Users/javier/.openclaw/workspace';
const HEALTH_LOG   = path.join(WORKSPACE, 'health_log.md');
const INBOUND      = '/Users/javier/.openclaw/media/inbound';
const UPLOAD_LOG   = path.join(WORKSPACE, 'data', 'photo_upload_log.jsonl');
const ATTEMPTS_F   = path.join(WORKSPACE, 'data', 'pending_photo_attempts.json');
const LOCK_FILE    = path.join(WORKSPACE, 'data', '.rescue_pending_photos.lock');
const FREEIMAGE_KEY = '6d207e02198a847aa98d0a2a901485a5';
const MAX_ATTEMPTS = 3;
// Overridable for one-shot backlog rescues after an outage (the cron job was
// dead Apr 22 – Jun 10, 2026 and 4 entries aged past the 48h default).
const MAX_ENTRY_AGE_MS = (parseFloat(process.env.RESCUE_MAX_AGE_HOURS) || 48) * 3600 * 1000;
const MATCH_TOLERANCE_MS = 2 * 60 * 1000;

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function parseEntryTsMs(date, time, tz) {
  return new Date(`${date}T${time}:00${tz}`).getTime();
}

function findPendingLines(lines) {
  const pending = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('[photo: pending upload]')) continue;
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{2}:\d{2})\s+([+-]\d{2}:\d{2})/);
    if (!m) continue;
    pending.push({
      idx: i,
      tsMs: parseEntryTsMs(m[1], m[2], m[3]),
      key: `${m[1]}T${m[2]}${m[3]}`,
    });
  }
  return pending.sort((a, b) => a.tsMs - b.tsMs);
}

function candidateInboundFiles() {
  if (!fs.existsSync(INBOUND)) return [];
  return fs.readdirSync(INBOUND)
    .filter(f => /^bridge-\d+\.jpg$/i.test(f))
    .map(f => ({ name: f, tsMs: +f.match(/bridge-(\d+)\.jpg/i)[1] }));
}

function matchFile(entryTsMs, files, claimed) {
  let best = null;
  let bestDiff = Infinity;
  for (const f of files) {
    if (claimed.has(f.name)) continue;
    const diff = Math.abs(f.tsMs - entryTsMs);
    if (diff < bestDiff && diff <= MATCH_TOLERANCE_MS) {
      bestDiff = diff;
      best = f;
    }
  }
  return best;
}

function uploadToFreeimage(filePath) {
  try {
    const json = execSync(
      `/usr/bin/curl -s -X POST "https://freeimage.host/api/1/upload" ` +
      `-F "key=${FREEIMAGE_KEY}" -F "source=@${filePath}" --max-time 30`,
      { encoding: 'utf8', timeout: 45000 }
    );
    const o = JSON.parse(json);
    return (o && o.image && o.image.url) || null;
  } catch {
    return null;
  }
}

function loadAttempts() {
  if (!fs.existsSync(ATTEMPTS_F)) return {};
  try { return JSON.parse(fs.readFileSync(ATTEMPTS_F, 'utf8')); }
  catch { return {}; }
}
function saveAttempts(a) {
  fs.writeFileSync(ATTEMPTS_F, JSON.stringify(a, null, 2));
}

function main() {
  if (!acquireLock()) {
    writeReceipt({ status: 'noop', summary: 'prior rescue still running — skipped' });
    return;
  }
  try {
    const txt = fs.readFileSync(HEALTH_LOG, 'utf8');
    const lines = txt.split('\n');
    const pending = findPendingLines(lines);
    if (!pending.length) {
      writeReceipt({ status: 'noop', summary: 'no pending photos', metrics: { pending: 0 } });
      return;
    }

    const attempts = loadAttempts();
    const now = Date.now();
    const files = candidateInboundFiles();
    const claimed = new Set();
    let rescued = 0, failed = 0, skipped = 0, orphan = 0, tooOld = 0;

    for (const e of pending) {
      if (now - e.tsMs > MAX_ENTRY_AGE_MS) { tooOld++; continue; }

      const attempted = attempts[e.key] || 0;
      if (attempted >= MAX_ATTEMPTS) { skipped++; continue; }

      const file = matchFile(e.tsMs, files, claimed);
      if (!file) { orphan++; attempts[e.key] = attempted + 1; continue; }

      const fullPath = path.join(INBOUND, file.name);
      const url = uploadToFreeimage(fullPath);
      if (!url) { failed++; attempts[e.key] = attempted + 1; continue; }

      lines[e.idx] = lines[e.idx].replace(/\[photo: pending upload\]/, `[photo](${url})`);
      claimed.add(file.name);
      rescued++;

      fs.appendFileSync(UPLOAD_LOG, JSON.stringify({
        photoPath: fullPath,
        iiliUrl: url,
        uploadedAt: new Date().toISOString(),
        source: 'rescue_pending_photos',
      }) + '\n');

      delete attempts[e.key];
    }

    if (rescued > 0) fs.writeFileSync(HEALTH_LOG, lines.join('\n'));
    saveAttempts(attempts);

    let status;
    if (rescued > 0 && (failed + orphan) === 0) status = 'ok';
    else if (rescued > 0)                        status = 'partial';
    else if (failed > 0)                         status = 'error';
    else                                         status = 'noop';

    writeReceipt({
      status,
      summary: `pending=${pending.length} rescued=${rescued} failed=${failed} orphan=${orphan} skipped_maxattempts=${skipped} tooOld=${tooOld}`,
      metrics: { pending: pending.length, rescued, failed, orphan, skipped, tooOld },
    });
  } finally {
    releaseLock();
  }
}

try { main(); }
catch (e) { console.error('rescue_pending_photos fatal:', e.message); process.exit(1); }
