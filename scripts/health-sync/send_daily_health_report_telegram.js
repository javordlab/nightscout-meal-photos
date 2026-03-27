#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const { main: generateDailyReport, addDays } = require('../generate_daily_report');
const { markReportSent } = require('./report_watchdog');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const STATE_PATH = path.join(DATA_DIR, 'daily_report_delivery_state.json');
const LOG_PATH = path.join(DATA_DIR, 'daily_report_delivery.log.jsonl');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function log(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    sendCharts: true
  };

  for (const arg of argv) {
    if (arg.startsWith('--chat-id=')) out.chatId = arg.split('=')[1] || out.chatId;
    if (arg.startsWith('--date-la=')) out.reportDateLA = arg.split('=')[1] || out.reportDateLA;
    if (arg === '--force') out.force = true;
    if (arg === '--dry-run') out.dryRun = true;
    if (arg === '--no-charts') out.sendCharts = false;
  }
  return out;
}

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return cfg?.channels?.telegram?.botToken || null;
  } catch {
    return null;
  }
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

function sendMessage(botToken, chatId, text) {
  const postData = new URLSearchParams({
    chat_id: String(chatId),
    text,
    disable_notification: 'true'
  }).toString();

  const options = {
    method: 'POST',
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (parsed.ok) return resolve(parsed);
          return reject(new Error(`telegram_send_message_failed:${parsed.description || 'unknown'}`));
        } catch (e) {
          return reject(new Error(`telegram_send_message_parse_failed:${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function validateReportWindow(generated) {
  const expectedTarget = addDays(generated.reportDate, -1);
  if (generated.targetDate !== expectedTarget) {
    throw new Error(`invalid_target_date: expected ${expectedTarget}, got ${generated.targetDate}`);
  }

  if (!generated.statsDay || !Number.isFinite(generated.statsDay.average) || !Number.isFinite(generated.statsDay.gmi)) {
    throw new Error('invalid_stats_day: missing average/gmi');
  }

  // Fail-closed against obviously wrong day-window data (e.g., stale file carried forward)
  if (!Number.isFinite(generated.statsDay.count) || generated.statsDay.count < 200 || generated.statsDay.count > 320) {
    throw new Error(`invalid_stats_day_count:${generated.statsDay.count}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const botToken = getBotToken();
  if (!botToken) throw new Error('missing_telegram_bot_token');

  const state = readJson(STATE_PATH, { version: 1, chats: {} });
  state.chats[opts.chatId] = state.chats[opts.chatId] || {};
  const alreadySent = state.chats[opts.chatId][opts.reportDateLA];

  const generated = await generateDailyReport({ reportDate: opts.reportDateLA });
  validateReportWindow(generated);
  const reportText = fs.readFileSync(generated.reportPath, 'utf8').trim();

  const summary = {
    status: 'ok',
    reportDateLA: opts.reportDateLA,
    targetDate: generated.targetDate,
    chatId: opts.chatId,
    reportPath: generated.reportPath,
    reportSent: false,
    chartsTriggered: false,
    skippedReportAlreadySent: false,
    dryRun: opts.dryRun,
    force: opts.force
  };

  if (alreadySent && !opts.force) {
    summary.skippedReportAlreadySent = true;
    log({ op: 'daily_report_skipped_already_sent', reportDateLA: opts.reportDateLA, chatId: opts.chatId });
  } else if (opts.dryRun) {
    summary.reportSent = true;
    log({ op: 'daily_report_send_dry_run', reportDateLA: opts.reportDateLA, chatId: opts.chatId, targetDate: generated.targetDate });
  } else {
    const sent = await sendMessage(botToken, opts.chatId, reportText);
    const messageId = sent?.result?.message_id || null;

    state.chats[opts.chatId][opts.reportDateLA] = {
      sentAt: new Date().toISOString(),
      targetDate: generated.targetDate,
      reportPath: generated.reportPath,
      messageId,
      statsDay: {
        count: generated.statsDay.count,
        average: generated.statsDay.average,
        gmi: generated.statsDay.gmi,
        tir: generated.statsDay.tir
      }
    };
    saveJson(STATE_PATH, state);

    markReportSent('primary_deterministic');
    summary.reportSent = true;
    summary.messageId = messageId;

    log({
      op: 'daily_report_sent',
      reportDateLA: opts.reportDateLA,
      targetDate: generated.targetDate,
      chatId: opts.chatId,
      messageId,
      statsDay: state.chats[opts.chatId][opts.reportDateLA].statsDay
    });
  }

  if (opts.sendCharts) {
    const cmd = `cd ${WORKSPACE} && /opt/homebrew/bin/node scripts/health-sync/send_daily_charts_telegram.js --date-la=${opts.reportDateLA}${opts.dryRun ? ' --dry-run' : ''}`;
    execSync(cmd, { stdio: 'inherit' });
    summary.chartsTriggered = true;
    log({ op: 'daily_report_charts_triggered', reportDateLA: opts.reportDateLA, chatId: opts.chatId, dryRun: opts.dryRun });
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch((e) => {
    log({ op: 'daily_report_delivery_error', error: e.message });
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
