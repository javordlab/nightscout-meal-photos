#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const { main: generateDailyReport, addDays } = require('../generate_daily_report');
const { markReportSent } = require('./report_watchdog');
const { writeReceipt } = require('./cron_receipt');
const { withNetRetry, describeError } = require('./net_retry');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const STATE_PATH = path.join(DATA_DIR, 'daily_report_delivery_state.json');
const REPORT_STATUS_PATH = path.join(DATA_DIR, 'report_status.json');
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

const TG_MAX_LEN = 4096;

/**
 * Split a long message into chunks that fit Telegram's 4096-char limit.
 * Splits on section boundaries (lines starting with a digit + ')') when possible,
 * falls back to newline boundaries, then hard-cuts as last resort.
 */
function splitMessage(text, maxLen = TG_MAX_LEN) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cutAt = -1;
    // Try to split at a section boundary (e.g. "\n5) ")
    const sectionRe = /\n\d+\)\s/g;
    let match;
    while ((match = sectionRe.exec(remaining)) !== null) {
      if (match.index > 0 && match.index <= maxLen) cutAt = match.index;
    }
    // Fallback: split at last newline within limit
    if (cutAt < 0) {
      cutAt = remaining.lastIndexOf('\n', maxLen);
    }
    // Last resort: hard cut
    if (cutAt <= 0) cutAt = maxLen;

    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }
  return chunks;
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

// Expected CGM cadence is ~288 readings/day (5-min Libre 3). The old version
// failed closed on ANY count outside [200,320], which killed the report for 4
// straight days during a real sensor gap (2026-06-25..28) even though the
// data pipeline was fine. Now:
//   - hard-throw only on logic bugs (wrong target date, count>320 = duplicate
//     rows) or a stale MySQL mirror (data we cannot trust);
//   - a genuinely sparse day with a FRESH mirror returns a warning banner and
//     the report still ships.
const MIRROR_STALE_MS = 2 * 60 * 60 * 1000; // glucose-sync runs every 2 min; 2h = clearly broken

function validateReportWindow(generated) {
  const expectedTarget = addDays(generated.reportDate, -1);
  if (generated.targetDate !== expectedTarget) {
    throw new Error(`invalid_target_date: expected ${expectedTarget}, got ${generated.targetDate}`);
  }

  const count = generated.statsDay ? generated.statsDay.count : null;

  // >320 points in one day means duplicate rows — that's a data bug, fail closed.
  if (Number.isFinite(count) && count > 320) {
    throw new Error(`invalid_stats_day_count:${count} (duplicates?)`);
  }

  const sparse = !generated.statsDay
    || !Number.isFinite(generated.statsDay.average)
    || !Number.isFinite(generated.statsDay.gmi)
    || !Number.isFinite(count)
    || count < 200;
  if (!sparse) return null;

  // Sparse day: only trust it as a real sensor gap if the mirror itself is live.
  const mirrorAgeMs = Number.isFinite(generated.newestSgvAtMs)
    ? Date.now() - generated.newestSgvAtMs
    : Infinity;
  if (mirrorAgeMs > MIRROR_STALE_MS) {
    throw new Error(`glucose_mirror_stale: newest reading ${Math.round(mirrorAgeMs / 60000)}m old, day count=${count}`);
  }

  const n = Number.isFinite(count) ? count : 0;
  return `⚠️ Partial CGM coverage for ${generated.targetDate}: only ${n} readings ` +
         `(expected ~288 — likely a sensor gap or warm-up). Glucose stats below may be unrepresentative.`;
}

