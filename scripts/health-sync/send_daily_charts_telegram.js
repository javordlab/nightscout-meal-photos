#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const STATE_PATH = path.join(DATA_DIR, 'chart_delivery_state.json');
const LOCK_PATH = path.join(DATA_DIR, 'chart_delivery.lock');
const LOG_PATH = path.join(DATA_DIR, 'chart_delivery.log.jsonl');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const CHARTS = [
  { key: 'daily_glucose_chart.png', path: '/Users/javier/.openclaw/workspace/tmp/daily_glucose_chart.png', caption: 'Daily glucose chart' },
  { key: 'glucose_chart.png', path: '/Users/javier/.openclaw/workspace/tmp/glucose_chart.png', caption: '7-day glucose chart' },
  { key: 'weekly_calories_chart.png', path: '/Users/javier/.openclaw/workspace/tmp/weekly_calories_chart.png', caption: 'Weekly calories chart' },
  { key: 'weekly_carbs_chart.png', path: '/Users/javier/.openclaw/workspace/tmp/weekly_carbs_chart.png', caption: 'Weekly carbs chart' }
];

function log(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function laDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseArgs(argv) {
  const out = {
    chatId: process.env.DAILY_REPORT_TELEGRAM_CHAT_ID || '-5262020908',
    reportDateLA: laDateString(),
    force: false,
    dryRun: false,
    regenerate: true
  };

  for (const arg of argv) {
    if (arg.startsWith('--chat-id=')) out.chatId = arg.split('=')[1] || out.chatId;
    if (arg.startsWith('--date-la=')) out.reportDateLA = arg.split('=')[1] || out.reportDateLA;
    if (arg === '--force') out.force = true;
    if (arg === '--dry-run') out.dryRun = true;
    if (arg === '--no-regenerate') out.regenerate = false;
  }

  return out;
}

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    const token = cfg?.channels?.telegram?.botToken;
    if (token) return token;
  } catch {}
  return null;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function acquireLock(maxAgeMs = 15 * 60 * 1000) {
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      const st = fs.statSync(LOCK_PATH);
      if (Date.now() - st.mtimeMs > maxAgeMs) {
        fs.unlinkSync(LOCK_PATH);
        const fd = fs.openSync(LOCK_PATH, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), staleLockRecovered: true }));
        fs.closeSync(fd);
        return true;
      }
    } catch {}
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch {}
}

function ensureCharts() {
  const cmds = [
    'cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/generate_daily_glucose_chart.js',
    'cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/generate_glucose_chart.js',
    'cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/generate_weekly_calories_chart.js',
    'cd /Users/javier/.openclaw/workspace && /opt/homebrew/bin/node scripts/generate_weekly_carbs_chart.js'
  ];

  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString().trim() : '';
      const stdout = e.stdout ? e.stdout.toString().trim() : '';
      throw new Error(`chart_generate_failed: ${cmd}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
  }
}

function sendPhoto(botToken, chatId, chartPath, caption) {
  const boundary = '----piChartBoundary' + Math.random().toString(16).slice(2);
  const photo = fs.readFileSync(chartPath);

  const pre = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="disable_notification"\r\n\r\ntrue\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="photo"; filename="${path.basename(chartPath)}"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([pre, photo, post]);

  const options = {
    method: 'POST',
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendPhoto`,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (parsed.ok) return resolve(parsed);
          return reject(new Error(`telegram_send_failed:${parsed.description || 'unknown'}`));
        } catch (e) {
          return reject(new Error(`telegram_parse_failed:${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const botToken = getBotToken();
  if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN and could not read ~/.openclaw/openclaw.json channels.telegram.botToken');

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!acquireLock()) {
    log({ op: 'chart_send_skipped_lock_present', chatId: opts.chatId, reportDateLA: opts.reportDateLA });
    console.log(JSON.stringify({ status: 'skipped_lock_present' }, null, 2));
    return { status: 'skipped_lock_present' };
  }

  try {
    if (opts.regenerate) {
      ensureCharts();
      log({ op: 'chart_regenerated', reportDateLA: opts.reportDateLA });
    }

    const state = readJson(STATE_PATH, { version: 1, chats: {} });
    state.chats[opts.chatId] = state.chats[opts.chatId] || {};
    state.chats[opts.chatId][opts.reportDateLA] = state.chats[opts.chatId][opts.reportDateLA] || { sent: {} };

    const sentMap = state.chats[opts.chatId][opts.reportDateLA].sent || {};

    const summary = {
      status: 'ok',
      reportDateLA: opts.reportDateLA,
      chatId: opts.chatId,
      sent: [],
      skippedAlreadySent: [],
      dryRun: opts.dryRun,
      force: opts.force
    };

    for (const chart of CHARTS) {
      if (!fs.existsSync(chart.path)) throw new Error(`missing_chart:${chart.path}`);

      if (!opts.force && sentMap[chart.key]) {
        summary.skippedAlreadySent.push(chart.key);
        log({ op: 'chart_skipped_already_sent', reportDateLA: opts.reportDateLA, chatId: opts.chatId, chart: chart.key });
        continue;
      }

      if (opts.dryRun) {
        summary.sent.push({ chart: chart.key, dryRun: true });
        log({ op: 'chart_send_dry_run', reportDateLA: opts.reportDateLA, chatId: opts.chatId, chart: chart.key });
        continue;
      }

      const caption = `${chart.caption} (${opts.reportDateLA})`;
      const response = await sendPhoto(botToken, opts.chatId, chart.path, caption);
      const messageId = response?.result?.message_id || null;
      const st = fs.statSync(chart.path);

      sentMap[chart.key] = {
        sentAt: new Date().toISOString(),
        messageId,
        size: st.size,
        mtimeMs: st.mtimeMs
      };

      summary.sent.push({ chart: chart.key, messageId });
      log({ op: 'chart_sent', reportDateLA: opts.reportDateLA, chatId: opts.chatId, chart: chart.key, messageId });
    }

    state.chats[opts.chatId][opts.reportDateLA].sent = sentMap;
    saveJson(STATE_PATH, state);

    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  main().catch((e) => {
    log({ op: 'chart_send_error', error: e.message });
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
