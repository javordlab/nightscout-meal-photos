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
 *  - For each unprocessed loggable text: spawn an isolated agent turn to log it
 *    properly (with BG, prediction, format, sync) — same as if the message arrived live
 *
 * Runs every 30 minutes via cron (8am-10pm). Only processes messages < 3h old.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const ENVELOPES_PATH = path.join(__dirname, '../../data/telegram_media_envelopes.jsonl');
const HEALTH_LOG     = path.join(__dirname, '../../health_log.md');
const STATE_PATH     = path.join(__dirname, '../../data/missed_text_state.json');
const OPENCLAW_CFG   = '/Users/javier/.openclaw/openclaw.json';
const FOOD_LOG_CHAT  = -5262020908;
const WINDOW_MS      = 3 * 60 * 60 * 1000; // 3 hours

const DRY_RUN = process.argv.includes('--dry-run');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { processed: [] }; }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n');
}

function getOpenClawConfig() {
  try { return JSON.parse(fs.readFileSync(OPENCLAW_CFG, 'utf8')); }
  catch { return {}; }
}

// Keywords that suggest a loggable health entry
function isLoggable(text) {
  const t = text.toLowerCase();
  return /walk|run|exercise|garden|qigong|tai chi|yoga|swim|bike|workout/.test(t) ||
         /ate|eat|had|drinking|snack|breakfast|lunch|dinner|dessert/.test(t) ||
         /minute|min\b|hour\b/.test(t) ||
         /eliminate|remove|correct|didn.*eat|not.*eaten/.test(t); // corrections
}

// Check if text roughly appears in health_log (loose keyword match)
function appearsInLog(text, logContent) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 4);
  if (words.length === 0) return false;
  return words.filter(w => logContent.toLowerCase().includes(w)).length >= Math.min(2, words.length);
}

// Call OpenClaw gateway API to spawn an isolated agent turn for logging
function spawnAgentTurn(gatewayUrl, gatewayToken, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      kind: 'agentTurn',
      message,
      model: 'anthropic/claude-sonnet-4-6',
      timeoutSeconds: 120
    });
    const url = new URL(`${gatewayUrl}/api/sessions/isolated/run`);
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${gatewayToken}`
      }
    };
    const req = (url.protocol === 'https:' ? https : require('http')).request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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
    if (state.processed.includes(key)) return false;
    const text = e.captionOrText.trim();
    if (!isLoggable(text)) return false;
    if (appearsInLog(text, logContent)) return false;
    return true;
  });

  console.log(`TEXT envelopes in window: ${candidates.length} | Unprocessed loggable: ${missed.length}`);
  if (missed.length === 0) return;

  const cfg = getOpenClawConfig();
  const gatewayUrl = `http://127.0.0.1:${cfg.port || 18789}`;
  const gatewayToken = cfg.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN;

  for (const e of missed) {
    const key = `${e.messageId}:${e.updateId}`;
    const t = new Date(e.timestamp).toLocaleString('en-US', {
      timeZone: sysTZ, hour: '2-digit', minute: '2-digit',
      month: 'short', day: 'numeric', hour12: false
    });
    const text = e.captionOrText.trim();

    console.log(`Processing missed message [${t}]: "${text.substring(0, 80)}"`);

    if (DRY_RUN) {
      console.log('[DRY RUN] Would spawn agent to log this');
      state.processed.push(key);
      continue;
    }

    // Spawn agent turn to log the entry properly
    const prompt = `A text message was sent to the Food Log group at ${t} (${sysTZ}) but was missed by the main agent. Process it now exactly as if it arrived live:

Message: "${text}"
Original timestamp: ${e.timestamp}
Sender: ${e.senderId === 8335333215 ? 'Javier' : 'Maria Dennis'}

Instructions:
1. Fetch current BG from Nightscout
2. Classify the message (Food/Activity/Medication/Correction)
3. If it's a correction to an existing entry, apply the correction to health_log.md
4. If it's a new Food/Activity/Medication entry, log it to health_log.md with the ORIGINAL timestamp (${e.timestamp}), correct format, BG, and prediction
5. Run radial_dispatcher.js to sync
6. Reply NO_REPLY when done`;

    try {
      const result = await spawnAgentTurn(gatewayUrl, gatewayToken, prompt);
      console.log(`Agent turn result: ${JSON.stringify(result).substring(0, 100)}`);
      state.processed.push(key);
    } catch (err) {
      console.error(`Failed to spawn agent for msg ${e.messageId}:`, err.message);
    }
  }

  state.processed = state.processed.slice(-500);
  saveState(state);
}

main().catch(e => { console.error(e); process.exit(1); });
