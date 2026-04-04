#!/usr/bin/env node
/**
 * claude-bridge/bridge.js
 * Telegram → Claude Code bridge.
 * Routes messages from an authorized Telegram bot to `claude --print`,
 * maintaining a persistent session per user.
 *
 * Setup:
 *   1. Create bot via BotFather, paste token into config below or CLAUDE_BRIDGE_TOKEN env var
 *   2. node scripts/claude-bridge/bridge.js
 *   3. Install as launchd service: scripts/claude-bridge/install_launchd.sh
 *
 * Commands:
 *   /reset   — start a fresh Claude Code session
 *   /status  — show current session ID + model
 *   /help    — show available commands
 */

const { execSync, spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.CLAUDE_BRIDGE_TOKEN || require('./config.json').botToken;
const ALLOWED_USERS = [8335333215, 8738167445]; // Javi, Maria
const WORKSPACE = '/Users/javier/.openclaw/workspace';
const CLAUDE_BIN = '/Users/javier/.local/bin/claude';
const STATE_FILE = path.join(WORKSPACE, 'data/claude_bridge_state.json');
const POLL_INTERVAL_MS = 1500;
const MAX_MESSAGE_LENGTH = 4096; // Telegram limit

// ── State ───────────────────────────────────────────────────────────────────
let state = { sessions: {}, offset: 0 };
if (fs.existsSync(STATE_FILE)) {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Telegram API ─────────────────────────────────────────────────────────────
function tgApi(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendMessage(chatId, text, replyToId) {
  // Split long messages
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
  }
  for (const chunk of chunks) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: chunk,
      parse_mode: 'Markdown',
      reply_to_message_id: replyToId,
    }).catch(() =>
      // Fallback without markdown if parse fails
      tgApi('sendMessage', { chat_id: chatId, text: chunk, reply_to_message_id: replyToId })
    );
  }
}

async function sendTyping(chatId) {
  await tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// ── Claude runner ─────────────────────────────────────────────────────────────
function runClaude(userId, prompt, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'json',
    ];
    if (sessionId) args.push('--resume', sessionId);

    const env = { ...process.env, HOME: '/Users/javier' };
    const child = spawn(CLAUDE_BIN, args, {
      cwd: WORKSPACE,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    child.on('close', code => {
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          text: parsed.result || parsed.content || stdout.trim(),
          sessionId: parsed.session_id || sessionId,
        });
      } catch {
        if (stdout.trim()) {
          resolve({ text: stdout.trim(), sessionId });
        } else {
          reject(new Error(stderr || `Claude exited with code ${code}`));
        }
      }
    });

    child.on('error', reject);

    // Timeout after 3 minutes
    setTimeout(() => {
      child.kill();
      reject(new Error('Claude timed out after 3 minutes'));
    }, 180_000);
  });
}

// ── Message handler ──────────────────────────────────────────────────────────
const inFlight = new Set();

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text?.trim();
  const msgId = msg.message_id;

  if (!text || !userId) return;
  if (!ALLOWED_USERS.includes(userId)) {
    await sendMessage(chatId, '⛔ Not authorized.');
    return;
  }
  if (inFlight.has(userId)) {
    await sendMessage(chatId, '⏳ Still processing your last message — please wait.', msgId);
    return;
  }

  // ── Built-in commands ────────────────────────────────────────────────────
  if (text === '/reset') {
    delete state.sessions[userId];
    saveState();
    await sendMessage(chatId, '🔄 Session reset. Next message starts fresh.', msgId);
    return;
  }
  if (text === '/status') {
    const sid = state.sessions[userId];
    await sendMessage(chatId, sid
      ? `✅ Active session: \`${sid.slice(0, 8)}...\`\nWorkspace: \`${WORKSPACE}\``
      : '💤 No active session. Send any message to start one.',
      msgId);
    return;
  }
  if (text === '/help') {
    await sendMessage(chatId, [
      '*Claude Code Bridge* 🤖',
      '',
      'Just send any message to talk to Claude Code.',
      '',
      'Commands:',
      '  /reset — start a fresh session',
      '  /status — show current session info',
      '  /help — this message',
      '',
      `Workspace: \`${WORKSPACE}\``,
      'CLAUDE.md loads automatically.',
    ].join('\n'), msgId);
    return;
  }

  // ── Forward to Claude ────────────────────────────────────────────────────
  inFlight.add(userId);
  try {
    // Send typing indicator while Claude thinks
    const typingInterval = setInterval(() => sendTyping(chatId), 4000);
    sendTyping(chatId);

    const sessionId = state.sessions[userId] || null;
    const { text: reply, sessionId: newSessionId } = await runClaude(userId, text, sessionId);

    clearInterval(typingInterval);

    // Persist session
    if (newSessionId) {
      state.sessions[userId] = newSessionId;
      saveState();
    }

    await sendMessage(chatId, reply, msgId);
  } catch (err) {
    await sendMessage(chatId, `❌ Error: ${err.message}`, msgId);
  } finally {
    inFlight.delete(userId);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────────
async function poll() {
  try {
    const res = await tgApi('getUpdates', {
      offset: state.offset,
      timeout: 30,
      allowed_updates: ['message'],
    });
    if (res.ok && res.result?.length) {
      for (const update of res.result) {
        state.offset = update.update_id + 1;
        if (update.message) handleMessage(update.message).catch(console.error);
      }
      saveState();
    }
  } catch (err) {
    console.error('[poll error]', err.message);
  }
  setTimeout(poll, POLL_INTERVAL_MS);
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log(`[claude-bridge] Starting — workspace: ${WORKSPACE}`);
tgApi('getMe').then(r => {
  if (!r.ok) { console.error('Bad token or Telegram unreachable:', r); process.exit(1); }
  console.log(`[claude-bridge] Bot: @${r.result.username}`);
  poll();
}).catch(err => { console.error('Startup failed:', err); process.exit(1); });
