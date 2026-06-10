#!/usr/bin/env node
/**
 * cron_health_watchdog.js — Monitor cron job health and alert on staleness.
 *
 * Checks all enabled jobs in jobs.json against their expected run intervals.
 * Sends Telegram DM to Javi (8335333215) if any job is overdue by >2× its interval.
 * Writes status to data/cron_watchdog_status.json.
 *
 * Run: node scripts/health-sync/cron_health_watchdog.js
 */

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const JOBS_CONFIG_PATH = path.join(DATA_DIR, 'cron_jobs_config.json');
const HEARTBEAT_DIR = path.join(DATA_DIR, 'heartbeats');
const REPORT_STATUS_PATH = path.join(DATA_DIR, 'report_status.json');
const OUTPUT_PATH = path.join(DATA_DIR, 'cron_watchdog_status.json');
const OPENCLAW_CONFIG = '/Users/javier/.openclaw/openclaw.json';
const JAVI_CHAT_ID = '8335333215';

// Per-job overrides: max tolerated staleness in ms (default: 2× interval)
// Keys are job name substrings (case-insensitive match)
const STALENESS_OVERRIDES = {
  'photo pipeline':        { maxMs: 10 * 60 * 1000,   label: 'Photo Pipeline' },       // 10 min
  'photo upload retry':    { maxMs: 15 * 60 * 1000,   label: 'Photo Upload Retry' },   // 15 min
  'radial sync':           { maxMs: 60 * 60 * 1000,   label: 'Radial Sync' },          // 1h
  'mysql glucose sync':    { maxMs: 90 * 60 * 1000,   label: 'MySQL Glucose Sync' },   // 1.5h
  'hourly glucose sync':   { maxMs: 2 * 60 * 60 * 1000, label: 'Hourly Glucose Sync' }, // 2h
  'hourly-notion-impact':  { maxMs: 2 * 60 * 60 * 1000, label: 'Hourly Notion Impact' },
  'notion-outcome-backfill': { maxMs: 5 * 60 * 60 * 1000, label: 'Notion Outcome Backfill' }, // 5h
  'notion to mysql':       { maxMs: 10 * 60 * 60 * 1000, label: 'Notion→MySQL Sync' }, // 10h
  'mysql daily backup':    { maxMs: 4 * 60 * 60 * 1000, label: 'MySQL Daily Backup' }, // 4h after window
  'daily-log-review':      { maxMs: 3 * 60 * 60 * 1000, label: 'Daily Log Review' },
  'health-sync-daily-audit': { maxMs: 3 * 60 * 60 * 1000, label: 'Health Sync Audit' },
};

const { sendAlert } = require('./telegram_alert');

function sendTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Parse one cron field into a Set of valid integer values, or null for "any" (*). */
function parseCronField(field, min, max) {
  if (field === '*') return null;
  const values = new Set();
  for (const part of field.split(',')) {
    // step form: */n  or  a-b/n
    const stepMatch = part.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[4], 10);
      const lo = stepMatch[1] === '*' ? min : parseInt(stepMatch[2], 10);
      const hi = stepMatch[1] === '*' ? max : parseInt(stepMatch[3], 10);
      for (let i = lo; i <= hi; i += step) values.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      for (let i = lo; i <= hi; i++) values.add(i);
      continue;
    }
    if (/^\d+$/.test(part)) {
      values.add(parseInt(part, 10));
      continue;
    }
    return null; // unsupported syntax
  }
  return values;
}

/**
 * Compute the next cron fire time strictly after `from` (local time).
 * Supports minute + hour + dom/month/dow = * (sufficient for our crontab).
 * Returns ms since epoch, or null if unparseable.
 */
