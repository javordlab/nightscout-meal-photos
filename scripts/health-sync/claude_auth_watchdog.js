/**
 * claude_auth_watchdog.js — Detects headless Claude CLI auth failures
 * ("Not logged in · Please run /login"), attempts auto-recovery, and alerts
 * Javi on Telegram in ALL cases (recovered or not). Emails on unrecovered
 * failures as a second channel.
 *
 * Origin: 2026-07-02/03 outage — headless OAuth refresh failed at token
 * expiry, every claude-cli tier was down for 15h and nothing alerted
 * (keepalive logged failures every 5 min for 7h, silently).
 *
 * Detection is log-driven, not probe-driven: it tails known logs from saved
 * byte offsets and only runs a live `claude -p` test when a NEW "Not logged
 * in" line appears. Zero quota cost while healthy.
 *
 * Runs every 10 min via LaunchAgent com.healthguard.claude-auth-watchdog
 * (wrapped in heartbeat_wrap.js, job id claude-auth-watchdog).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { sendAlert } = require('./telegram_alert');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const HOME = '/Users/javier';
const CLAUDE_BIN = `${HOME}/.local/bin/claude`;
// Long-lived headless token (claude setup-token) — same source the bridges
// use, so the watchdog live-tests the exact auth path services depend on.
const CLAUDE_TOKEN_FILE = '/Users/javier/.openclaw/secrets/claude_oauth_token';
function claudeTokenEnv() {
  try {
    const t = fs.readFileSync(CLAUDE_TOKEN_FILE, 'utf8').trim();
    if (t) return { CLAUDE_CODE_OAUTH_TOKEN: t };
  } catch {}
  return {};
}
const STATE_FILE = path.join(WORKSPACE, 'data/claude_auth_watchdog_state.json');
const MARKER = 'Not logged in';
const TEST_MODEL = 'claude-haiku-4-5-20251001';
const REALERT_MS = 6 * 60 * 60 * 1000;      // while broken, re-alert at most every 6h
const HICCUP_DEDUPE_MS = 60 * 60 * 1000;    // aggregate recovered-hiccup alerts per hour

// Logs where headless `claude -p` failures surface. Offsets tracked per file.
const WATCHED_LOGS = [
  `${HOME}/.claude-keepalive/keepalive.log`,
  `${WORKSPACE}/data/claude_bridge_foodlog.log`,
  `${WORKSPACE}/data/claude_bridge_haiku.log`,
  `${WORKSPACE}/data/claude_bridge_opus.log`,
  `${WORKSPACE}/data/claude_bridge.log`,
  `${WORKSPACE}/data/coach_failure_diagnostics.jsonl`,
  `${WORKSPACE}/data/cron_health.log`,
];

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { offsets: {}, incident: null, lastHiccupAlertAt: 0 }; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/** Read new bytes since last offset. Handles rotation/truncation (size < offset → reset). */
function readNew(file, offsets) {
  let st;
  try { st = fs.statSync(file); } catch { return ''; }
  const prev = offsets[file];
  if (prev === undefined) { offsets[file] = st.size; return ''; } // first sight: skip history
  let from = prev;
  if (st.size < prev) from = 0; // rotated/truncated
  if (st.size === from) { offsets[file] = st.size; return ''; }
  const fd = fs.openSync(file, 'r');
  try {
    const len = st.size - from;
    const buf = Buffer.alloc(Math.min(len, 5 * 1024 * 1024)); // cap 5MB per cycle
    fs.readSync(fd, buf, 0, buf.length, from);
    offsets[file] = from + buf.length;
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function runClaude(extraWrap) {
  // extraWrap 'pty' runs claude under a pseudo-TTY via `script` — mimics an
  // interactive launch, which is what recovered the 2026-07-03 outage.
  const env = { ...process.env, HOME, USER: 'javier',
    PATH: `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    ...claudeTokenEnv() };
  const args = ['-p', 'reply with the single word: ok', '--model', TEST_MODEL];
  const [cmd, argv] = extraWrap === 'pty'
    ? ['/usr/bin/script', ['-q', '/dev/null', CLAUDE_BIN, ...args]]
    : [CLAUDE_BIN, args];
  try {
    const out = execFileSync(cmd, argv, { env, timeout: 120_000, killSignal: 'SIGKILL', encoding: 'utf8' });
    return { ok: !out.includes(MARKER), out: out.trim().slice(0, 200) };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().slice(0, 200) || e.message;
    return { ok: false, out };
  }
}

function sendEmail(subject, text) {
  let key;
  try { key = fs.readFileSync(`${HOME}/.openclaw/secrets/agentmail_api_key`, 'utf8').trim(); }
  catch { return Promise.resolve(false); }
  const body = JSON.stringify({ to: ['javier@javierordonez.com'], subject, text });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.agentmail.to',
      path: '/v0/inboxes/javordclaw%40agentmail.to/messages/send',
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(30_000, () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

function writeReceiptSafe(receipt) {
  try {
    const { writeReceipt } = require('./cron_receipt');
    writeReceipt(receipt);
  } catch {}
}

async function main() {
  const state = loadState();
  const now = Date.now();

  // 1. Scan for fresh failures
  const hits = [];
  for (const file of WATCHED_LOGS) {
    const chunk = readNew(file, state.offsets);
    if (!chunk) continue;
    const n = chunk.split(MARKER).length - 1;
    if (n > 0) hits.push({ file: path.basename(file), count: n });
  }

  if (hits.length === 0) {
    // No new failures. If an incident was open, verify recovery before closing.
    if (state.incident) {
      const test = runClaude();
      if (test.ok) {
        const mins = Math.round((now - state.incident.startedAt) / 60000);
        await sendAlert(`✅ Claude auth recovered — live test passes. Outage lasted ~${mins} min (since ${new Date(state.incident.startedAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid' })}).`, undefined, { parseMode: null });
        state.incident = null;
        saveState(state);
        writeReceiptSafe({ status: 'warn', summary: `auth recovered after ~${mins} min` });
        return;
      }
      // still broken — fall through to broken handling with zero new hits
    } else {
      saveState(state);
      writeReceiptSafe({ status: 'ok', summary: 'no auth failures in watched logs' });
      return;
    }
  }

  const hitSummary = hits.map(h => `${h.file}×${h.count}`).join(', ') || 'none new';

  // 2. Fresh failures (or open incident) → live-verify current state
  let test = runClaude();

  // 3. Recovery attempts if broken
  let recoveredBy = null;
  if (!test.ok && test.out.includes(MARKER)) {
    await new Promise(r => setTimeout(r, 30_000));
    test = runClaude();
    if (test.ok) recoveredBy = 'retry';
    if (!test.ok) {
      test = runClaude('pty');
      if (test.ok) recoveredBy = 'pty-interactive launch';
    }
  } else if (!test.ok) {
    // failed for a non-auth reason (timeout/network) — one retry
    await new Promise(r => setTimeout(r, 15_000));
    test = runClaude();
    if (test.ok) recoveredBy = 'retry';
  }

  const madrid = ts => new Date(ts).toLocaleString('en-GB', { timeZone: 'Europe/Madrid' });

  if (test.ok) {
    // Hiccup: failures happened but auth works now (self- or auto-recovered)
    if (state.incident) {
      const mins = Math.round((now - state.incident.startedAt) / 60000);
      await sendAlert(`✅ Claude auth recovered${recoveredBy ? ` (via ${recoveredBy})` : ''} — outage lasted ~${mins} min. New failures seen meanwhile: ${hitSummary}.`, undefined, { parseMode: null });
      state.incident = null;
    } else if (now - (state.lastHiccupAlertAt || 0) > HICCUP_DEDUPE_MS) {
      await sendAlert(`⚠️ Claude auth hiccup: "Not logged in" failures appeared in ${hitSummary}${recoveredBy ? `; auto-recovered via ${recoveredBy}` : ', but a live test now passes'}. No action needed — watching for recurrence.`, undefined, { parseMode: null });
      state.lastHiccupAlertAt = now;
    }
    saveState(state);
    writeReceiptSafe({ status: 'warn', summary: `auth hiccup (${hitSummary}), live test ok${recoveredBy ? ` via ${recoveredBy}` : ''}` });
    return;
  }

  // 4. Confirmed broken and unrecovered
  if (!state.incident) {
    state.incident = { startedAt: now, lastAlertAt: 0 };
  }
  if (now - state.incident.lastAlertAt > REALERT_MS) {
    const since = madrid(state.incident.startedAt);
    const msg = `🚨 Claude auth is DOWN (headless "Not logged in") and auto-recovery failed.\nSince: ${since}\nNew failures: ${hitSummary}\nLive test says: ${test.out}\n\nFix: open Claude Code interactively on the mini (or run: claude /login). Foodlog bridge, coach memo and claude-cli cron jobs are failing until then; no fallback tier is available.`;
    const tg = await sendAlert(msg, undefined, { parseMode: null });
    const em = await sendEmail('HealthGuard ALERT: Claude auth DOWN — manual action needed', msg);
    // Only count the alert as delivered if a channel actually accepted it —
    // a failed send must not go quiet for the 6h re-alert window.
    if (tg?.ok || em) state.incident.lastAlertAt = now;
  }
  saveState(state);
  writeReceiptSafe({ status: 'error', summary: `auth DOWN since ${madrid(state.incident.startedAt)}; recovery failed` });
}

main().catch(async e => {
  writeReceiptSafe({ status: 'error', summary: `watchdog crashed: ${e.message}` });
  process.exit(1);
});
