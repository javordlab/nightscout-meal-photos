#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const HEALTH_LOG = path.join(WORKSPACE, 'health_log.md');
const STATE_PATH = path.join(WORKSPACE, 'data', 'post_log_sync_state.json');
const LOG_PATH = path.join(WORKSPACE, 'data', 'post_log_sync.log.jsonl');
const LOCK_PATH = path.join(WORKSPACE, 'data', 'sync.lock');

const DEBOUNCE_MS = Number(process.env.POST_LOG_SYNC_DEBOUNCE_MS || 45_000);
const LOCK_WAIT_MS = Number(process.env.POST_LOG_SYNC_LOCK_WAIT_MS || 90_000);
const LOCK_POLL_MS = Number(process.env.POST_LOG_SYNC_LOCK_POLL_MS || 5_000);

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return {
      lastSyncedMtimeMs: 0,
      lastAttemptMtimeMs: 0,
      lastAttemptAtMs: 0,
      lastSyncedAt: null,
      queuedMtimeMs: 0,
      queuedAtMs: 0
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      lastSyncedMtimeMs: Number(raw.lastSyncedMtimeMs || 0),
      lastAttemptMtimeMs: Number(raw.lastAttemptMtimeMs || 0),
      lastAttemptAtMs: Number(raw.lastAttemptAtMs || 0),
      lastSyncedAt: raw.lastSyncedAt || null,
      queuedMtimeMs: Number(raw.queuedMtimeMs || 0),
      queuedAtMs: Number(raw.queuedAtMs || 0)
    };
  } catch {
    return {
      lastSyncedMtimeMs: 0,
      lastAttemptMtimeMs: 0,
      lastAttemptAtMs: 0,
      lastSyncedAt: null,
      queuedMtimeMs: 0,
      queuedAtMs: 0
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function runCmd(command, timeout = 180_000) {
  execSync(command, { stdio: 'inherit', timeout });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForLockRelease(maxWaitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS) {
  const start = Date.now();
  while (fs.existsSync(LOCK_PATH)) {
    if (Date.now() - start >= maxWaitMs) {
      return { released: false, waitedMs: Date.now() - start };
    }
    await sleep(pollMs);
  }
  return { released: true, waitedMs: Date.now() - start };
}

async function main() {
  const sourceArg = process.argv.find(a => a.startsWith('--source='));
  const source = sourceArg ? sourceArg.split('=')[1] : 'unknown';

  if (!fs.existsSync(HEALTH_LOG)) {
    const result = { status: 'skipped', reason: 'health_log_missing', source };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  const stat = fs.statSync(HEALTH_LOG);
  const mtimeMs = stat.mtimeMs;
  const now = Date.now();
  const state = loadState();

  if (mtimeMs <= state.lastSyncedMtimeMs) {
    const result = { status: 'skipped', reason: 'no_new_log_write', source, mtimeMs, lastSyncedMtimeMs: state.lastSyncedMtimeMs };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (state.lastAttemptMtimeMs === mtimeMs && now - state.lastAttemptAtMs < DEBOUNCE_MS) {
    const result = { status: 'skipped', reason: 'debounced', source, mtimeMs, debounceMs: DEBOUNCE_MS };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (fs.existsSync(LOCK_PATH)) {
    const lockTime = fs.statSync(LOCK_PATH).mtime.toISOString();
    state.lastAttemptMtimeMs = mtimeMs;
    state.lastAttemptAtMs = now;
    state.queuedMtimeMs = mtimeMs;
    state.queuedAtMs = now;
    saveState(state);
    log({ op: 'post_log_sync_queued', trigger: 'manual_post_log', source, mtimeMs, lockTime, lockWaitMs: LOCK_WAIT_MS });

    const waited = await waitForLockRelease(LOCK_WAIT_MS, LOCK_POLL_MS);
    if (!waited.released) {
      const result = {
        status: 'queued',
        reason: 'sync_lock_present_timeout',
        source,
        lockTime,
        mtimeMs,
        waitedMs: waited.waitedMs
      };
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    log({ op: 'post_log_sync_lock_cleared', trigger: 'manual_post_log', source, mtimeMs, waitedMs: waited.waitedMs });
  }

  state.lastAttemptMtimeMs = mtimeMs;
  state.lastAttemptAtMs = now;
  saveState(state);

  const sinceIso = new Date(Math.max(0, mtimeMs - 2 * 60 * 60 * 1000)).toISOString();

  try {
    log({ op: 'post_log_sync_start', trigger: 'manual_post_log', source, mtimeMs, sinceIso });

    runCmd(`cd ${WORKSPACE} && node scripts/health-sync/backfill_nutrition_gaps.js`, 120_000);
    runCmd(`cd ${WORKSPACE} && node scripts/health-sync/normalize_health_log.js`, 120_000);
    runCmd(`cd ${WORKSPACE} && node scripts/health-sync/unified_sync.js --since=${sinceIso} --allow-blocked`, 240_000);

    state.lastSyncedMtimeMs = mtimeMs;
    state.lastSyncedAt = new Date().toISOString();
    state.queuedMtimeMs = 0;
    state.queuedAtMs = 0;
    saveState(state);

    const result = { status: 'synced', trigger: 'manual_post_log', source, mtimeMs, sinceIso };
    log({ op: 'post_log_sync_success', trigger: 'manual_post_log', source, mtimeMs, sinceIso });
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    state.queuedMtimeMs = 0;
    state.queuedAtMs = 0;
    saveState(state);
    const result = { status: 'error', trigger: 'manual_post_log', source, mtimeMs, error: error.message };
    log({ op: 'post_log_sync_error', trigger: 'manual_post_log', source, mtimeMs, error: error.message });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
