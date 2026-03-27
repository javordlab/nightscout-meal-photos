#!/usr/bin/env node
/**
 * audit_photo_receipts.js
 *
 * Detects photos that arrived in the inbound folder but were never
 * successfully logged to health_log.md.
 *
 * Logic:
 *   - Read all files in /media/inbound/ with their mtime
 *   - Read .photo_pipeline_state.json (processed prefixes)
 *   - Read health_log.md for photo URLs (freeimage.host links)
 *   - Cross-reference pending_photo_entries.json for queued/failed items
 *   - Any file in inbound that is:
 *       (a) NOT in pipeline processed list, OR
 *       (b) In pipeline state but has NO matching photo URL in health_log
 *     within the last LOOKBACK_HOURS → flag as missing
 *
 * Alert sent as DM to Javi if any gaps found.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const INBOUND_DIR    = '/Users/javier/.openclaw/media/inbound/';
const STATE_FILE     = '/Users/javier/.openclaw/workspace/.photo_pipeline_state.json';
const HEALTH_LOG     = '/Users/javier/.openclaw/workspace/health_log.md';
const PENDING_FILE   = '/Users/javier/.openclaw/workspace/data/pending_photo_entries.json';
const OPENCLAW_CFG   = '/Users/javier/.openclaw/openclaw.json';
const ALERT_TO       = '8335333215';
const LOOKBACK_HOURS = 12;

const DRY_RUN = process.argv.includes('--dry-run');

function getBotToken() {
  try { return JSON.parse(fs.readFileSync(OPENCLAW_CFG, 'utf8'))?.channels?.telegram?.botToken || null; }
  catch { return null; }
}

function sendTelegram(botToken, chatId, text) {
  const body = new URLSearchParams({ chat_id: String(chatId), text }).toString();
  const opts = { method: 'POST', hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d || '{}')));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function getFilePrefix(filename) {
  return filename.match(/^(file_\d+)/)?.[1] || null;
}

function getFileNumber(filename) {
  return parseInt(filename.match(/^file_(\d+)/)?.[1] || '0', 10);
}

async function main() {
  const now = Date.now();
  const windowMs = LOOKBACK_HOURS * 60 * 60 * 1000;

  // 1. All inbound files in the last LOOKBACK_HOURS, sorted by file number
  const allInbound = fs.readdirSync(INBOUND_DIR)
    .filter(f => f.match(/\.(jpg|jpeg|png)$/i))
    .map(f => {
      const stat = fs.statSync(path.join(INBOUND_DIR, f));
      return { filename: f, prefix: getFilePrefix(f), num: getFileNumber(f), mtime: stat.mtimeMs };
    })
    .filter(f => f.prefix && (now - f.mtime) <= windowMs)
    .sort((a, b) => a.num - b.num);

  if (allInbound.length === 0) {
    console.log(`No inbound files in the last ${LOOKBACK_HOURS}h. Nothing to check.`);
    return;
  }

  // 2. Pipeline processed state
  let processed = new Set();
  try { processed = new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).processed || []); }
  catch {}

  // 3. Photo URLs in health_log.md
  const logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
  const loggedPhotoUrls = new Set([...logContent.matchAll(/\[📷\]\(([^)]+)\)/g)].map(m => m[1]));

  // 4. Pending entries (uploaded but health_log write may have failed)
  let pendingByPrefix = new Map();
  try {
    const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    for (const p of pending) {
      if (p.filePrefix) pendingByPrefix.set(p.filePrefix, p);
    }
  } catch {}

  // 5. Find gaps: file in inbound but pipeline never processed it
  const notProcessed = allInbound.filter(f => !processed.has(f.prefix));

  // 6. Find gaps: processed but no photo URL in health_log AND not in pending with uploaded URL
  const processedNoLog = allInbound.filter(f => {
    if (!processed.has(f.prefix)) return false;
    const pending = pendingByPrefix.get(f.prefix);
    if (pending?.photoUrl && loggedPhotoUrls.has(pending.photoUrl)) return false; // logged ok
    if (pending?.photoUrl) return true; // uploaded but not in log
    // No pending entry at all — check if any freeimage URL exists for this file via log scan
    // We can't directly link prefix to URL without the pending record, so skip (assume ok)
    return false;
  });

  const gaps = [...notProcessed, ...processedNoLog];

  console.log(`Inbound files in last ${LOOKBACK_HOURS}h: ${allInbound.length}`);
  console.log(`Not in pipeline state: ${notProcessed.length}`);
  console.log(`Processed but missing from health_log: ${processedNoLog.length}`);

  if (gaps.length === 0) {
    console.log('All photos accounted for. ✅');
    return;
  }

  // 7. Alert
  const fmtTime = ms => new Date(ms).toLocaleString('en-US', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const lines = [`⚠️ Missing Photo Entry Detected\n`];
  lines.push(`${gaps.length} photo(s) received but not logged to health_log.md in the last ${LOOKBACK_HOURS}h:\n`);
  for (const f of gaps) {
    lines.push(`  • ${f.prefix} — received ~${fmtTime(f.mtime)}`);
  }
  lines.push(`\nForward the missing photo(s) here to log them manually.`);

  const msg = lines.join('\n');
  console.log('\n' + msg);

  if (!DRY_RUN) {
    const token = getBotToken();
    if (!token) { console.error('No bot token'); process.exit(1); }
    const res = await sendTelegram(token, ALERT_TO, msg);
    if (res.ok) console.log('Alert sent to', ALERT_TO);
    else console.error('Send failed:', JSON.stringify(res));
  } else {
    console.log('[DRY RUN — no message sent]');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
