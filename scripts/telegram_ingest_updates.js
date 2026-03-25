#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const RAW_UPDATES_PATH = path.join(DATA_DIR, 'telegram_updates_raw.jsonl');
const STATE_PATH = path.join(DATA_DIR, 'telegram_updates_state.json');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';

function callTelegram(method, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}${query ? `?${query}` : ''}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastUpdateId: 0 };
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastUpdateId: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function main() {
  const state = loadState();
  const updates = await callTelegram('getUpdates', {
    offset: Number(state.lastUpdateId || 0) + 1,
    limit: 100
  });

  if (!updates.ok) throw new Error(`telegram_getUpdates_failed:${JSON.stringify(updates)}`);

  const result = Array.isArray(updates.result) ? updates.result : [];
  let maxUpdateId = Number(state.lastUpdateId || 0);

  if (result.length > 0) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const lines = result.map((u) => JSON.stringify(u)).join('\n') + '\n';
    fs.appendFileSync(RAW_UPDATES_PATH, lines);
    for (const u of result) {
      if (Number.isFinite(u.update_id) && u.update_id > maxUpdateId) maxUpdateId = u.update_id;
    }
  }

  saveState({
    lastUpdateId: maxUpdateId,
    lastRun: new Date().toISOString(),
    appended: result.length
  });

  const summary = { appended: result.length, lastUpdateId: maxUpdateId };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
