#!/usr/bin/env /opt/homebrew/bin/node
/**
 * openclaw_api_migration.js
 * Switches openclaw.json anthropic:default from OAuth token to API key.
 * Scheduled for 2026-04-04 11:30 AM PT. Self-removes from crontab after running.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const API_KEY_FILE = path.join(WORKSPACE, 'cc_mini_api.txt');
const BRIDGE_CONFIG = path.join(WORKSPACE, 'scripts/claude-bridge/config.json');
const JAVI_CHAT_ID = '8335333215';

function sendTelegram(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({ chat_id: chatId, text }).toString();
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function removeSelfFromCrontab() {
  try {
    const current = execSync('crontab -l 2>/dev/null || true').toString();
    const updated = current.split('\n')
      .filter(line => !line.includes('openclaw_api_migration'))
      .join('\n');
    const tmp = '/tmp/crontab_after_migration.txt';
    fs.writeFileSync(tmp, updated);
    execSync(`crontab ${tmp}`);
    fs.unlinkSync(tmp);
  } catch (err) {
    console.error('[migration] Failed to remove from crontab:', err.message);
  }
}

async function main() {
  console.log('[migration] Starting Anthropic OAuth → API key migration...');

  // 1. Read API key (fallback to hardcoded if file missing)
  let apiKey;
  if (fs.existsSync(API_KEY_FILE)) {
    apiKey = fs.readFileSync(API_KEY_FILE, 'utf8').trim();
  } else {
    apiKey = process.env.ANTHROPIC_API_KEY || '';
    console.log('[migration] API key file not found, using hardcoded fallback.');
  }
  if (!apiKey.startsWith('sk-ant-')) {
    throw new Error(`Unexpected API key format: ${apiKey.slice(0, 10)}...`);
  }

  // 2. Patch openclaw.json
  const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  cfg.auth.profiles['anthropic:default'] = {
    provider: 'anthropic',
    mode: 'api_key',
    apiKey
  };
  cfg.meta.lastTouchedAt = new Date().toISOString();
  fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  console.log('[migration] openclaw.json updated: anthropic:default → api_key mode');

  // 3. Send Telegram confirmation
  const bridge = JSON.parse(fs.readFileSync(BRIDGE_CONFIG, 'utf8'));
  await sendTelegram(bridge.botToken, JAVI_CHAT_ID,
    '✅ OpenClaw API migration done\n\nanthropic:default switched from OAuth token → API key (sk-ant-...)\n\nReady before the 12pm PT deadline.'
  );
  console.log('[migration] Telegram confirmation sent.');

  // 4. Remove self from crontab
  removeSelfFromCrontab();
  console.log('[migration] Removed from crontab.');
}

main().catch(async err => {
  console.error('[migration] FAILED:', err.message);
  try {
    const bridge = JSON.parse(fs.readFileSync(BRIDGE_CONFIG, 'utf8'));
    await sendTelegram(bridge.botToken, JAVI_CHAT_ID,
      `⛔ OpenClaw API migration FAILED\n\n${err.message}\n\nManual intervention needed before 12pm PT!`
    );
  } catch {}
  process.exitCode = 1;
});
