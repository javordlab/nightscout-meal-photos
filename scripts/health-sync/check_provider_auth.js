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

async function checkOpenAICodex() {
  // Test by asking openclaw to make a minimal call via its CLI
  // If auth is expired, openclaw will error
  try {
    const result = execSync(
      `openclaw auth status openai-codex 2>&1`,
      { timeout: 10000, encoding: 'utf8' }
    );
    if (/expired|invalid|unauthorized|not logged/i.test(result)) {
      throw new Error('Auth expired — run: openclaw auth login openai-codex');
    }
  } catch (err) {
    if (err.message.includes('Auth expired')) throw err;
    // openclaw auth status might not exist — fall back to a model ping
    try {
      const result2 = execSync(
        `echo "hi" | openclaw run --model openai-codex/gpt-5.3-codex --print 2>&1`,
        { timeout: 30000, encoding: 'utf8' }
      );
      if (/unauthorized|expired|login|auth/i.test(result2)) {
        throw new Error('Auth expired — run: openclaw auth login openai-codex');
      }
    } catch (err2) {
      if (/unauthorized|expired|login|auth/i.test(err2.message)) throw err2;
      // If it's just a different error (model not responding etc), don't alert
    }
  }
}

async function checkGemini() {
  try {
    const result = execSync(
      `openclaw auth status google-gemini-cli 2>&1`,
      { timeout: 10000, encoding: 'utf8' }
    );
    if (/expired|invalid|unauthorized|not logged/i.test(result)) {
      throw new Error('Auth expired — run: openclaw auth login google-gemini-cli');
    }
  } catch (err) {
    if (err.message.includes('Auth expired')) throw err;
    // Not a hard failure if we can't check
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const CHECKS = [
  { name: 'Nightscout',      fn: checkNightscout,  critical: true },
  { name: 'Notion',          fn: checkNotion,       critical: true },
  { name: 'OpenAI Codex',    fn: checkOpenAICodex,  critical: false },
  { name: 'Google Gemini',   fn: checkGemini,       critical: false },
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
