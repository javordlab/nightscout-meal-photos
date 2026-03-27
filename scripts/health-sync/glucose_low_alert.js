#!/usr/bin/env node
/**
 * glucose_low_alert.js
 *
 * Checks latest Nightscout glucose. If BG <= 90 AND trending down,
 * sends ONE alert to the food log Telegram group (-5262020908).
 *
 * Uses a state file to ensure only 1 notification per low episode.
 * Resets when BG rises back above 100 (recovery threshold).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const NS_URL    = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const ALERT_THRESHOLD   = 90;   // mg/dL — alert when at or below this
const RECOVERY_THRESHOLD = 100; // mg/dL — reset alert state when above this
const STATE_PATH = path.join(__dirname, '../../data/glucose_low_alert_state.json');

// Nightscout trend directions considered "down"
const DOWN_TRENDS = new Set([
  'SingleDown',
  'FortyFiveDown',
  'DoubleDown'
]);

const TREND_ARROWS = {
  DoubleDown:   '⬇️⬇️',
  SingleDown:   '⬇️',
  FortyFiveDown:'↘️',
  Flat:         '➡️',
  FortyFiveUp:  '↗️',
  SingleUp:     '⬆️',
  DoubleUp:     '⬆️⬆️',
  'NOT COMPUTABLE': '?'
};

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { alertSent: false, alertSentAt: null, lastBg: null }; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function nsGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(NS_URL + urlPath);
    https.get({ hostname: url.hostname, path: url.pathname + url.search,
      headers: { 'api-secret': NS_SECRET } }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sendTelegramMessage(botToken, chatId, text) {
  const postData = new URLSearchParams({ chat_id: String(chatId), text }).toString();
  const opts = {
    method: 'POST',
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData) }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getBotToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/openclaw.json', 'utf8'));
    return cfg?.channels?.telegram?.botToken || null;
  } catch { return null; }
}

async function main() {
  // Only alert between 8:30 AM and midnight PT
  const nowLA = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false });
  const [h, m] = nowLA.split(':').map(Number);
  const minutesNow = h * 60 + m;
  const start = 8 * 60 + 30;  // 08:30
  const end   = 24 * 60;       // 00:00 (midnight)
  if (minutesNow < start) {
    console.log(`Outside alert window (${nowLA} PT). Skipping.`);
    return;
  }

  const entries = await nsGet('/api/v1/entries.json?count=2');
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log('No entries from Nightscout');
    return;
  }

  const latest = entries[0];
  const bg        = latest.sgv;
  const trend     = latest.direction || 'NOT COMPUTABLE';
  const arrow     = TREND_ARROWS[trend] || '?';
  const timestamp = new Date(latest.date).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });

  console.log(`Latest BG: ${bg} mg/dL | Trend: ${trend} | Time: ${timestamp}`);

  const state = readState();

  // Reset alert state if BG has recovered
  if (bg > RECOVERY_THRESHOLD && state.alertSent) {
    console.log(`BG recovered to ${bg} (>${RECOVERY_THRESHOLD}). Resetting alert state.`);
    writeState({ alertSent: false, alertSentAt: null, lastBg: bg });
    return;
  }

  state.lastBg = bg;

  // Check alert condition
  if (bg <= ALERT_THRESHOLD && DOWN_TRENDS.has(trend)) {
    if (state.alertSent) {
      console.log(`Alert already sent at ${state.alertSentAt}. Skipping.`);
      return;
    }

    // Send alert
    const botToken = getBotToken();
    if (!botToken) { console.error('No bot token'); process.exit(1); }

    const msg = `⚠️ LOW GLUCOSE ALERT\n\n🩸 BG: ${bg} mg/dL ${arrow}\n📉 Trend: ${trend}\n🕐 Time: ${timestamp} PT\n\nMaria's glucose is at or below 90 and dropping. Consider a small snack.`;

    const result = await sendTelegramMessage(botToken, '-5262020908', msg);
    if (result.ok) {
      console.log(`Alert sent! Message ID: ${result.result?.message_id}`);
      writeState({ alertSent: true, alertSentAt: new Date().toISOString(), lastBg: bg });
    } else {
      console.error('Failed to send alert:', JSON.stringify(result));
      process.exit(1);
    }
  } else {
    console.log(`No alert needed (BG: ${bg}, trend: ${trend}, alertSent: ${state.alertSent})`);
    writeState({ ...state, lastBg: bg });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
