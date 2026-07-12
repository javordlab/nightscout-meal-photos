#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { markReportSent } = require('./report_watchdog');
const { splitMessage } = require('./send_daily_health_report_telegram');
const { main: generateDailyReport, laDateString } = require('../generate_daily_report');
const { withNetRetry, describeError } = require('./net_retry');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const OUTPUT_PATH = path.join(WORKSPACE, 'data', 'fallback_report.txt');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  // Use the foodlog bridge bot (@Javordclaws_bot) — it's the bot in the Food log group.
  // The OpenClaw config bot (OC_noclaudebot) is for OpenClaw's own channel, not the Food log group.
  try {
    const bridgeCfg = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'scripts/claude-bridge/config.foodlog.json'), 'utf8'));
    if (bridgeCfg.botToken) return bridgeCfg.botToken;
  } catch {}
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
  // If the 08:55 primary run already generated today's report (it writes the
  // file BEFORE attempting Telegram delivery), deliver that file as-is instead
  // of regenerating — regeneration re-runs the Coach LLM call, which is exactly
  // what stranded the 2026-07-12 report (transient 401s + retry backoff blew
  // past the watchdog's execSync timeout while a complete report sat on disk).
  const todayLA = laDateString();
  const existingPath = path.join(WORKSPACE, 'data', `daily_report_${todayLA}.txt`);
  let reportPath;
  let source;
  if (fs.existsSync(existingPath) && fs.readFileSync(existingPath, 'utf8').trim()) {
    reportPath = existingPath;
    source = 'reused_existing_file';
    console.log(`Fallback: reusing already-generated report ${existingPath}`);
  } else {
    // Primary died before writing the file — regenerate, but never block on
    // the Coach LLM: delivery beats completeness on this path.
    const generated = await generateDailyReport({ skipCoach: true });
    reportPath = generated.reportPath;
    source = 'regenerated_skip_coach';
  }
  const reportText = fs.readFileSync(reportPath, 'utf8').trim();

  const chatId = process.env.DAILY_REPORT_TELEGRAM_CHAT_ID || '-5262020908';
  const botToken = getBotToken();

  let telegramStatus = 'skipped_missing_token';
  if (botToken) {
    // Telegram caps messages at 4096 chars — chunk long reports and send sequentially.
    const chunks = splitMessage(reportText);
    for (const chunk of chunks) {
      // This is the last line of defense for the daily report — retry hard on
      // pre-connection network blips (safe: request never reached Telegram).
      await withNetRetry(
        () => sendMessage(botToken, chatId, chunk),
        { attempts: 5, baseMs: 3000, label: 'fallback-report sendMessage' }
      );
    }
    telegramStatus = 'sent';
  }

  const lines = [
    'FALLBACK HEALTH REPORT',
    `Generated at: ${new Date().toISOString()}`,
    'Reason: Primary 09:30 report was missing by 09:32 deadline',
    `Daily report file: ${reportPath} (${source})`,
    `Telegram delivery: ${telegramStatus}`,
    'Action: Fallback report emitted and watchdog heartbeat updated.'
  ];

  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n');

  // No token = nothing actually delivered. Do NOT mark the day as covered —
  // that would silence the watchdog while Maria received zero messages.
  if (telegramStatus !== 'sent') {
    console.error(`Telegram delivery ${telegramStatus} — report NOT delivered, refusing to mark report as sent`);
    console.error(`Wrote ${OUTPUT_PATH}`);
    process.exit(1);
  }

  // Try to send charts immediately; idempotent sender will only fill gaps.
  execSync(`cd ${WORKSPACE} && /opt/homebrew/bin/node scripts/health-sync/send_daily_charts_telegram.js --no-regenerate`, {
    stdio: 'inherit'
  });

  markReportSent('watchdog_fallback');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(describeError(e));
    process.exit(1);
  });
}

module.exports = { main };
