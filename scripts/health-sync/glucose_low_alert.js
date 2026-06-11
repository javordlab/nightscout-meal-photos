#!/usr/bin/env node
/**
 * glucose_low_alert.js
 *
 * Checks latest Nightscout glucose and alerts based on time of day:
 *  Daytime (08:30–midnight, system TZ):
 *    - BG <= 80: alert regardless of trend (critical low)
 *    - BG <= 90 AND trending down: early warning alert
 *  Overnight (midnight–08:30):
 *    - BG < 70 only: severe low alert (no trend-based warnings to avoid sleep disruption)
 *
 * Sends to the food log Telegram group (-5262020908). Re-alerts when:
 *   - BG re-crosses the critical threshold (double-dip), OR
 *   - state.alertSent is older than 30 min (chronic-borderline drops), OR
 *   - BG rises above 100 (full recovery reset).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { writeReceipt } = require('./cron_receipt');

const NS_URL    = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';

const ALERT_THRESHOLD   = 90;   // mg/dL — daytime: alert when at or below this AND trending down
const CRITICAL_THRESHOLD = 80;  // mg/dL — daytime: alert regardless of trend (Libre often reports "Flat" during gradual drops)
const OVERNIGHT_CRITICAL_THRESHOLD = 70; // mg/dL — overnight (midnight–08:30): alert only on severe lows under this
const RECOVERY_THRESHOLD = 100; // mg/dL — reset alert state when above this
const ALERT_STATE_MAX_AGE_MS = 30 * 60 * 1000; // age-out: re-alert if a fresh drop occurs >30 min after last alert, even without crossing recovery
// A reading older than this means the CGM/uploader is down and BG evaluation is
// meaningless — low-alerting is effectively disabled and someone must know.
// Libre 3 reports every ~5 min; 20 min = 4 missed cycles.
const STALE_READING_MS = 20 * 60 * 1000;
const STALE_REALERT_MS = 2 * 60 * 60 * 1000;   // re-alert every 2h while CGM stays stale
const NS_FAILURES_BEFORE_ALERT = 3;             // 3 consecutive 5-min failures ≈ 15 min outage
const STATE_PATH = path.join(__dirname, '../../data/glucose_low_alert_state.json');

// Nightscout trend directions considered "down"
const DOWN_TRENDS = new Set([
  'SingleDown',
  'FortyFiveDown',
  'DoubleDown'
]);

const TREND_ARROWS = {
  DoubleDown:   '⬇️⬇️',
  SingleDown:   '⬇️',
  FortyFiveDown:'↘️',
  Flat:         '➡️',
  FortyFiveUp:  '↗️',
  SingleUp:     '⬆️',
  DoubleUp:     '⬆️⬆️',
  'NOT COMPUTABLE': '?'
};

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { alertSent: false, alertSentAt: null, lastBg: null }; }
}

// Infrastructure alerts (stale CGM / NS outage) go to the group like BG alerts:
// either condition means low-glucose protection is OFF, which is exactly what
// the household needs to know about. Deduped via state timestamps.
async function sendInfraAlert(state, stateKey, text) {
  const last = state[stateKey] ? new Date(state[stateKey]).getTime() : 0;
  if (Date.now() - last < STALE_REALERT_MS) return false;
  const botToken = getBotToken();
  if (!botToken) { console.error('No bot token for infra alert'); return false; }
  const r = await sendTelegramMessage(botToken, '-5262020908', text).catch(() => ({}));
  if (r.ok) {
    state[stateKey] = new Date().toISOString();
    writeState(state);
    return true;
  }
  console.error(`Infra alert send failed: ${JSON.stringify(r).slice(0, 200)}`);
  return false;
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function nsGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(NS_URL + urlPath);
    https.get({ hostname: url.hostname, path: url.pathname + url.search,
      headers: { 'api-secret': NS_SECRET } }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sendTelegramMessage(botToken, chatId, text) {
  const postData = new URLSearchParams({ chat_id: String(chatId), text }).toString();
  const opts = {
    method: 'POST',
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData) }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  // Use the foodlog bridge bot (@Javordclaws_bot) — it's the bot in the Food log group.
  // The OpenClaw config bot (OC_noclaudebot) is for OpenClaw's own channel, not the Food log group.
  try {
    const bridgeCfg = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/workspace/scripts/claude-bridge/config.foodlog.json', 'utf8'));
    if (bridgeCfg.botToken) return bridgeCfg.botToken;
  } catch {}
  try {
    const cfg = JSON.parse(fs.readFileSync('/Users/javier/.openclaw/openclaw.json', 'utf8'));
    return cfg?.channels?.telegram?.botToken || null;
  } catch { return null; }
}

async function main() {
  // Track everything for the dashboard receipt
  const metrics = {
    bg: null,
    trend: null,
    inAlertWindow: true,
    alertFired: false,
    alertSkippedAlreadySent: false,
    recoveryReset: false,
    nsUnreachable: false,
    telegramError: false
  };

  // Daytime alert window: 08:30–midnight (full thresholds). Overnight (midnight–08:30): only severe lows (<70).
  const sysTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nowLocal = new Date().toLocaleString('en-US', { timeZone: sysTZ, hour: 'numeric', minute: 'numeric', hour12: false });
  const [h, m] = nowLocal.split(':').map(Number);
  const minutesNow = h * 60 + m;
  const start = 8 * 60 + 30;  // 08:30
  const isOvernight = minutesNow < start;
  metrics.inAlertWindow = !isOvernight;
  metrics.isOvernight = isOvernight;

  // Retry once on failure before giving up (avoids spurious watchdog errors on transient NS timeouts)
  let entries, nsError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      entries = await nsGet('/api/v1/entries.json?count=2');
      if (Array.isArray(entries) && entries.length > 0) break;
    } catch (e) {
      nsError = e;
      if (attempt === 1) {
        console.log(`NS attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    // A transient blip is a 'warn'; a PERSISTENT outage means low-glucose
    // protection is dead and must escalate — the watchdog only pages on
    // 'error', and warnings are dashboard-only.
    const reason = nsError ? `Nightscout unreachable: ${nsError.message}` : 'Nightscout returned no entries';
    console.log(reason);
    metrics.nsUnreachable = true;
    const failState = readState();
    failState.consecutiveNsFailures = (failState.consecutiveNsFailures || 0) + 1;
    writeState(failState);
    if (failState.consecutiveNsFailures >= NS_FAILURES_BEFORE_ALERT) {
      const mins = failState.consecutiveNsFailures * 5;
      await sendInfraAlert(failState, 'nsOutageAlertAt',
        `🚨 GLUCOSE MONITORING DOWN\n\nNightscout has been unreachable for ~${mins} min — ` +
        `low-glucose alerts are NOT working. Check Maria's BG manually until this clears.`);
      return { status: 'error', summary: `NS outage: ${failState.consecutiveNsFailures} consecutive failures — low-alerting DOWN`, metrics };
    }
    return { status: 'warn', summary: reason, metrics };
  }

  const latest = entries[0];
  const bg        = latest.sgv;
  const trend     = latest.direction || 'NOT COMPUTABLE';
  const arrow     = TREND_ARROWS[trend] || '?';
  const latestDate = new Date(latest.date);
  const timestamp = latestDate.toLocaleTimeString('en-US', { timeZone: sysTZ, hour: '2-digit', minute: '2-digit' });
  const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: sysTZ, timeZoneName: 'short' }).formatToParts(latestDate).find(p => p.type === 'timeZoneName')?.value || sysTZ;

  metrics.bg = bg;
  metrics.trend = trend;

  console.log(`Latest BG: ${bg} mg/dL | Trend: ${trend} | Time: ${timestamp}`);

  const state = readState();

  // NS responded — clear the outage counter (and its alert dedup once recovered)
  if (state.consecutiveNsFailures) {
    state.consecutiveNsFailures = 0;
    state.nsOutageAlertAt = null;
  }

  // CGM staleness gate: a reading of ANY age used to be evaluated as current,
  // so a dead sensor silently disabled low-alerting while every run reported
  // "BG fine". A stale reading is an infrastructure emergency, not a BG datum.
  const readingAgeMs = Date.now() - latest.date;
  metrics.readingAgeMin = Math.round(readingAgeMs / 60000);
  if (readingAgeMs > STALE_READING_MS) {
    const ageMin = Math.round(readingAgeMs / 60000);
    console.log(`Reading is STALE: ${ageMin} min old (last at ${timestamp}) — BG evaluation skipped`);
    await sendInfraAlert(state, 'staleCgmAlertAt',
      `🚨 CGM DATA STALE\n\nLast glucose reading is ${ageMin} min old (${timestamp} ${tzAbbr}, ${bg} mg/dL). ` +
      `The sensor or uploader may be down — low-glucose alerts are NOT working. ` +
      `Check the sensor and Maria's BG manually.`);
    return { status: 'warn', summary: `CGM stale: last reading ${ageMin} min old — low-alerting blind`, metrics };
  }
  if (state.staleCgmAlertAt) {
    console.log('CGM data fresh again — clearing stale-alert state.');
    state.staleCgmAlertAt = null;
  }

  // Age out stale alert state so chronic-borderline drops can re-alert.
  // alertSent with NO timestamp is corrupt state — treat as aged out rather
  // than letting it suppress alerts until a >100 recovery.
  let stateAgedOut = false;
  if (state.alertSent) {
    const ageMs = state.alertSentAt ? Date.now() - new Date(state.alertSentAt).getTime() : Infinity;
    if (ageMs > ALERT_STATE_MAX_AGE_MS) {
      console.log(`Alert state aged out (${state.alertSentAt ? Math.round(ageMs/60000) + ' min' : 'no timestamp'}). Clearing.`);
      state.alertSent = false;
      state.alertSentAt = null;
      stateAgedOut = true;
    }
  }

  // Reset alert state if BG has recovered
  if (bg > RECOVERY_THRESHOLD && state.alertSent) {
    console.log(`BG recovered to ${bg} (>${RECOVERY_THRESHOLD}). Resetting alert state.`);
    writeState({ alertSent: false, alertSentAt: null, lastBg: bg });
    metrics.recoveryReset = true;
    return { status: 'ok', summary: `BG recovered to ${bg} ${arrow} — alert state reset`, metrics };
  }

  const prevBg = state.lastBg;
  state.lastBg = bg;

  // Check alert condition:
  // - Daytime (≥08:30): BG <= 80 critical (any trend), BG <= 90 + downtrend early-warning
  // - Overnight (<08:30): only BG < 70 critical; no trend-based early warning to avoid sleep disruption
  const effectiveCriticalThreshold = isOvernight ? OVERNIGHT_CRITICAL_THRESHOLD : CRITICAL_THRESHOLD;
  const isCriticalLow = isOvernight ? bg < OVERNIGHT_CRITICAL_THRESHOLD : bg <= CRITICAL_THRESHOLD;
  const isLowAndDropping = !isOvernight && bg <= ALERT_THRESHOLD && DOWN_TRENDS.has(trend);

  // Re-alert if BG dipped back into critical after climbing out (double-dip pattern, BG never crossed RECOVERY)
  const recrossedCritical = isCriticalLow && prevBg != null && prevBg > effectiveCriticalThreshold;

  if (isCriticalLow || isLowAndDropping) {
    if (state.alertSent && !recrossedCritical) {
      console.log(`Alert already sent at ${state.alertSentAt}. Skipping.`);
      metrics.alertSkippedAlreadySent = true;
      // Persist lastBg even on the skip path — the double-dip re-cross check
      // compares against it next run.
      writeState({ ...state, lastBg: bg });
      return { status: 'ok', summary: `BG ${bg} ${arrow} — alert already active since ${state.alertSentAt}`, metrics };
    }

    // Send alert
    const botToken = getBotToken();
    if (!botToken) {
      console.error('No bot token');
      return { status: 'error', summary: 'No Telegram bot token configured', metrics };
    }

    const urgency = isCriticalLow ? '🚨 CRITICAL' : '⚠️';
    const reason = isCriticalLow ? `Maria's glucose is critically low (${bg} mg/dL).` : `Maria's glucose is at or below 90 and dropping.`;
    const msg = `${urgency} LOW GLUCOSE ALERT\n\n🩸 BG: ${bg} mg/dL ${arrow}\n📉 Trend: ${trend}\n🕐 Time: ${timestamp} ${tzAbbr}\n\n${reason} Consider a small snack.`;

    const result1 = await sendTelegramMessage(botToken, '-5262020908', msg);
    const result2 = await sendTelegramMessage(botToken, '-5262020908', msg);
    if (result1.ok || result2.ok) {
      const sent = [result1.ok, result2.ok].filter(Boolean).length;
      console.log(`Alert sent ${sent}/2 messages.`);
      writeState({ alertSent: true, alertSentAt: new Date().toISOString(), lastBg: bg });
      metrics.alertFired = true;
      return { status: 'ok', summary: `⚠ LOW BG alert fired (${sent}/2 msgs): ${bg} ${arrow} ${trend}`, metrics };
    } else {
      console.error('Failed to send alerts:', JSON.stringify(result1), JSON.stringify(result2));
      metrics.telegramError = true;
      return { status: 'error', summary: `Telegram send failed: ${result1.description || 'unknown'}`, metrics };
    }
  } else {
    console.log(`No alert needed (BG: ${bg}, trend: ${trend}, alertSent: ${state.alertSent})`);
    writeState({ ...state, lastBg: bg });
    return { status: 'ok', summary: `BG ${bg} ${arrow} (no alert needed)`, metrics };
  }
}

main().then(outcome => {
  if (outcome) writeReceipt(outcome);
  if (outcome && outcome.status === 'error') process.exit(1);
}).catch(e => {
  console.error(e);
  writeReceipt({ status: 'error', summary: `Crashed: ${e.message || e}`, metrics: null });
  process.exit(1);
});
