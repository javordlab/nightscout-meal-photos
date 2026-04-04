#!/usr/bin/env node
/**
 * claude-bridge/bridge.js
 * Telegram → Claude Code bridge for Javi's DM.
 * Routes messages (text + photos) to `claude --print` with AGENTS.md system prompt,
 * maintaining a persistent session per user.
 * Falls back to Ollama cloud (DeepSeek V3.2) if Claude is unavailable.
 *
 * Maria's messages go through OpenClaw (separate bot). This bridge is Javi-only.
 *
 * Commands:
 *   /reset   — start a fresh Claude Code session
 *   /status  — show current session ID + model
 *   /help    — show available commands
 */

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────────────
const config = require('./config.json');
const BOT_TOKEN = process.env.CLAUDE_BRIDGE_TOKEN || config.botToken;
const MODEL = process.env.CLAUDE_BRIDGE_MODEL || config.model || 'sonnet';
const ALLOWED_USERS = [8335333215]; // Javi only — Maria uses OpenClaw
const WORKSPACE = '/Users/javier/.openclaw/workspace';
const CLAUDE_BIN = '/Users/javier/.local/bin/claude';
const INBOUND_DIR = '/Users/javier/.openclaw/media/inbound';
const SYSTEM_PROMPT_FILE = path.join(WORKSPACE, 'AGENTS.md');
const STATE_FILE = path.join(WORKSPACE, 'data/claude_bridge_state.json');
const LOG_FILE = path.join(WORKSPACE, 'data/claude_bridge.log');
const POLL_INTERVAL_MS = 1500;
const MAX_MESSAGE_LENGTH = 4096; // Telegram limit

// Ollama cloud fallback
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'deepseek-v3.2:cloud';

// ── Logging ────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [claude-bridge] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

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
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
  }
  for (const chunk of chunks) {
    // Send as plain text to avoid Markdown parse failures
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: chunk,
      reply_to_message_id: replyToId,
    }).catch(err => log(`sendMessage failed: ${err.message}`));
  }
}

