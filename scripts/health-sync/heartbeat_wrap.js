#!/usr/bin/env node
/**
 * heartbeat_wrap.js — Run a command and record a heartbeat for the cron dashboard.
 *
 * Usage:
 *   node heartbeat_wrap.js <job-id> -- <command> [args...]
 *
 * Writes /Users/javier/.openclaw/workspace/data/heartbeats/<job-id>.json with:
 *   { jobId, lastRunAtMs, lastFinishAtMs, lastDurationMs, exitCode, lastStatus,
 *     consecutiveErrors, signal }
 *
 * Preserves the wrapped command's exit code so shell `&&` chains still work.
 * stdin/stdout/stderr are inherited — log output is unchanged.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HEARTBEAT_DIR = '/Users/javier/.openclaw/workspace/data/heartbeats';

/**
 * Receipt protocol:
 *   Wrapper sets CRON_RECEIPT_FILE in the child env. Any script that wants to
 *   report "did my purpose succeed?" writes JSON to that file before exiting:
 *     { status: "ok"|"partial"|"warn"|"error"|"noop",
 *       summary: "human-readable one-liner",
 *       metrics: { ...arbitrary counters... } }
 *   After the child exits the wrapper reads + deletes the file and merges the
 *   content into the heartbeat as `outcome`. Scripts that don't write a
 *   receipt continue to work — they fall back to exit-code-only monitoring.
 */
const VALID_OUTCOME_STATUSES = new Set(['ok', 'partial', 'warn', 'error', 'noop']);

function usage(msg) {
  if (msg) console.error('[heartbeat_wrap] ' + msg);
  console.error('usage: heartbeat_wrap.js <job-id> -- <command> [args...]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const sepIdx = argv.indexOf('--');
if (sepIdx < 1) usage('missing "--" separator');
const jobId = argv[0];
if (!jobId || sepIdx !== 1) usage('bad arguments');
const cmd = argv[sepIdx + 1];
const cmdArgs = argv.slice(sepIdx + 2);
if (!cmd) usage('missing command');
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(jobId)) usage('invalid job id: ' + jobId);

const heartbeatPath = path.join(HEARTBEAT_DIR, jobId + '.json');

function readPrevConsecutiveErrors() {
  try {
    const prev = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8'));
    return Number.isFinite(prev.consecutiveErrors) ? prev.consecutiveErrors : 0;
  } catch {
    return 0;
  }
}

function writeHeartbeat(payload) {
  try {
    fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
    fs.writeFileSync(heartbeatPath, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('[heartbeat_wrap] failed to write heartbeat:', e.message);
  }
}

function readReceipt(receiptPath) {
  try {
    if (!fs.existsSync(receiptPath)) return null;
    const raw = fs.readFileSync(receiptPath, 'utf8');
    const parsed = JSON.parse(raw);
    // Normalize: only keep known fields; enforce status enum
    const status = VALID_OUTCOME_STATUSES.has(parsed.status) ? parsed.status : 'warn';
    return {
      status,
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : null,
      metrics: (parsed.metrics && typeof parsed.metrics === 'object') ? parsed.metrics : null
    };
  } catch (e) {
    console.error('[heartbeat_wrap] failed to read receipt:', e.message);
    return { status: 'warn', summary: 'receipt unreadable: ' + e.message, metrics: null };
  } finally {
    try { fs.unlinkSync(receiptPath); } catch { /* best effort */ }
  }
}

const prevErrors = readPrevConsecutiveErrors();
const startMs = Date.now();
const receiptPath = path.join(os.tmpdir(), `cron-receipt-${jobId}-${process.pid}.json`);
try { fs.unlinkSync(receiptPath); } catch { /* no prior */ }

let settled = false;

function finalize({ exitCode, signal, spawnError }) {
  if (settled) return;
  settled = true;
  const finishMs = Date.now();
  const spawnOk = exitCode === 0 && !signal && !spawnError;
  const outcome = readReceipt(receiptPath); // may be null if script didn't write one

  // Derive overall lastStatus: exit code dominates, then outcome, then default ok.
  let lastStatus;
  if (!spawnOk) lastStatus = 'error';
  else if (outcome && outcome.status === 'error') lastStatus = 'error';
  else if (outcome && (outcome.status === 'partial' || outcome.status === 'warn')) lastStatus = 'warn';
  else lastStatus = 'ok';

  const healthy = lastStatus === 'ok';

  const payload = {
    jobId,
    lastRunAtMs: startMs,
    lastFinishAtMs: finishMs,
    lastDurationMs: finishMs - startMs,
    exitCode: spawnError ? 127 : (exitCode == null ? 128 : exitCode),
    lastStatus,
    consecutiveErrors: healthy ? 0 : (prevErrors + 1),
    signal: signal || null,
    spawnError: spawnError ? String(spawnError.message || spawnError) : null,
    outcome: outcome || null
  };
  writeHeartbeat(payload);
  process.exit(payload.exitCode);
}

const child = spawn(cmd, cmdArgs, {
  stdio: 'inherit',
  env: { ...process.env, CRON_RECEIPT_FILE: receiptPath }
});
child.on('error', err => finalize({ exitCode: 127, signal: null, spawnError: err }));
child.on('exit', (code, signal) => finalize({ exitCode: code, signal, spawnError: null }));
