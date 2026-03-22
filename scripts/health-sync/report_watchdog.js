#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const STATUS_PATH = path.join(WORKSPACE, 'data', 'report_status.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'report_watchdog.log.jsonl');
const ALERT_PATH = path.join(WORKSPACE, 'data', 'report_watchdog_alert.json');

function log(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function loadStatus() {
  if (!fs.existsSync(STATUS_PATH)) {
    return { version: 1, lastReportAt: null, lastReportDateLA: null, source: null, fallbackSentAt: null };
  }
  return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
}

function saveStatus(status) {
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2) + '\n');
}

function nowInLosAngeles() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function markReportSent(source = 'unknown') {
  const status = loadStatus();
  const la = nowInLosAngeles();

  status.lastReportAt = new Date().toISOString();
  status.lastReportDateLA = la.date;
  status.source = source;
  status.fallbackSentAt = null;

  saveStatus(status);
  log({ op: 'report_marked_sent', source, dateLA: la.date });
  console.log(`Marked report sent for ${la.date} (${source})`);
}

function runFallback(la) {
  const fallbackCmd = process.env.REPORT_FALLBACK_CMD || '';
  if (!fallbackCmd.trim()) {
    log({ op: 'fallback_skipped_no_command', dateLA: la.date });
    return false;
  }

  try {
    execSync(fallbackCmd, { stdio: 'inherit', timeout: 120000 });

    // Preserve any report heartbeat updates done by fallback command.
    const latest = loadStatus();
    latest.fallbackSentAt = new Date().toISOString();
    saveStatus(latest);

    log({ op: 'fallback_sent', dateLA: la.date, command: fallbackCmd });
    return true;
  } catch (error) {
    log({ op: 'fallback_error', dateLA: la.date, error: error.message });
    return false;
  }
}

function checkReportDeadline() {
  const status = loadStatus();
  const la = nowInLosAngeles();

  const isPastDeadline = la.hour > 9 || (la.hour === 9 && la.minute >= 32);
  const isCurrentDateCovered = status.lastReportDateLA === la.date;

  if (!isPastDeadline) {
    log({ op: 'watchdog_check_pre_deadline', dateLA: la.date, time: `${la.hour}:${String(la.minute).padStart(2, '0')}` });
    console.log('Watchdog check: before 09:32 PT deadline.');
    return { ok: true, state: 'pre_deadline' };
  }

  if (isCurrentDateCovered) {
    log({ op: 'watchdog_check_ok', dateLA: la.date, lastReportAt: status.lastReportAt });
    console.log('Watchdog check: report present for today.');
    return { ok: true, state: 'report_present' };
  }

  const fallbackTriggered = runFallback(la);
  const alert = {
    generatedAt: new Date().toISOString(),
    severity: 'critical',
    reason: 'missing_0930_report',
    dateLA: la.date,
    lastReportAt: status.lastReportAt,
    fallbackTriggered
  };

  fs.writeFileSync(ALERT_PATH, JSON.stringify(alert, null, 2) + '\n');
  log({ op: 'watchdog_alert', ...alert });
  console.error('CRITICAL: 09:30 report missing; alert emitted.');
  return { ok: false, state: 'missing_report', fallbackTriggered };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--mark-sent')) {
    const sourceArg = args.find(a => a.startsWith('--source='));
    const source = sourceArg ? sourceArg.split('=')[1] : 'manual';
    markReportSent(source);
    process.exit(0);
  }

  const result = checkReportDeadline();
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  markReportSent,
  checkReportDeadline
};
