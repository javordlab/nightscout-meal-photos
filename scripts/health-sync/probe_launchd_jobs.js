#!/usr/bin/env node
/**
 * probe_launchd_jobs.js
 *
 * For every entry in cron_jobs_config.json with source === "launchd", query
 *   launchctl print gui/<uid>/<label>
 * parse state + last exit code + pid + run interval, and write a heartbeat
 * to data/heartbeats/<id>.json using the same shape the cron watchdog
 * expects. This makes LaunchAgent jobs show up on the monitoring dashboard
 * alongside ordinary cron jobs.
 *
 * Run under heartbeat_wrap.js on its own every-5-minute cadence.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { writeReceipt } = require('./cron_receipt');

const WORKSPACE   = '/Users/javier/.openclaw/workspace';
const CONFIG      = path.join(WORKSPACE, 'data/cron_jobs_config.json');
const HEARTBEATS  = path.join(WORKSPACE, 'data/heartbeats');
const UID         = process.getuid();

function launchctlStatus(label) {
  try {
    const out = execSync(`launchctl print gui/${UID}/${label} 2>/dev/null`, {
      encoding: 'utf8', timeout: 5000
    });
    const grab = (re) => {
      const m = out.match(re);
      return m ? m[1].trim() : null;
    };
    // state can be "running", "not running", "waiting", etc. — grab full line.
    const state    = grab(/^\s*state\s*=\s*(.+?)\s*$/m);
    const lastExit = grab(/^\s*last exit code\s*=\s*(\S+)/m);
    const pid      = grab(/^\s*pid\s*=\s*(\S+)/m);
    const interval = grab(/^\s*run interval\s*=\s*(\S+)/m);
    const lastExitNum = lastExit != null ? parseInt(lastExit, 10) : null;
    const pidNum      = pid      != null ? parseInt(pid, 10)      : null;
    const intervalNum = interval != null ? parseInt(interval, 10) : null;
    return {
      found: true,
      state,
      lastExit: Number.isFinite(lastExitNum) ? lastExitNum : null,
      pid:      Number.isFinite(pidNum)      ? pidNum      : null,
      interval: Number.isFinite(intervalNum) ? intervalNum : null,
    };
  } catch (e) {
    return { found: false, err: e.message };
  }
}

function evaluateHealth(r) {
  // launchctl print failing = job isn't even registered with launchd
  if (!r.found) return { healthy: false, reason: `not loaded / launchctl print failed` };
  // Long-running KeepAlive daemons (the claude-bridge family): state=running
  // with a live pid IS healthy — `last exit code` describes the PREVIOUS
  // incarnation (often a deliberate kill during an upgrade), so it must not
  // flag a currently-running process. (2026-06-10: all 4 live bridges were
  // reported unhealthy on a stale lastExit=1.)
  if (/^running/.test(r.state || '') && r.pid) return { healthy: true, reason: null };
  // A periodic StartInterval job sits in state="not running" between fires — that is
  // healthy, what we care about is whether its last invocation exited cleanly.
  const cleanExit = r.lastExit == null || r.lastExit === 0;
  if (!cleanExit) return { healthy: false, reason: `last exit code=${r.lastExit}` };
  return { healthy: true, reason: null };
}

function main() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const jobs = (cfg.jobs || []).filter(j => j && j.source === 'launchd');
  if (!jobs.length) {
    writeReceipt({ status: 'noop', summary: 'no launchd jobs configured', metrics: { total: 0 } });
    return;
  }
  fs.mkdirSync(HEARTBEATS, { recursive: true });
  let ok = 0, bad = 0;
  const badDetails = [];

  for (const j of jobs) {
    const label = j.launchdLabel || j.id;
    const started = Date.now();
    const r = launchctlStatus(label);
    const finished = Date.now();
    const { healthy, reason } = evaluateHealth(r);

    const status   = healthy ? 'ok' : 'error';
    const exitCode = healthy ? 0 : (r.lastExit ?? 1);
    const summary  = healthy
      ? `state=${r.state}` +
        (r.pid      != null ? ` pid=${r.pid}`      : '') +
        (r.interval != null ? ` interval=${r.interval}s` : '') +
        ` lastExit=${r.lastExit ?? 0}`
      : `UNHEALTHY: ${reason}`;

    const hb = {
      jobId: j.id,
      lastRunAtMs:    finished,
      lastFinishAtMs: finished,
      lastDurationMs: finished - started,
      exitCode,
      lastStatus: status,
      consecutiveErrors: 0,
      signal: null,
      spawnError: null,
      outcome: {
        status,
        summary,
        metrics: {
          launchdLabel: label,
          state:        r.state    ?? null,
          lastExitCode: r.lastExit ?? null,
          pid:          r.pid      ?? null,
          intervalSec:  r.interval ?? null,
        },
      },
    };
    fs.writeFileSync(path.join(HEARTBEATS, `${j.id}.json`), JSON.stringify(hb, null, 2));
    if (healthy) ok++;
    else { bad++; badDetails.push(`${j.id}: ${reason}`); }
  }

  const probeStatus = bad === 0 ? 'ok' : (ok > 0 ? 'partial' : 'error');
  writeReceipt({
    status: probeStatus,
    summary: `probed ${jobs.length} launchd job(s) — ${ok} ok, ${bad} unhealthy` +
             (badDetails.length ? ` [${badDetails.join('; ').slice(0, 200)}]` : ''),
    metrics: { total: jobs.length, ok, bad },
  });
  console.log(`probe_launchd_jobs: ${ok} ok / ${bad} unhealthy`);
}

try { main(); }
catch (e) { console.error('probe_launchd_jobs fatal:', e.message); process.exit(1); }