function nextCronTime(expr, from) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  // We only require dom/mon/dow = * for our crontab.
  if (parts[2] !== '*' || parts[3] !== '*' || parts[4] !== '*') return null;

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after `from`
  // Iterate up to 2 days of minutes — covers any daily schedule.
  for (let i = 0; i < 2 * 24 * 60; i++) {
    const mn = d.getMinutes();
    const hr = d.getHours();
    if ((!minutes || minutes.has(mn)) && (!hours || hours.has(hr))) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/**
 * Load monitored jobs from cron_jobs_config.json + per-job heartbeat files.
 * Returns job objects shaped like the old OpenClaw jobs.json entries, so the
 * existing buildJobInfo / checkStaleness pipeline can consume them unchanged.
 */
function loadJobs() {
  const config = JSON.parse(fs.readFileSync(JOBS_CONFIG_PATH, 'utf8'));
  const now = Date.now();
  const nowDate = new Date(now);

  // Jobs flagged `retired: true` are not actively scheduled — keep the config
  // entry as a paper trail but don't include them in liveness checks or alerts.
  return config.jobs.filter(cfg => !cfg.retired).map(cfg => {
    const state = {
      lastRunAtMs: null,
      lastFinishAtMs: null,
      nextRunAtMs: null,
      lastStatus: null,
      lastDurationMs: null,
      consecutiveErrors: 0,
      outcome: null
    };

    // Heartbeat — written by heartbeat_wrap.js after every wrapped run.
    try {
      const hbPath = path.join(HEARTBEAT_DIR, cfg.id + '.json');
      const hb = JSON.parse(fs.readFileSync(hbPath, 'utf8'));
      state.lastRunAtMs = hb.lastFinishAtMs || hb.lastRunAtMs || null;
      state.lastFinishAtMs = hb.lastFinishAtMs || null;
      state.lastStatus = hb.lastStatus || null;
      state.lastDurationMs = Number.isFinite(hb.lastDurationMs) ? hb.lastDurationMs : null;
      state.consecutiveErrors = Number.isFinite(hb.consecutiveErrors) ? hb.consecutiveErrors : 0;
      state.outcome = hb.outcome || null;
      state.exitCode = Number.isFinite(hb.exitCode) ? hb.exitCode : null;
    } catch {
      // no heartbeat yet — job will show as "never-run" until it fires once
    }

    state.nextRunAtMs = nextCronTime(cfg.cronExpr, nowDate);

    return {
      id: cfg.id,
      name: cfg.name,
      enabled: true,
      schedule: { kind: 'cron', expr: cfg.cronExpr },
      staleMaxMs: cfg.staleMaxMs || null,
      maxDurationMs: cfg.maxDurationMs || null,
      state
    };
  });
}

/** Determine expected interval in ms for a job */
function getIntervalMs(job) {
  const sched = job.schedule;
  if (!sched) return null;
  if (sched.kind === 'every') return sched.everyMs;
  if (sched.kind === 'cron') {
    // Derive from two successive FUTURE ticks of the expression. (The previous
    // `next - last` derivation returned garbage for long-dead jobs: a job last
    // run 49 days ago got a 49-day "interval", so 2× grace = 98 days.)
    const expr = sched.expr || '';
    const n1 = nextCronTime(expr, new Date());
    if (n1) {
      const n2 = nextCronTime(expr, new Date(n1));
      if (n2 && n2 > n1) return n2 - n1;
    }
    if (expr === '*/30 * * * *') return 30 * 60 * 1000;
    if (expr === '0 * * * *') return 60 * 60 * 1000;
    if (expr === '0 */4 * * *') return 4 * 60 * 60 * 1000;
    if (/^\d+ \d+ \* \* \*$/.test(expr)) return 24 * 60 * 60 * 1000; // once daily
    return null;
  }
  return null;
}

/**
 * Find override config for a job.
 * Prefers explicit per-job staleMaxMs from cron_jobs_config.json, falls back
 * to name-substring match against the legacy STALENESS_OVERRIDES table.
 */
function getOverride(job) {
  if (job && typeof job === 'object' && Number.isFinite(job.staleMaxMs)) {
    return { maxMs: job.staleMaxMs, label: job.name };
  }
  const name = (typeof job === 'string' ? job : job?.name || '').toLowerCase();
  for (const [key, val] of Object.entries(STALENESS_OVERRIDES)) {
    if (name.includes(key)) return val;
  }
  return null;
}

function checkStaleness(job, now) {
  const { state } = job;
  const lastRun = state.lastRunAtMs || state.lastRunAt || null;
  if (!lastRun) return null; // never run, skip

  const override = getOverride(job);
  const intervalMs = getIntervalMs(job);

  // Stale = the last heartbeat is older than the tolerated maximum age.
  //
  // BUG FIX (2026-06-10): the previous implementation keyed off
  // state.nextRunAtMs — but loadJobs() computes that from *now*, so it is
  // always in the future and the early-return "scheduled in future, healthy"
  // made this entire function unreachable for every validly-scheduled job.
  // Net effect: staleness detection NEVER fired (rescue-pending-photos was
  // dead 49 days, reported healthy throughout). Only age-since-last-run is a
  // valid liveness signal here.
  let maxAgeMs;
  if (override) {
    // staleMaxMs from config is the tolerated age of the last heartbeat;
    // add one interval so a job isn't flagged mid-cycle.
    maxAgeMs = override.maxMs + (intervalMs || 0);
  } else if (intervalMs) {
    maxAgeMs = Math.max(intervalMs * 2, 10 * 60 * 1000); // 2× interval, ≥10m
  } else {
    return null; // no signal to judge by
  }

  const ageMs = now - lastRun;
  if (ageMs > maxAgeMs) {
    return {
      jobId: job.id,
      name: override?.label || job.name,
      overdueMin: Math.round((ageMs - maxAgeMs) / 60000),
      graceMin: Math.round(maxAgeMs / 60000),
      lastRunAtMs: lastRun,
      nextRunAtMs: state.nextRunAtMs || null,
      consecutiveErrors: state.consecutiveErrors || 0,
      lastStatus: state.lastStatus || state.lastRunStatus || 'unknown'
    };
  }
  return null;
}

/** Format schedule as human-readable string */
function formatSchedule(sched) {
  if (!sched) return '?';
  if (sched.kind === 'every') {
    const m = sched.everyMs / 60000;
    if (m < 60) return `every ${m}m`;
    return `every ${m / 60}h`;
  }
  if (sched.kind === 'cron') {
    const e = sched.expr || '';
    if (e === '*/30 * * * *') return 'every 30m';
    if (e === '0 * * * *') return 'every 1h';
    if (e === '0 */4 * * *') return 'every 4h';
    const dailyMatch = e.match(/^(\d+) (\d+) \* \* \*$/);
    if (dailyMatch) return `daily ${dailyMatch[2]}:${dailyMatch[1].padStart(2,'0')} PT`;
    return e;
  }
  return sched.kind;
}

/** Build full status record for a single job (healthy or not) */
function buildJobInfo(job, now) {
  const { state } = job;
  const override = getOverride(job);
  const lastRun = state.lastRunAtMs || state.lastRunAt || null;
  const nextRun = state.nextRunAtMs || null;
  const intervalMs = getIntervalMs(job);
  const staleResult = checkStaleness(job, now);
  const hasErrors = (state.consecutiveErrors || 0) > 0;
  const outcome = state.outcome || null;
  const outcomeStatus = outcome?.status || null;

  // Duration threshold: the script finished, but took too long
  const durationWarn =
    Number.isFinite(job.maxDurationMs) &&
    Number.isFinite(state.lastDurationMs) &&
    state.lastDurationMs > job.maxDurationMs;

  // Unified status derivation — combines liveness, outcome, duration
  let status;
  if (!lastRun) {
    status = 'never-run';
  } else if (staleResult) {
    status = hasErrors || outcomeStatus === 'error' ? 'error' : 'overdue';
  } else if (hasErrors || outcomeStatus === 'error') {
    status = 'error';
  } else if (outcomeStatus === 'partial' || outcomeStatus === 'warn' || durationWarn) {
    status = 'warning';
  } else {
    status = 'healthy';
  }

  return {
    id: job.id,
    name: override?.label || job.name,
    status,
    schedule: formatSchedule(job.schedule),
    intervalMs: intervalMs || null,
    lastRunAtMs: lastRun,
    nextRunAtMs: nextRun,
    consecutiveErrors: state.consecutiveErrors || 0,
    lastStatus: state.lastStatus || state.lastRunStatus || null,
    lastDurationMs: state.lastDurationMs || null,
    maxDurationMs: job.maxDurationMs || null,
    durationWarn: durationWarn || false,
    outcome: outcome,
    exitCode: state.exitCode ?? null,
    overdueMin: staleResult?.overdueMin || null,
    graceMin: staleResult?.graceMin || null
  };
}

/**
 * Reconcile `crontab -l` against cron_jobs_config.json.
 *
 * Catches the class of bug where a job was "migrated" or "installed" but the
 * crontab entry was never actually added (or was added without being
 * registered in the config, so the watchdog never notices it's missing).
 *
 * Extracts job IDs from lines matching `heartbeat_wrap.js <id> --`. Compares
 * both sets + cron expressions, and returns a list of drift issues.
 *
 * Returns null if crontab cannot be read (sandboxed env). Empty array = clean.
 */
function reconcileCrontabAgainstConfig() {
  let crontabRaw;
  try {
    crontabRaw = execSync('crontab -l 2>&1', { encoding: 'utf8', timeout: 5000 });
  } catch {
    return null; // crontab unavailable — don't false-alarm
  }
  if (/no crontab|command not found/i.test(crontabRaw)) return null;

  // id → { cronExpr, rawLine }  for every heartbeat-wrapped entry in crontab
  const crontabJobs = new Map();
  for (const rawLine of crontabRaw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Split first 5 whitespace-separated tokens as the cron expression, rest is command
    const m = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/);
    if (!m) continue;
    const cronExpr = m[1];
    const command = m[2];
    // Multiple heartbeat_wrap.js invocations can be chained in one crontab line
    // (e.g. the 5,35 * * * * line chains 3 jobs with &&). Extract each id.
    const idRegex = /heartbeat_wrap\.js\s+([a-z][a-z0-9-]*)\s+--/gi;
    let match;
    while ((match = idRegex.exec(command)) !== null) {
      const id = match[1];
      if (!crontabJobs.has(id)) {
        crontabJobs.set(id, { cronExpr, rawLine: line });
      }
    }
  }

  const config = JSON.parse(fs.readFileSync(JOBS_CONFIG_PATH, 'utf8'));
  // Same exclusion as buildJobInfo — retired jobs are paper trail only.
  const configJobs = new Map(config.jobs.filter(j => !j.retired).map(j => [j.id, j]));

  const issues = [];

  // (1) In config but missing from crontab → unscheduled
  //     Skip entries with source === 'launchd' — they're launchd plists, not crontab.
  for (const [id, cfg] of configJobs) {
    if (cfg.source === 'launchd') continue;
    if (!crontabJobs.has(id)) {
      issues.push({
        kind: 'unscheduled',
        id,
        detail: `declared in cron_jobs_config.json (${cfg.cronExpr}) but no matching crontab entry`
      });
    }
  }

  // (2) In crontab but not in config → unmonitored
  for (const [id, entry] of crontabJobs) {
    if (!configJobs.has(id)) {
      issues.push({
        kind: 'unmonitored',
        id,
        detail: `scheduled in crontab (${entry.cronExpr}) but not in cron_jobs_config.json — watchdog cannot monitor it`
      });
    }
  }

  // (3) Both sides have it but cronExpr differs → drift
  for (const [id, cfg] of configJobs) {
    const entry = crontabJobs.get(id);
    if (!entry) continue;
    if (entry.cronExpr !== cfg.cronExpr) {
      issues.push({
        kind: 'schedule-drift',
        id,
        detail: `config says \`${cfg.cronExpr}\`, crontab says \`${entry.cronExpr}\``
      });
    }
  }

  return issues;
}