async function sendTyping(chatId) {
  await tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// ── Photo download ──────────────────────────────────────────────────────────
async function downloadPhoto(fileId) {
  const fileInfo = await tgApi('getFile', { file_id: fileId });
  if (!fileInfo.ok || !fileInfo.result?.file_path) return null;

  const filePath = fileInfo.result.file_path;
  const ext = path.extname(filePath) || '.jpg';
  const localName = `bridge-${Date.now()}${ext}`;
  const localPath = path.join(INBOUND_DIR, localName);

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(localPath);
    https.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`, res => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        log(`Photo saved: ${localPath}`);
        resolve(localPath);
      });
    }).on('error', err => {
      fs.unlink(localPath, () => {});
      reject(err);
    });
  });
}

// ── Claude runner ─────────────────────────────────────────────────────────────
function runClaude(userId, prompt, sessionId, photoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '--model', MODEL,
      '--append-system-prompt-file', SYSTEM_PROMPT_FILE,
    ];
    if (sessionId) args.push('--resume', sessionId);

    const env = {
      ...process.env,
      HOME: '/Users/javier',
      PATH: '/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    };
    const child = spawn(CLAUDE_BIN, args, {
      cwd: WORKSPACE,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // If photo, include the path so Claude can read it with its Read tool
    const fullPrompt = photoPath
      ? `[Photo attached at: ${photoPath}]\n\n${prompt}`
      : prompt;

    child.stdin.write(fullPrompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    // Warn at 4 min, hard kill at 8 min
    const warnTimer = setTimeout(() => {
      child._warned = true;
    }, 240_000);
    const killTimer = setTimeout(() => {
      clearTimeout(warnTimer);
      child.kill();
      reject(new Error('Claude timed out after 8 minutes'));
    }, 480_000);

    child.on('close', code => {
      clearTimeout(warnTimer);
      clearTimeout(killTimer);
      try {
        const parsed = JSON.parse(stdout);
        resolve({
          text: parsed.result || parsed.content || stdout.trim(),
          sessionId: parsed.session_id || sessionId,
          source: 'claude',
        });
      } catch {
        if (stdout.trim()) {
          resolve({ text: stdout.trim(), sessionId, source: 'claude' });
        } else {
          reject(new Error(stderr || `Claude exited with code ${code}`));
        }
      }
    });

    child.on('error', reject);
  });
}

// ── Ollama fallback ─────────────────────────────────────────────────────────
function runOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    });

    const url = new URL(`${OLLAMA_URL}/api/chat`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.message?.content;
          if (content) resolve({ text: content, sessionId: null, source: 'ollama' });
          else reject(new Error('Empty Ollama response'));
        } catch { reject(new Error('Invalid Ollama JSON')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(300_000, () => { req.destroy(); reject(new Error('Ollama timed out')); });
    req.write(body);
    req.end();
  });
}

// ── Message handler ──────────────────────────────────────────────────────────
const inFlight = new Set();

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = msg.text?.trim() || msg.caption?.trim() || '';
  const msgId = msg.message_id;

  if (!userId) return;
  if (!ALLOWED_USERS.includes(userId)) {
    await sendMessage(chatId, 'Not authorized.');
    return;
  }

  const hasPhoto = msg.photo && msg.photo.length > 0;
  if (!text && !hasPhoto) return;

  if (inFlight.has(userId)) {
    await sendMessage(chatId, 'Still processing your last message — please wait.', msgId);
    return;
  }

  // ── Built-in commands ────────────────────────────────────────────────────
  if (text === '/reset') {
    delete state.sessions[userId];
    saveState();
    await sendMessage(chatId, 'Session reset. Next message starts fresh.', msgId);
    return;
  }
  if (text === '/status') {
    const sid = state.sessions[userId];
    await sendMessage(chatId, sid
      ? `Active session: ${sid.slice(0, 8)}...\nModel: ${MODEL}\nFallback: ${OLLAMA_MODEL}\nWorkspace: ${WORKSPACE}`
      : `No active session. Model: ${MODEL}. Send any message to start one.`,
      msgId);
    return;
  }
  if (text === '/help') {
    await sendMessage(chatId, [
      'Claude Code Bridge',
      '',
      'Send any message (text or photo) to talk to Claude Code.',
      '',
      'Commands:',
      '  /reset  — start a fresh session',
      '  /status — show current session info',
      '  /help   — this message',
      '',
      `Model: ${MODEL} | Fallback: ${OLLAMA_MODEL}`,
      `Workspace: ${WORKSPACE}`,
      'CLAUDE.md + AGENTS.md load automatically.',
    ].join('\n'), msgId);
    return;
  }

  // ── Download photo if present ───────────────────────────────────────────
  let photoPath = null;
  if (hasPhoto) {
    try {
      // Telegram sends multiple sizes — take the largest (last in array)
      const largestPhoto = msg.photo[msg.photo.length - 1];
      photoPath = await downloadPhoto(largestPhoto.file_id);
    } catch (err) {
      log(`Photo download failed: ${err.message}`);
    }
  }

  // ── Forward to Claude (with Ollama fallback) ────────────────────────────
  inFlight.add(userId);
  let typingInterval;
  try {
    typingInterval = setInterval(() => sendTyping(chatId), 4000);
    sendTyping(chatId);

    const sessionId = state.sessions[userId] || null;
    const prompt = text || (photoPath ? 'What do you see in this photo?' : '');

    // Warn user if taking too long
    const warnTimeout = setTimeout(() => sendMessage(chatId,
      'Still working... (4 min elapsed, will wait up to 8 min total)'
    ).catch(() => {}), 240_000);

    let result;
    try {
      result = await runClaude(userId, prompt, sessionId, photoPath);
    } catch (claudeErr) {
      log(`Claude failed: ${claudeErr.message} — trying Ollama fallback`);
      try {
        const fallbackPrompt = photoPath
          ? `${prompt}\n\n(Note: a photo was attached at ${photoPath} but this fallback model cannot see it)`
          : prompt;
        result = await runOllama(fallbackPrompt);
      } catch (ollamaErr) {
        log(`Ollama fallback also failed: ${ollamaErr.message}`);
        // Reset session on double failure
        delete state.sessions[userId];
        saveState();
        clearTimeout(warnTimeout);
        clearInterval(typingInterval);
        await sendMessage(chatId,
          `Both Claude and fallback failed.\nClaude: ${claudeErr.message}\nOllama: ${ollamaErr.message}\n\nSession reset.`, msgId);
        return;
      }
    } finally {
      clearTimeout(warnTimeout);
    }

    clearInterval(typingInterval);

    // Persist session (Claude only — Ollama is stateless)
    if (result.sessionId) {
      state.sessions[userId] = result.sessionId;
      saveState();
    }

    const sourceTag = result.source === 'ollama' ? '\n\n[via Ollama fallback — no session context]' : '';
    await sendMessage(chatId, result.text + sourceTag, msgId);
    log(`Replied to ${userId} via ${result.source} (${result.text.length} chars)`);
  } catch (err) {
    clearInterval(typingInterval);
    log(`handleMessage error: ${err.message}`);
    delete state.sessions[userId];
    saveState();
    await sendMessage(chatId, `Error: ${err.message}\n\nSession reset — next message starts fresh.`, msgId);
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
        if (update.message) handleMessage(update.message).catch(err => log(`handler error: ${err.message}`));
      }
      saveState();
    }
  } catch (err) {
    log(`poll error: ${err.message}`);
  }
  setTimeout(poll, POLL_INTERVAL_MS);
}

// ── Start ─────────────────────────────────────────────────────────────────────
log(`Starting — model: ${MODEL}, fallback: ${OLLAMA_MODEL}, workspace: ${WORKSPACE}`);
tgApi('getMe').then(r => {
  if (!r.ok) { log(`Bad token or Telegram unreachable: ${JSON.stringify(r)}`); process.exit(1); }
  log(`Bot: @${r.result.username}`);
  poll();
}).catch(err => { log(`Startup failed: ${err.message}`); process.exit(1); });
