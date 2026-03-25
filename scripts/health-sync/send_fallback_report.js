#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { markReportSent } = require('./report_watchdog');
const { main: generateDailyReport } = require('../generate_daily_report');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const OUTPUT_PATH = path.join(WORKSPACE, 'data', 'fallback_report.txt');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return cfg?.channels?.telegram?.botToken || null;
  } catch {
    return null;
  }
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
      res.on('data', c => data += c);
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

async function main() {
  const generated = await generateDailyReport();
  const reportText = fs.readFileSync(generated.reportPath, 'utf8').trim();

  const chatId = process.env.DAILY_REPORT_TELEGRAM_CHAT_ID || '-5262020908';
  const botToken = getBotToken();

  let telegramStatus = 'skipped_missing_token';
  if (botToken) {
    await sendMessage(botToken, chatId, reportText);
    telegramStatus = 'sent';
  }

  const lines = [
    'FALLBACK HEALTH REPORT',
    `Generated at: ${new Date().toISOString()}`,
    'Reason: Primary 09:30 report was missing by 09:32 PT',
    `Daily report generated at: ${generated.reportPath}`,
    `Telegram delivery: ${telegramStatus}`,
    'Action: Fallback report emitted and watchdog heartbeat updated.'
  ];

  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n');

  // Try to send charts immediately; idempotent sender will only fill gaps.
  execSync(`cd ${WORKSPACE} && /opt/homebrew/bin/node scripts/health-sync/send_daily_charts_telegram.js --no-regenerate`, {
    stdio: 'inherit'
  });

  markReportSent('watchdog_fallback');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
