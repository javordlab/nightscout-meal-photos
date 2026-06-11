#!/usr/bin/env node
/**
 * heartbeat_wrap.js — Run a command and record a heartbeat for the cron dashboard.
 *
 * Usage:
 *   node heartbeat_wrap.js <job-id> [--timeout-ms=N] -- <command> [args...]
 *
 * Writes /Users/javier/.openclaw/workspace/data/heartbeats/<job-id>.json with:
 *   { jobId, lastRunAtMs, lastFinishAtMs, lastDurationMs, exitCode, lastStatus,
 *     consecutiveErrors, signal, timedOut }
 *
 * Optional --timeout-ms=N (flag absent = no timeout, current behavior): SIGTERM
 * the child at N ms, SIGKILL 10s later if still alive; heartbeat records
 * exitCode 124 + timedOut:true.
 *
 * Overlap lock: data/heartbeats/<job-id>.lock holds the wrapper pid. If a lock
 * exists and that pid is still alive, this run exits 0 immediately with only a
 * stderr log line — the in-flight run's heartbeat is left untouched (writing a
 * noop receipt would clobber the real run's heartbeat). Stale locks (dead pid)
 * are removed automatically.
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
  console.error('usage: heartbeat_wrap.js <job-id> [--timeout-ms=N] -- <command> [args...]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const sepIdx = argv.indexOf('--');
if (sepIdx < 1) usage('missing "--" separator');
const jobId = argv[0];
if (!jobId) usage('bad arguments');
// Optional flags between the job id and `--`. Only --timeout-ms is recognized;
// anything else is a hard usage error (typos must not silently change behavior).
let timeoutMs = null;
for (const flag of argv.slice(1, sepIdx)) {
  const m = /^--timeout-ms=(\d+)$/.exec(flag);
  if (!m) usage('unknown argument before "--": ' + flag);
  timeoutMs = parseInt(m[1], 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) usage('bad --timeout-ms value: ' + flag);
}
const cmd = argv[sepIdx + 1];
const cmdArgs = argv.slice(sepIdx + 2);
if (!cmd) usage('missing command');
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(jobId)) usage('invalid job id: ' + jobId);

const heartbeatPath = path.join(HEARTBEAT_DIR, jobId + '.json');
const lockPath = path.join(HEARTBEAT_DIR, jobId + '.lock');

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

// ─── Overlap lock ────────────────────────────────────────────────────────────
// One wrapper per jobId at a time. The lockfile holds the owning wrapper's pid.
// On overlap we exit 0 with a log line ONLY — deliberately no heartbeat/receipt
// write, because the heartbeat file is replaced wholesale on every write and a
// noop payload here would clobber the in-flight run's real heartbeat.

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // EPERM = alive but not ours
}

let lockAcquired = false;
try {
  fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
  let existingPid = null;
  try { existingPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10); } catch { /* no lock */ }
  if (existingPid != null) {
    if (Number.isFinite(existingPid) && pidAlive(existingPid)) {
      console.error(`[heartbeat_wrap] ${jobId}: previous run still active (pid ${existingPid}) — skipping this run`);
      process.exit(0);
    }
    // Stale lock (dead pid or garbage content) — remove and proceed.
    try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
  }
  fs.writeFileSync(lockPath, String(process.pid));
  lockAcquired = true;
} catch (e) {
  // Lock plumbing must never block the job itself — run unlocked on failure.
  console.error('[heartbeat_wrap] lock handling failed (continuing unlocked):', e.message);
}

function releaseLock() {
  if (!lockAcquired) return;
  try {
    // Only remove the lock if it's still ours (guards against a racing
    // stale-lock cleanup having replaced it).
    if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(lockPath);
    }
  } catch { /* best effort */ }
}

// Safety net: release the lock on any exit path (idempotent — finalize also
// releases explicitly before process.exit). A wrapper killed by an external
// signal still leaves the lock, but the dead-pid check clears it next run.
process.on('exit', releaseLock);

const prevErrors = readPrevConsecutiveErrors();
const startMs = Date.now();
const receiptPath = path.join(os.tmpdir(), `cron-receipt-${jobId}-${process.pid}.json`);
try { fs.unlinkSync(receiptPath); } catch { /* no prior */ }

let settled = false;
let timedOut = false;
let termTimer = null;
let killTimer = null;

function finalize({ exitCode, signal, spawnError }) {
  if (settled) return;
  settled = true;
  if (termTimer) clearTimeout(termTimer);
  if (killTimer) clearTimeout(killTimer);
  const finishMs = Date.now();
  const spawnOk = exitCode === 0 && !signal && !spawnError && !timedOut;
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
    // 124 = conventional timeout exit code (matches GNU timeout(1)).
    exitCode: spawnError ? 127 : (timedOut ? 124 : (exitCode == null ? 128 : exitCode)),
    lastStatus,
    consecutiveErrors: healthy ? 0 : (prevErrors + 1),
    signal: signal || null,
    timedOut,
    spawnError: spawnError ? String(spawnError.message || spawnError) : null,
    outcome: outcome || null
  };
  writeHeartbeat(payload);
  releaseLock();
  process.exit(payload.exitCode);
}

const child = spawn(cmd, cmdArgs, {
  stdio: 'inherit',
  env: { ...process.env, CRON_RECEIPT_FILE: receiptPath }
});
child.on('error', err => finalize({ exitCode: 127, signal: null, spawnError: err }));
child.on('exit', (code, signal) => finalize({ exitCode: code, signal, spawnError: null }));

if (timeoutMs != null) {
  termTimer = setTimeout(() => {
    timedOut = true;
    console.error(`[heartbeat_wrap] ${jobId}: timeout after ${timeoutMs}ms — sending SIGTERM`);
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    // Escalate if the child ignores SIGTERM.
    killTimer = setTimeout(() => {
      console.error(`[heartbeat_wrap] ${jobId}: still alive 10s after SIGTERM — sending SIGKILL`);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, 10_000);
  }, timeoutMs);
}
