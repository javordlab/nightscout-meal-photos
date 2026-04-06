#!/usr/bin/env node
/**
 * check_provider_auth.js — Test provider auth tokens and alert if any are expired/invalid.
 *
 * Tests each provider by making a minimal API call.
 * Sends Telegram DM to Javi if any provider fails auth.
 *
 * Run: node scripts/health-sync/check_provider_auth.js
 * Cron: 0 8 * * * (daily at 8 AM, before any cron jobs that depend on these providers)
 */

'use strict';

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const JAVI_CHAT_ID = '8335333215';

const BRIDGE_CONFIG_PATH = path.join(WORKSPACE, 'scripts/claude-bridge/config.json');

function getBotToken() {
  // Send auth alerts via the Claude Code bridge bot (not the HealthGuard bot)
  try {
    const bridge = JSON.parse(fs.readFileSync(BRIDGE_CONFIG_PATH, 'utf8'));
    if (bridge.botToken) return bridge.botToken;
  } catch {}
  // Fallback to OpenClaw bot
  const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  return cfg?.channels?.telegram?.botToken;
}

function sendTelegram(token, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: JAVI_CHAT_ID, text, parse_mode: 'Markdown' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.write(body); req.end();
  });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Provider checks ──────────────────────────────────────────────────────────

async function checkNightscout() {
  const url = 'https://p01--sefi--s66fclg7g2lm.code.run/api/v1/entries.json?count=1';
  const res = await httpsGet(url, {
    'api-secret': 'b3170e23f45df7738434cd8be9cd79d86a6d0f01'
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const data = JSON.parse(res.body);
  if (!Array.isArray(data) || data.length === 0) throw new Error('Empty response');
}

const NOTION_KEY = process.env.NOTION_KEY || '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';

async function checkNotion() {
  const notionKey = NOTION_KEY;

  const res = await httpsGet(
    'https://api.notion.com/v1/databases/31685ec7-0668-813e-8b9e-c5b4d5d70fa5',
    {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28'
    }
  );
  if (res.status === 401) throw new Error('Unauthorized — token expired or invalid');
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
}

// Scan OpenClaw gateway.err.log for recent `[<provider>] Token refresh failed`
// or `refresh_token_reused` lines. This is the authoritative signal — the
// gateway prints these whenever it fails to refresh an OAuth token while
// servicing real traffic, which is what actually matters.
function scanGatewayErrLogForProvider(provider, { windowMinutes = 120 } = {}) {
  const logPath = '/Users/javier/.openclaw/logs/gateway.err.log';
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return null; // log not readable — inconclusive
  }
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const lines = content.split('\n');
  const hits = [];
  for (const line of lines) {
    if (!line.includes(`[${provider}]`)) continue;
    if (!/Token refresh failed|refresh_token_reused|invalid_grant/i.test(line)) continue;
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[-+Z][^ ]*)/);
    if (!m) continue;
    const ts = Date.parse(m[1]);
    if (!Number.isFinite(ts)) continue;
    if (ts >= cutoff) hits.push(ts);
  }
  return hits;
}

async function checkOpenAICodex() {
  const hits = scanGatewayErrLogForProvider('openai-codex', { windowMinutes: 120 });
  if (hits === null) return; // inconclusive, don't alert
  if (hits.length > 0) {
    const latest = new Date(Math.max(...hits)).toISOString();
    throw new Error(
      `${hits.length} token refresh failure(s) in last 2h (latest ${latest}) — run: openclaw models auth login openai-codex`
    );
  }
}

async function checkGemini() {
  const hits = scanGatewayErrLogForProvider('google-gemini-cli', { windowMinutes: 120 });
  if (hits === null) return;
  if (hits.length > 0) {
    const latest = new Date(Math.max(...hits)).toISOString();
    throw new Error(
      `${hits.length} token refresh failure(s) in last 2h (latest ${latest}) — run: openclaw models auth login google-gemini-cli`
    );
  }
}

async function checkAnthropicOAuth() {
  // The Anthropic provider inside OpenClaw is separate from the Claude Code
  // CLI OAuth (checked by checkClaudeOAuth). This one powers `openclaw agent`
  // turns and model fallbacks.
  const hits = scanGatewayErrLogForProvider('anthropic', { windowMinutes: 120 });
  if (hits === null) return;
  if (hits.length > 0) {
    const latest = new Date(Math.max(...hits)).toISOString();
    throw new Error(
      `${hits.length} token refresh failure(s) in last 2h (latest ${latest}) — run: openclaw models auth login anthropic`
    );
  }
}

async function checkClaudeOAuth() {
  // Pings the Claude Code OAuth session used by daily_log_review.sh (Haiku)
  // and weekly_memory_summary.sh (Sonnet) from system cron.
  // If OAuth has expired, `claude -p` prints a login prompt or errors non-zero.
  const CLAUDE_BIN = '/Users/javier/.local/bin/claude';
  let out;
  try {
    out = execSync(
      `${CLAUDE_BIN} -p --model haiku "reply with just OK" 2>&1`,
      { timeout: 45000, encoding: 'utf8' }
    );
  } catch (err) {
    const msg = (err.stdout || '') + (err.stderr || '') + err.message;
    if (/login|oauth|unauthorized|expired|not authenticated|invalid.*token/i.test(msg)) {
      throw new Error('OAuth expired — run: /Users/javier/.local/bin/claude login');
    }
    throw new Error(`claude -p failed: ${err.message.slice(0, 120)}`);
  }
  if (/please.*log.?in|oauth|unauthorized|not authenticated/i.test(out)) {
    throw new Error('OAuth expired — run: /Users/javier/.local/bin/claude login');
  }
  if (!/ok/i.test(out)) {
    throw new Error(`Unexpected response: ${out.trim().slice(0, 120)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const CHECKS = [
  { name: 'Nightscout',      fn: checkNightscout,      critical: true  },
  { name: 'Notion',          fn: checkNotion,          critical: true  },
  { name: 'OpenAI Codex',    fn: checkOpenAICodex,     critical: true  },
  { name: 'Google Gemini',   fn: checkGemini,          critical: false },
  { name: 'Anthropic OAuth', fn: checkAnthropicOAuth,  critical: true  },
  { name: 'Claude OAuth',    fn: checkClaudeOAuth,     critical: true  },
];

(async () => {
  const failed = [];

  for (const check of CHECKS) {
    try {
      await check.fn();
      console.log(`✅ ${check.name}: OK`);
    } catch (err) {
      console.log(`❌ ${check.name}: ${err.message}`);
      failed.push({ name: check.name, error: err.message, critical: check.critical });
    }
  }

  if (failed.length === 0) {
    console.log('\nAll provider auth checks passed.');
    return;
  }

  const criticalFailed = failed.filter(f => f.critical);
  const icon = criticalFailed.length > 0 ? '🚨' : '⚠️';
  const lines = [
    `${icon} *Provider Auth Alert*`,
    '',
    ...failed.map(f => `${f.critical ? '🔴' : '🟡'} *${f.name}*: ${f.error}`),
    '',
    'Re-auth via OpenClaw settings or CLI.',
  ];

  const botToken = getBotToken();
  if (botToken) {
    await sendTelegram(botToken, lines.join('\n'));
    console.log('\nAlert sent to Telegram.');
  } else {
    console.log('\nNo bot token — could not send Telegram alert.');
    console.log(lines.join('\n'));
  }

  process.exit(failed.length);
})();
