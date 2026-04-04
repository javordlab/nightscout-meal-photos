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
const LOOKBACK_HOURS = 12;
const DRY_RUN = process.argv.includes('--dry-run');

const { sendAlert } = require('./telegram_alert');

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

  // 5. Find gaps: file in inbound with no photo URL in health_log within ±30 min of file timestamp.
  //    NOTE: pipeline_state.json is no longer updated (HealthGuard handles uploads directly).
  //    The only reliable source of truth is health_log.md itself.
  const LOG_LINES = logContent.split('\n');
  function hasPhotoNearTimestamp(fileTimestampMs) {
    const windowMs = 30 * 60 * 1000; // ±30 min
    for (const line of LOG_LINES) {
      if (!line.includes('📷')) continue;
      // Extract date+time from log line: | 2026-04-03 | 13:10 -07:00 |
      const m = line.match(/\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d{2}:\d{2}[^|]*)\|/);
      if (!m) continue;
      try {
        // Format: '13:10 -07:00' → '13:10:00-07:00'
        const timePart = m[2].trim().replace(/(\d{2}:\d{2}) (-\d{2}:\d{2})/, '$1:00$2');
        const logMs = new Date(`${m[1]}T${timePart}`).getTime();
        if (!isNaN(logMs) && Math.abs(logMs - fileTimestampMs) <= windowMs) return true;
      } catch {}
    }
    return false;
  }

  const gaps = allInbound.filter(f => !hasPhotoNearTimestamp(f.mtime));

  console.log(`Inbound files in last ${LOOKBACK_HOURS}h: ${allInbound.length}`);
  console.log(`Missing photo URL in health_log (±30min): ${gaps.length}`);

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
    const res = await sendAlert(msg);
    if (res.ok) console.log('Alert sent to Javi');
    else console.error('Send failed:', JSON.stringify(res));
  } else {
    console.log('[DRY RUN — no message sent]');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
