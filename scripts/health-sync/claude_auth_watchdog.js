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
 * When Claude is confirmed down and an alert is due, it also live-tests the
 * codex fallback tier (gpt-5.6-sol) so the alert states whether failover is
 * covering Maria-facing flows or the outage is total, and checks the public
 * status page (status.claude.com). Manual-fix advice (claude setup-token) is
 * age-gated: fresh incidents are framed as self-recovering provider hiccups
 * (no action); the escalation only appears on the 6h re-alert (2026-07-23).
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
// Decision audit trail — only non-clean runs are recorded (hits found, alert
// attempted, incident opened/closed). The 2026-07-12 forensics had to be
// reconstructed from state-file mtimes because the 09:43 hiccup run left no
// trace of what it saw or whether its alert was actually delivered.
const RUN_LOG = path.join(WORKSPACE, 'data/claude_auth_watchdog.log.jsonl');
function logRun(entry) {
  try { fs.appendFileSync(RUN_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch {}
}
// Failure signatures. The original single marker ('Not logged in', the
// 2026-07-02/03 outage shape) missed the 2026-07-05 22:44 burst, which
// surfaced as "API Error: 401 Invalid authentication credentials" — zero
// alerts fired. Match ANY known auth-failure shape plus the bridge's
// total-outage line (which indicates Maria-facing failure whatever the cause).
const MARKERS = [
  'Not logged in',                      // headless OAuth refresh dead (2026-07-02/03)
  'Invalid authentication credentials', // API-side 401 (2026-07-05)
  'Failed to authenticate',             // claude-cli auth failure wrapper
  'OAuth token has expired',
  'All models failed',                  // bridge exhausted primary + all fallbacks
];
const MARKER = MARKERS[0]; // retained for the recovery-path pty heuristic
function hasMarker(text) { return MARKERS.some(m => text.includes(m)); }
const TEST_MODEL = 'claude-haiku-4-5-20251001';
// Codex fallback tier — probed only when Claude auth is confirmed down, so the
// DOWN alert can say whether failover (foodlog bridge + coach memo chain into
// codex since 2026-07-22) is covering or the outage is total. Mirrors the
// read-only codex rescue invocation in generate_daily_report.js.
const CODEX_BIN = '/opt/homebrew/bin/codex';
const CODEX_MODEL = 'gpt-5.6-sol';
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
    return { ok: !hasMarker(out), out: out.trim().slice(0, 200) };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().slice(0, 200) || e.message;
    return { ok: false, out };
  }
}

function runCodexProbe() {
  const outFile = path.join(WORKSPACE, 'tmp', `auth-watchdog-codex-${process.pid}-${Date.now()}.txt`);
  const env = { ...process.env, HOME, USER: 'javier',
    PATH: `${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` };
  try {
    execFileSync(CODEX_BIN, [
      'exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never',
      '-m', CODEX_MODEL, '-c', 'model_reasoning_effort="high"',
      '-s', 'read-only', '-C', '/tmp', '-o', outFile, '-',
    ], { env, cwd: '/tmp', input: 'reply with the single word: ok',
         timeout: 180_000, killSignal: 'SIGKILL', encoding: 'utf8' });
    let text = '';
    try { text = fs.readFileSync(outFile, 'utf8').trim(); } catch {}
    return { ok: !!text, out: (text || 'exit 0 but empty output file').slice(0, 200) };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().slice(0, 200) || e.message;
    return { ok: false, out };
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
  }
}