function checkDailyReport(now) {
  if (!fs.existsSync(REPORT_STATUS_PATH)) return null;
  try {
    const status = JSON.parse(fs.readFileSync(REPORT_STATUS_PATH, 'utf8'));
    // Daily report expected by 9:30 AM PT; alert if it's after 11:30 AM and no report today
    const nowLA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })
      .format(new Date(now));
    if (status.lastReportDateLA !== nowLA) {
      // Check if it's past 11:30 AM PT
      const hourLA = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false
      }).format(new Date(now)), 10);
      if (hourLA >= 11) {
        const lastReportAgo = now - new Date(status.lastReportAt).getTime();
        const hoursAgo = Math.round(lastReportAgo / 3600000);
        return {
          name: 'Daily Health Report',
          detail: `No report sent today (${nowLA}). Last report: ${status.lastReportDateLA} (${hoursAgo}h ago). Source: ${status.source || 'unknown'}`
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

async function main() {
  const now = Date.now();

  let jobs;
  try {
    jobs = loadJobs();
  } catch (err) {
    console.error(`[watchdog] Failed to load jobs.json: ${err.message}`);
    process.exit(1);
  }

  const allJobs = jobs.map(j => buildJobInfo(j, now));
  const stale = allJobs.filter(j => j.status === 'overdue' || j.status === 'error');

  // Check daily report separately
  const reportIssue = checkDailyReport(now);

  // Reconcile crontab ↔ config to catch unscheduled/unmonitored/drifted jobs
  let driftIssues = null;
  try {
    driftIssues = reconcileCrontabAgainstConfig();
  } catch (e) {
    console.warn('[watchdog] crontab reconciliation failed:', e.message);
  }

  // Check gh-pages staleness: notion_meals.json should not be older than 2 hours
  let ghPagesIssue = null;
  try {
    const notionMealsPath = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';
    const backupsPath = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/backups.json';
    if (fs.existsSync(notionMealsPath)) {
      const mtime = fs.statSync(notionMealsPath).mtimeMs;
      const ageMin = (now - mtime) / 60000;
      if (ageMin > 120) ghPagesIssue = `notion_meals.json stale by ${Math.round(ageMin)}m`;
    }
    if (!ghPagesIssue && fs.existsSync(backupsPath)) {
      const bdata = JSON.parse(fs.readFileSync(backupsPath, 'utf8'));
      const lastUpdated = new Date(bdata.lastUpdated || 0).getTime();
      const ageMin = (now - lastUpdated) / 60000;
      if (ageMin > 70) ghPagesIssue = `backups.json glucose data stale by ${Math.round(ageMin)}m`;
    }
  } catch (e) {
    console.warn('[watchdog] gh-pages staleness check failed:', e.message);
  }

  // Write status file
  const statusOut = {
    checkedAt: new Date(now).toISOString(),
    jobsChecked: jobs.length,
    jobs: allJobs,
    staleJobs: stale,
    dailyReportIssue: reportIssue || null,
    ghPagesIssue: ghPagesIssue || null,
    driftIssues: driftIssues || null,
    alertSent: false
  };

  const driftCount = Array.isArray(driftIssues) ? driftIssues.length : 0;
  const issues = stale.length + (reportIssue ? 1 : 0) + (ghPagesIssue ? 1 : 0) + driftCount;

  // Build a stable fingerprint of the current issue set.
  // Alert only if fingerprint changed OR last alert was >4h ago (prevents silent re-fires).
  const ALERT_STATE_PATH = path.join(DATA_DIR, 'watchdog_alert_state.json');
  const RESEND_AFTER_MS = 4 * 60 * 60 * 1000; // 4 hours
  let alertState = { fingerprint: null, lastAlertAt: 0 };
  try {
    if (fs.existsSync(ALERT_STATE_PATH)) {
      alertState = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf8'));
    }
  } catch { /* start fresh if corrupt */ }

  if (issues > 0) {
    const lines = ['⚠️ *Cron Health Alert*', ''];

    for (const s of stale) {
      const bits = [];
      if (s.overdueMin) bits.push(`overdue by ${s.overdueMin}m (grace: ${s.graceMin}m)`);
      if (s.outcome && s.outcome.status && s.outcome.status !== 'ok') {
        const summary = s.outcome.summary ? ` — ${s.outcome.summary}` : '';
        bits.push(`outcome: ${s.outcome.status}${summary}`);
      }
      if (s.consecutiveErrors > 0) {
        const exitHint = (s.exitCode != null && s.exitCode !== 0 && !(s.outcome && s.outcome.summary))
          ? ` (exit ${s.exitCode})` : '';
        bits.push(`❌ ${s.consecutiveErrors} consecutive errors${exitHint}`);
      }
      if (s.durationWarn) bits.push(`slow: ${Math.round(s.lastDurationMs/1000)}s > ${Math.round(s.maxDurationMs/1000)}s`);
      if (bits.length === 0) bits.push('error');
      lines.push(`• *${s.name}*: ${bits.join(' · ')}`);
    }

    if (reportIssue) {
      lines.push(`• *${reportIssue.name}*: ${reportIssue.detail}`);
    }

    if (ghPagesIssue) {
      lines.push(`• *gh-pages*: ${ghPagesIssue}`);
    }

    if (driftCount > 0) {
      lines.push('');
      lines.push('🚨 *Cron ↔ Config Drift*');
      for (const d of driftIssues) {
        const icon = d.kind === 'unscheduled' ? '❌'
                   : d.kind === 'unmonitored' ? '👻'
                   : '⚠️';
        lines.push(`${icon} \`${d.id}\` (${d.kind}): ${d.detail}`);
      }
    }

    const message = lines.join('\n');

    // Fingerprint = sorted list of issue identifiers (job ids + detail text)
    const fingerprintParts = [
      ...stale.map(s => `job:${s.id}:${s.consecutiveErrors}`),
      reportIssue ? `report:${reportIssue.detail}` : null,
      ghPagesIssue ? `ghpages:${ghPagesIssue}` : null,
      ...(driftIssues || []).map(d => `drift:${d.id}:${d.kind}`),
    ].filter(Boolean).sort();
    const fingerprint = fingerprintParts.join('|');

    const sinceLastAlert = now - (alertState.lastAlertAt || 0);
    const changed = fingerprint !== alertState.fingerprint;
    const forceResend = sinceLastAlert > RESEND_AFTER_MS;

    if (changed || forceResend) {
      console.log(`[watchdog] ${issues} issue(s) found. Sending alert (changed=${changed}, forceResend=${forceResend}).`);
      console.log(message);
      try {
        // sendAlert resolves {ok:false} on failure — it never rejects. Check ok
        // explicitly, and retry without parse_mode: job summaries can contain
        // underscores (script names) that break Telegram's Markdown parser.
        let r = await sendAlert(message);
        if (!r.ok) {
          console.warn(`[watchdog] Markdown send failed (${r.description || r.error || '?'}); retrying as plain text.`);
          r = await sendAlert(message.replace(/[*`]/g, ''), undefined, { parseMode: null });
        }
        if (!r.ok) throw new Error(r.description || r.error || 'sendMessage failed');
        statusOut.alertSent = true;
        alertState = { fingerprint, lastAlertAt: now };
        fs.writeFileSync(ALERT_STATE_PATH, JSON.stringify(alertState, null, 2));
        console.log('[watchdog] Alert sent via Telegram.');
      } catch (err) {
        // Don't persist the fingerprint — a failed send must retry next tick.
        console.error(`[watchdog] Telegram send failed: ${err.message}`);
      }
    } else {
      console.log(`[watchdog] ${issues} issue(s) found but fingerprint unchanged — suppressing duplicate alert (last sent ${Math.round(sinceLastAlert / 60000)}m ago).`);
    }
  } else {
    // Issues cleared — reset fingerprint so next issue fires fresh
    if (alertState.fingerprint) {
      alertState = { fingerprint: null, lastAlertAt: 0 };
      fs.writeFileSync(ALERT_STATE_PATH, JSON.stringify(alertState, null, 2));
    }
    console.log(`[watchdog] All ${jobs.length} jobs healthy.`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(statusOut, null, 2));
}

main().catch(err => {
  console.error(`[watchdog] Fatal: ${err.message}`);
  process.exit(1);
});