function triggerCharts(opts, summary) {
  if (!opts.sendCharts) return;
  const cmd = `cd ${WORKSPACE} && /opt/homebrew/bin/node scripts/health-sync/send_daily_charts_telegram.js --date-la=${opts.reportDateLA}${opts.dryRun ? ' --dry-run' : ''}`;
  execSync(cmd, { stdio: 'inherit' });
  summary.chartsTriggered = true;
  log({ op: 'daily_report_charts_triggered', reportDateLA: opts.reportDateLA, chatId: opts.chatId, dryRun: opts.dryRun });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const botToken = getBotToken();
  if (!botToken) throw new Error('missing_telegram_bot_token');

  const state = readJson(STATE_PATH, { version: 1, chats: {} });
  state.chats[opts.chatId] = state.chats[opts.chatId] || {};
  const alreadySent = state.chats[opts.chatId][opts.reportDateLA];

  // The watchdog fallback records its delivery only in report_status.json, not
  // in this script's ledger. Without this check, a primary fire that lands
  // AFTER the fallback covered the day (launchd replays missed calendar jobs
  // on wake; stale-TZ 23:55 firing on 2026-07-22) re-sends the report Maria
  // already received that morning. --force overrides for manual runs.
  const reportStatus = readJson(REPORT_STATUS_PATH, {});
  const fallbackCovered = !alreadySent && !opts.force
    && reportStatus.lastReportDateLA === opts.reportDateLA;

  const summary = {
    status: 'ok',
    reportDateLA: opts.reportDateLA,
    targetDate: null,
    chatId: opts.chatId,
    reportPath: null,
    reportSent: false,
    chartsTriggered: false,
    skippedReportAlreadySent: false,
    skippedFallbackCovered: false,
    coveredBy: null,
    dryRun: opts.dryRun,
    force: opts.force
  };

  // Both skip paths return BEFORE generateDailyReport — regenerating (and
  // re-running the Coach LLM) for a report that won't be sent is pure waste.
  // Charts still trigger: the chart sender dedupes per-chart, so this only
  // fills gaps (e.g. fallback delivered the text but a chart send failed).
  if (alreadySent && !opts.force) {
    summary.skippedReportAlreadySent = true;
    summary.targetDate = alreadySent.targetDate || null;
    summary.reportPath = alreadySent.reportPath || null;
    log({ op: 'daily_report_skipped_already_sent', reportDateLA: opts.reportDateLA, chatId: opts.chatId });
    triggerCharts(opts, summary);
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  if (fallbackCovered) {
    summary.skippedFallbackCovered = true;
    summary.coveredBy = reportStatus.source || 'unknown';
    log({
      op: 'daily_report_skipped_fallback_covered',
      reportDateLA: opts.reportDateLA,
      chatId: opts.chatId,
      coveredBy: summary.coveredBy,
      lastReportAt: reportStatus.lastReportAt || null
    });
    triggerCharts(opts, summary);
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const generated = await generateDailyReport({ reportDate: opts.reportDateLA });
  const coverageWarning = validateReportWindow(generated);
  if (coverageWarning) console.warn(coverageWarning);
  let reportText = fs.readFileSync(generated.reportPath, 'utf8').trim();
  if (coverageWarning) reportText = `${coverageWarning}\n\n${reportText}`;

  summary.targetDate = generated.targetDate;
  summary.reportPath = generated.reportPath;

  if (opts.dryRun) {
    summary.reportSent = true;
    log({ op: 'daily_report_send_dry_run', reportDateLA: opts.reportDateLA, chatId: opts.chatId, targetDate: generated.targetDate });
  } else {
    const chunks = splitMessage(reportText);
    let messageId = null;
    for (const chunk of chunks) {
      // Retry pre-connection network failures (VPN-tunnel DNS/connect blips) —
      // ~3s/6s/12s/24s backoff. Post-connection errors still fail immediately
      // so a delivered-but-unconfirmed message is never re-sent.
      const sent = await withNetRetry(
        () => sendMessage(botToken, opts.chatId, chunk),
        { attempts: 5, baseMs: 3000, label: 'daily-report sendMessage' }
      );
      if (!messageId) messageId = sent?.result?.message_id || null;
    }

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
    summary.statsDay = state.chats[opts.chatId][opts.reportDateLA].statsDay;

    log({
      op: 'daily_report_sent',
      reportDateLA: opts.reportDateLA,
      targetDate: generated.targetDate,
      chatId: opts.chatId,
      messageId,
      statsDay: state.chats[opts.chatId][opts.reportDateLA].statsDay
    });
  }

  triggerCharts(opts, summary);

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * Turn the script's internal summary object into a cron dashboard receipt.
 * Only called when invoked as main (not when required by report_watchdog.js).
 */
function summaryToReceipt(summary) {
  const stats = summary.messageId && summary.statsDay ? summary.statsDay : null;
  // Stats can be null on a sparse-coverage day that still shipped with a warning banner.
  const statsBits = stats && Number.isFinite(stats.average) && Number.isFinite(stats.gmi) && Number.isFinite(stats.tir)
    ? ` · avg ${Math.round(stats.average)} mg/dL, GMI ${stats.gmi.toFixed(1)}%, TIR ${Math.round(stats.tir)}%`
    : '';

  let status;
  let text;
  if (summary.skippedReportAlreadySent) {
    status = 'noop';
    text = `Report for ${summary.reportDateLA} already sent — skipped`;
  } else if (summary.skippedFallbackCovered) {
    status = 'noop';
    text = `Report for ${summary.reportDateLA} already covered by ${summary.coveredBy} — duplicate send skipped` +
           (summary.chartsTriggered ? ' · charts triggered' : '');
  } else if (summary.dryRun && summary.reportSent) {
    status = 'ok';
    text = `Dry run for ${summary.reportDateLA} (no message sent)`;
  } else if (summary.reportSent && summary.messageId) {
    status = 'ok';
    text = `Report delivered (msg ${summary.messageId}) for ${summary.targetDate}${statsBits}` +
           (summary.chartsTriggered ? ' · charts triggered' : '');
  } else if (summary.reportSent) {
    // reportSent=true but no messageId — unusual but not an error
    status = 'warn';
    text = `Report sent for ${summary.targetDate} but no message_id returned${statsBits}`;
  } else {
    status = 'error';
    text = `Report not sent (reportDateLA=${summary.reportDateLA})`;
  }

  return {
    status,
    summary: text,
    metrics: {
      reportDateLA: summary.reportDateLA,
      targetDate: summary.targetDate,
      chatId: summary.chatId,
      reportSent: summary.reportSent,
      messageId: summary.messageId || null,
      chartsTriggered: summary.chartsTriggered,
      skippedAlreadySent: summary.skippedReportAlreadySent,
      skippedFallbackCovered: summary.skippedFallbackCovered,
      coveredBy: summary.coveredBy,
      dryRun: summary.dryRun,
      statsDay: stats
    }
  };
}

if (require.main === module) {
  main()
    .then((summary) => {
      if (summary) writeReceipt(summaryToReceipt(summary));
    })
    .catch((e) => {
      // describeError: AggregateError (multi-address connect failure) has an
      // EMPTY .message — 2026-07-02 this produced a useless `error:""` log line.
      const msg = describeError(e);
      log({ op: 'daily_report_delivery_error', error: msg, code: e.code || null });
      console.error(msg);
      writeReceipt({
        status: 'error',
        summary: `Daily report delivery crashed: ${msg}`,
        metrics: null
      });
      process.exit(1);
    });
}

module.exports = { main, splitMessage, validateReportWindow };