// Claude/Anthropic public status page (statuspage.io; status.anthropic.com
// redirects here). Most auth-failure incidents are provider-side blips that
// self-recover in minutes with the stored token still perfectly valid, so the
// alert surfaces upstream status instead of prescribing local credential
// surgery. Returns null if the page is unreachable.
function fetchClaudeStatus() {
  const get = p => new Promise(resolve => {
    const req = https.get({ hostname: 'status.claude.com', path: p, headers: { accept: 'application/json' } }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15_000, () => { req.destroy(); resolve(null); });
  });
  return Promise.all([get('/api/v2/status.json'), get('/api/v2/incidents/unresolved.json')])
    .then(([s, inc]) => {
      if (!s || !s.status) return null;
      return {
        indicator: s.status.indicator, // none | minor | major | critical
        description: s.status.description,
        incidents: ((inc && inc.incidents) || []).map(i => i.name).slice(0, 3),
      };
    });
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
    // Count matching LINES (a single line can contain several markers,
    // e.g. "Failed to authenticate. API Error: 401 Invalid authentication…").
    const n = chunk.split('\n').filter(hasMarker).length;
    if (n > 0) hits.push({ file: path.basename(file), count: n });
  }

  if (hits.length === 0) {
    // No new failures. If an incident was open, verify recovery before closing.
    if (state.incident) {
      const test = runClaude();
      if (test.ok) {
        const mins = Math.round((now - state.incident.startedAt) / 60000);
        const tg = await sendAlert(`✅ Claude auth recovered — live test passes. Outage lasted ~${mins} min (since ${new Date(state.incident.startedAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid' })}).`, undefined, { parseMode: null });
        // The incident IS over (live test passed) — clear it even if the
        // notify failed; the run log keeps the delivery truth.
        state.incident = null;
        saveState(state);
        logRun({ kind: 'incident_closed', outageMin: mins, alertDelivered: !!tg?.ok });
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
      const tg = await sendAlert(`✅ Claude auth recovered${recoveredBy ? ` (via ${recoveredBy})` : ''} — outage lasted ~${mins} min. New failures seen meanwhile: ${hitSummary}.`, undefined, { parseMode: null });
      state.incident = null;
      logRun({ kind: 'incident_closed', outageMin: mins, hits, recoveredBy, alertDelivered: !!tg?.ok });
    } else if (now - (state.lastHiccupAlertAt || 0) > HICCUP_DEDUPE_MS) {
      const tg = await sendAlert(`⚠️ Claude auth hiccup: auth-failure markers appeared in ${hitSummary}${recoveredBy ? `; auto-recovered via ${recoveredBy}` : ', but a live test now passes'}. No action needed — watching for recurrence.`, undefined, { parseMode: null });
      // Only start the 1h dedupe window if the alert was actually delivered —
      // a failed send must retry on the next tick, not vanish (2026-07-12:
      // the 09:43 hiccup left no way to tell whether Javi's DM ever went out).
      if (tg?.ok) state.lastHiccupAlertAt = now;
      logRun({ kind: 'hiccup', hits, recoveredBy, alertDelivered: !!tg?.ok });
    } else {
      logRun({ kind: 'hiccup_deduped', hits, recoveredBy, lastHiccupAlertAt: state.lastHiccupAlertAt });
    }
    saveState(state);
    writeReceiptSafe({ status: 'warn', summary: `auth hiccup (${hitSummary}), live test ok${recoveredBy ? ` via ${recoveredBy}` : ''}` });
    return;
  }

  // 4. Confirmed broken and unrecovered
  if (!state.incident) {
    state.incident = { startedAt: now, lastAlertAt: 0 };
  }
  let codex = null;
  if (now - state.incident.lastAlertAt > REALERT_MS) {
    const since = madrid(state.incident.startedAt);
    const ageMin = Math.round((now - state.incident.startedAt) / 60000);
    // Claude is confirmed down — live-test the codex fallback tier so the
    // alert reports whether failover is covering (2026-07-23: the old static
    // "no fallback tier is available" text predated the codex tier and was
    // wrong, as was the "claude /login" advice — headless services never read
    // the interactive login; they read the setup-token file).
    codex = runCodexProbe();
    const st = await fetchClaudeStatus();
    const statusLine = st
      ? `Anthropic status page: ${st.description}${st.incidents.length ? ` — open: ${st.incidents.join('; ')}` : ''}`
      : 'Anthropic status page: unreachable';
    const failover = codex.ok
      ? `Failover: codex (${CODEX_MODEL}) live test PASSED — foodlog bridge and coach memo fail over to codex, so Maria-facing replies keep working; parked health_log writes replay once Claude auth returns. Claude-cli-only cron jobs stay down until then.`
      : `Failover: codex (${CODEX_MODEL}) live test ALSO FAILED (${codex.out}) — no working fallback tier; foodlog bridge, coach memo and claude-cli cron jobs are all down.`;
    // First alert (incident younger than the re-alert window): almost always a
    // provider-side hiccup that self-recovers with the stored token still
    // valid — regenerating it does nothing, so don't prescribe it. The
    // setup-token advice only appears on the 6h re-alert, when the outage has
    // outlived every hiccup on record (longest self-recovered: ~52 min).
    const advice = (now - state.incident.startedAt) < REALERT_MS
      ? `No action needed yet: this is usually a transient provider-side hiccup that self-recovers in minutes — the stored token is normally still valid, so regenerating it would not help. The watchdog retests every 10 min and will confirm recovery. If it is still down in ~6h you will get an escalation alert with manual steps.`
      : `Still down after ~${(ageMin / 60).toFixed(1)}h — beyond hiccup territory. If the status page is clean, suspect the stored token: on the mini run \`claude setup-token\` and save the new token into ~/.openclaw/secrets/claude_oauth_token (the file all headless callers read; interactive /login is not the mechanism).`;
    const msg = `🚨 Claude auth is DOWN (headless auth failure) and auto-recovery failed.\nSince: ${since} (~${ageMin} min)\nNew failures: ${hitSummary}\nLive test says: ${test.out}\n${statusLine}\n\n${failover}\n\n${advice}`;
    const tg = await sendAlert(msg, undefined, { parseMode: null });
    const em = await sendEmail('HealthGuard ALERT: Claude auth DOWN', msg);
    // Only count the alert as delivered if a channel actually accepted it —
    // a failed send must not go quiet for the 6h re-alert window.
    if (tg?.ok || em) state.incident.lastAlertAt = now;
    logRun({ kind: 'incident_alert', hits, testOut: test.out, codexOk: codex.ok, codexOut: codex.out, anthropicStatus: st ? st.description : null, telegramDelivered: !!tg?.ok, emailDelivered: !!em });
  } else {
    logRun({ kind: 'incident_ongoing_suppressed', hits, testOut: test.out, lastAlertAt: state.incident.lastAlertAt });
  }
  saveState(state);
  writeReceiptSafe({ status: 'error', summary: `auth DOWN since ${madrid(state.incident.startedAt)}; recovery failed${codex ? `; codex fallback ${codex.ok ? 'OK (failover covering)' : 'ALSO DOWN'}` : ''}` });
}

main().catch(async e => {
  writeReceiptSafe({ status: 'error', summary: `watchdog crashed: ${e.message}` });
  process.exit(1);
});
