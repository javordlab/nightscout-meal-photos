#!/usr/bin/env node
/**
 * check_pending_photos.js
 * Checks pending_photo_entries.json for entries older than 30 minutes.
 * If found, sends a Telegram DM to Javi (8335333215) only — not the food group.
 */

const fs = require('fs');
const https = require('https');

const PENDING_FILE = '/Users/javier/.openclaw/workspace/data/pending_photo_entries.json';
const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';
const JAVI_CHAT_ID = '8335333215';
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function sendTelegram(chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: chatId, text });
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(PENDING_FILE)) {
    console.log('No pending_photo_entries.json found — nothing to check.');
    return;
  }

  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  if (!Array.isArray(pending) || pending.length === 0) {
    console.log('Pending queue is empty.');
    return;
  }

  const now = Date.now();
  const stale = pending.filter(entry => {
    const age = now - new Date(entry.queuedAt).getTime();
    return age >= STALE_THRESHOLD_MS;
  });

  if (stale.length === 0) {
    console.log(`${pending.length} pending photo(s) — none stale yet.`);
    return;
  }

  const lines = stale.map(entry => {
    const ageMin = Math.floor((now - new Date(entry.queuedAt).getTime()) / 60000);
    return `• ${entry.mealType || 'unknown meal'} (${entry.filePrefix}) — queued ${ageMin}m ago`;
  });

  const message =
    `⏳ ${stale.length} photo${stale.length > 1 ? 's' : ''} still pending manual entry:\n\n` +
    lines.join('\n') +
    `\n\nPlease log nutrition details so the health log stays up to date.`;

  console.log(`Sending stale photo alert to Javi for ${stale.length} entry/entries...`);
  const result = await sendTelegram(JAVI_CHAT_ID, message);

  if (result.ok) {
    console.log('Alert sent successfully.');
  } else {
    console.error('Telegram error:', JSON.stringify(result));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('check_pending_photos failed:', err.message);
  process.exit(1);
});
