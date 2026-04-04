/**
 * telegram_alert.js — Shared alert sender for all infrastructure alerts.
 * Always sends via the Claude Code bridge bot to Javi's DM.
 *
 * Usage:
 *   const { sendAlert } = require('./telegram_alert');
 *   await sendAlert('⚠️ Something broke');
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const BRIDGE_CONFIG = path.join(WORKSPACE, 'scripts/claude-bridge/config.json');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const JAVI_CHAT_ID = '8335333215';

function getBridgeBotToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync(BRIDGE_CONFIG, 'utf8'));
    if (cfg.botToken) return cfg.botToken;
  } catch {}
  // Fallback to OpenClaw bot if bridge config missing
  try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return cfg?.channels?.telegram?.botToken || null;
  } catch { return null; }
}

function sendAlert(text, chatId = JAVI_CHAT_ID) {
  const token = getBridgeBotToken();
  if (!token) return Promise.resolve({ ok: false, error: 'No bot token' });

  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(body);
    req.end();
  });
}

module.exports = { sendAlert, getBridgeBotToken, JAVI_CHAT_ID };
