#!/usr/bin/env node
/**
 * process_missed_text_messages.js
 *
 * Recovers text-only messages from the Food Log group that the main agent
 * may have missed (e.g. during gateway busy/restart periods).
 *
 * Strategy:
 *  - Read telegram_media_envelopes.jsonl for TEXT contentType entries from the group
 *  - Cross-reference against health_log.md to see if the message was acted on
 *  - For each unprocessed text: alert Javi with the message content so he can
 *    decide whether to log it manually
 *
 * Runs every 30 minutes via cron. Only alerts on messages < 3h old.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const ENVELOPES_PATH = path.join(__dirname, '../../data/telegram_media_envelopes.jsonl');
const HEALTH_LOG     = path.join(__dirname, '../../health_log.md');
const STATE_PATH     = path.join(__dirname, '../../data/missed_text_state.json');
const OPENCLAW_CFG   = '/Users/javier/.openclaw/openclaw.json';
const FOOD_LOG_CHAT  = -5262020908;
const ALERT_TO       = '8335333215';
const WINDOW_MS      = 3 * 60 * 60 * 1000; // 3 hours

function getBotToken() {
  try { return JSON.parse(fs.readFileSync(OPENCLAW_CFG, 'utf8'))?.channels?.telegram?.botToken || null; }
  catch { return null; }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { alerted: [] }; }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n');
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

// Keywords that suggest a loggable activity or food entry
function isLoggable(text) {
  const t = text.toLowerCase();
  return /walk|run|exercise|garden|qigong|tai chi|yoga|swim|bike|class|workout/.test(t) ||
         /ate|eat|had|drinking|snack|breakfast|lunch|dinner|dessert|coffee|tea|juice/.test(t) ||
         /minute|min|hour|step/.test(t);
}

// Check if text roughly appears in health_log (loose match)
function appearsInLog(text, logContent) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 3);
  return words.every(w => logContent.toLowerCase().includes(w));
}

async function main() {
  if (!fs.existsSync(ENVELOPES_PATH)) {
    console.log('No envelopes file — skipping');
    return;
  }

  const now = Date.now();
  const lines = fs.readFileSync(ENVELOPES_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
  const state = loadState();
  const sysTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Find TEXT messages from the Food Log group within window
  const candidates = lines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e &&
      e.contentType === 'TEXT' &&
      e.chatId === FOOD_LOG_CHAT &&
      e.captionOrText?.trim() &&
      (now - new Date(e.timestamp).getTime()) <= WINDOW_MS
    );

  const missed = candidates.filter(e => {
    const key = `${e.messageId}:${e.updateId}`;
    if (state.alerted.includes(key)) return false;
    const text = e.captionOrText.trim();
    if (!isLoggable(text)) return false;
    if (appearsInLog(text, logContent)) return false;
    return true;
  });

  console.log(`Text envelopes in window: ${candidates.length} | Potentially missed: ${missed.length}`);

  if (missed.length === 0) return;

  const botToken = getBotToken();
  if (!botToken) { console.error('No bot token'); return; }

  for (const e of missed) {
    const t = new Date(e.timestamp).toLocaleString('en-US', { timeZone: sysTZ, hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
    const msg = `⚠️ Possibly missed text message from Food Log (${t}):\n\n"${e.captionOrText.trim()}"\n\nWas this logged? If not, forward it to me to log manually.`;
    const res = await sendTelegram(botToken, ALERT_TO, msg);
    if (res.ok) {
      state.alerted.push(`${e.messageId}:${e.updateId}`);
      console.log(`Alerted for msg ${e.messageId}`);
    }
  }

  // Prune old alerted IDs (keep last 200)
  state.alerted = state.alerted.slice(-200);
  saveState(state);
}

main().catch(e => { console.error(e); process.exit(1); });
