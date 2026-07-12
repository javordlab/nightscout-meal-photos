#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { fetchRecentSgvRows } = require('./lib/glucose_source');

const CLAUDE_BIN = '/Users/javier/.local/bin/claude';
const COACH_DIAG_LOG = '/Users/javier/.openclaw/workspace/data/coach_failure_diagnostics.jsonl';
// Long-lived headless token (claude setup-token) — decouples the coach memo
// from the interactive 8h credential refresh cycle.
const CLAUDE_TOKEN_FILE = '/Users/javier/.openclaw/secrets/claude_oauth_token';
function claudeTokenEnv() {
  try {
    const t = fs.readFileSync(CLAUDE_TOKEN_FILE, 'utf8').trim();
    if (t) return { CLAUDE_CODE_OAUTH_TOKEN: t };
  } catch {}
  return {};
}

function redactSecrets(s) {
  if (!s) return s;
  return String(s)
    .replace(/sk-ant-[a-z0-9]+-[A-Za-z0-9_-]+/g, 'sk-ant-***REDACTED***')
    .replace(/Bearer\s+[A-Za-z0-9_.\-]+/g, 'Bearer ***REDACTED***');
}

function safeRun(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeout || 5000,
      // If caller passes `input`, stdin must be pipe; otherwise ignore to avoid
      // accidentally hanging on an interactive read.
      stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      input: opts.input,
      cwd: opts.cwd,
      env: opts.env,
    });
    return {
      code: r.status,
      signal: r.signal,
      stdout: redactSecrets((r.stdout || '').slice(0, opts.maxOut || 3000)),
      stderr: redactSecrets((r.stderr || '').slice(0, 1000)),
      error: r.error ? r.error.message : null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Capture a rich diagnostic snapshot when `claude --print` fails. Written as a
// single JSON line to COACH_DIAG_LOG. Designed to run in <10s total: all child
// invocations have short timeouts and we never throw from here.
function captureCoachFailureDiagnostics(ctx) {
  const startedAt = Date.now();
  const HOME = process.env.HOME || '/Users/javier';
  const claudeEnv = {
    ...process.env,
    HOME,
    USER: 'javier',
    PATH: '/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    ...claudeTokenEnv(),
  };

  const stat = (p) => {
    try {
      const s = fs.statSync(p);
      return { mtime: s.mtime.toISOString(), size: s.size };
    } catch (e) { return { error: e.code || e.message }; }
  };

  const diag = {
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    reportDateLA: ctx.reportDateLA || null,
    attempt: ctx.attempt,
    maxAttempts: ctx.maxAttempts,
    result: {
      ok: false,
      exitCode: ctx.result.code,
      signal: ctx.result.signal || null,
      spawnError: ctx.result.spawnError || null,
      // The coach spawn combines stderr and stdout into `stderr` on failure
      // (see resolve({ok:false, stderr: stderr||stdout}) below). Preserve both:
      combined: redactSecrets((ctx.result.stderr || '').slice(0, 2000)),
      stderrRaw: redactSecrets((ctx.result.rawStderr || '').slice(0, 2000)),
      stdoutRaw: redactSecrets((ctx.result.rawStdout || '').slice(0, 2000)),
      elapsedMs: ctx.result.elapsedMs || null,
    },
    process: {
      pid: process.pid,
      ppid: process.ppid,
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
    },
    env: {
      USER: process.env.USER || null,
      HOME: process.env.HOME || null,
      PATH: process.env.PATH || null,
      SHELL: process.env.SHELL || null,
      LOGNAME: process.env.LOGNAME || null,
      TERM: process.env.TERM || null,
      LANG: process.env.LANG || null,
      TMPDIR: process.env.TMPDIR || null,
      CRON_RECEIPT_FILE: process.env.CRON_RECEIPT_FILE || null,
      CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT || null,
      ANTHROPIC_API_KEY_set: !!process.env.ANTHROPIC_API_KEY,
      BRIDGE_CONFIG: process.env.BRIDGE_CONFIG || null,
    },
    system: {
      hostname: os.hostname(),
      uptimeSec: Math.round(os.uptime()),
      loadavg: os.loadavg(),
      freememMB: Math.round(os.freemem() / 1024 / 1024),
      totalmemMB: Math.round(os.totalmem() / 1024 / 1024),
      whoami: safeRun('whoami', []).stdout,
      launchctlContext: safeRun('launchctl', ['managername']).stdout,
      consoleUser: safeRun('stat', ['-f', '%Su', '/dev/console']).stdout,
      loginwindowTty: safeRun('who', []).stdout,
    },
    claudeCli: {
      binPath: CLAUDE_BIN,
      version: safeRun(CLAUDE_BIN, ['--version'], { env: claudeEnv, timeout: 8000 }).stdout,
      claudeJson: stat(path.join(HOME, '.claude.json')),
      claudeDir: safeRun('ls', ['-laT', path.join(HOME, '.claude')]).stdout,
      claudeBackups: safeRun('ls', ['-laT', path.join(HOME, '.claude', 'backups')]).stdout,
      mcpCache: stat(path.join(HOME, '.claude', 'mcp-needs-auth-cache.json')),
    },
    concurrency: {
      pgrepClaude: safeRun('pgrep', ['-afl', 'claude']).stdout,
      pgrepBridge: safeRun('pgrep', ['-afl', 'bridge.js']).stdout,
      pgrepNode: safeRun('pgrep', ['-afl', 'node']).stdout,
    },
    keychain: {
      keychainList: safeRun('security', ['list-keychains']).stdout,
      // NO `-g` flag → returns attributes but never the password
      claudeItemAttrs: safeRun('security', ['find-generic-password', '-s', 'Claude Code-credentials']).stdout,
      // Separately test whether THIS process can read the password; on success
      // we only record "OK" (password itself discarded); on failure we record
      // the error code/message. This is the critical signal.
      claudeItemReadTest: (() => {
        const r = safeRun('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 8000 });
        return {
          code: r.code,
          signal: r.signal,
          stderr: r.stderr,
          // Never persist the password; just record whether a blob came back
          passwordReadable: !!(r.stdout && r.stdout.length > 20),
          passwordLength: r.stdout ? r.stdout.length : 0,
        };
      })(),
    },
    network: {
      dnsAnthropic: safeRun('dscacheutil', ['-q', 'host', '-a', 'name', 'api.anthropic.com']).stdout,
      anthropicApiProbe: safeRun('curl', [
        '-sS', '-o', '/dev/null',
        '-w', 'http=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s total=%{time_total}s\n',
        '-m', '8',
        'https://api.anthropic.com/',
      ]).stdout,
      console_ai_probe: safeRun('curl', [
        '-sS', '-o', '/dev/null',
        '-w', 'http=%{http_code} total=%{time_total}s\n',
        '-m', '8',
        'https://console.anthropic.com/',
      ]).stdout,
    },
    // Follow-up: try a minimal claude --print right now (2s after the failure).
    // If this SUCCEEDS while the real call failed, the failure is transient.
    // If this ALSO fails, the failure is persistent — and we get another fresh
    // stderr capture for comparison.
    followupProbe: (() => {
      const r = safeRun(CLAUDE_BIN, [
        '--print',
        '--model', 'claude-opus-4-8',
        '--output-format', 'text',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
      ], {
        env: claudeEnv,
        cwd: '/tmp',
        input: 'Reply with exactly: PING',
        timeout: 30000,
        maxOut: 500,
      });
      return r;
    })(),
    diagnosticsElapsedMs: 0, // filled in below
  };
  diag.diagnosticsElapsedMs = Date.now() - startedAt;

  try {
    fs.appendFileSync(COACH_DIAG_LOG, JSON.stringify(diag) + '\n');
  } catch (e) {
    console.warn(`  [coach-diag] failed to write: ${e.message}`);
  }
  return diag;
}

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const OUTPUT_DIR = path.join(WORKSPACE, 'data');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIN_14D_COVERAGE_DAYS = 13;

function getLocalOffset(date) {
  const d = date ? new Date(date) : new Date();
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(mins) / 60)).padStart(2, '0');
  const m = String(Math.abs(mins) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function laDateString(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateString, delta) {
  const dt = new Date(`${dateString}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// The MODEL constant is printed in the report header as a label.
// The daily report is mostly pure-Node BUT calls Opus 4.8 via claude --print
// for the Daily Nutrition Coach section (section 5). All other sections
// (glucose stats, nutrition totals, meal details, baselines, outliers,
// supervisor analysis, self-audit) are computed from script outputs with no LLM.
// The label reflects the hybrid: stats are deterministic, the coach paragraph is Opus 4.8.
const MODEL = process.env.REPORT_MODEL || process.env.OPENCLAW_ACTIVE_MODEL || 'pure-script + claude-opus-4-8 (coach section only)';

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values, avg) {
  if (values.length === 0) return null;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateGlucoseStats(entries) {
  const values = entries.map(e => e.sgv).filter(v => Number.isFinite(v));
  if (values.length === 0) {
    return {
      count: 0,
      average: null,
      tir: null,
      gmi: null,
      stdDev: null,
      cv: null
    };
  }

  const average = mean(values);
  const inRange = values.filter(v => v >= 70 && v <= 180).length;
  const tir = (inRange / values.length) * 100;
  const gmi = 3.31 + (0.02392 * average);
  const sd = stdDev(values, average);
  const cv = sd && average ? (sd / average) * 100 : null;

  return {
    count: values.length,
    average,
    tir,
    gmi,
    stdDev: sd,
    cv
  };
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + (Number.isFinite(row[key]) ? row[key] : 0), 0);
}

function fmt(value, digits = 1) {
  if (!Number.isFinite(value)) return 'N/A';
  return Number(value).toFixed(digits);
}

function formatLaTime(isoLike) {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function cleanMealTitle(title = '') {
  return String(title)
    .replace(/\(BG:[^)]+\)/gi, '')
    .replace(/\(Pred:[^)]+\)/gi, '')
    .replace(/\(Protein:[^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nearestBg(entries, mealIso, windowMinutes = 20) {
  const mealMs = new Date(mealIso).getTime();
  if (!Number.isFinite(mealMs)) return null;
  let best = null;
  let bestDiff = windowMinutes * 60 * 1000;
  for (const e of entries) {
    if (!Number.isFinite(e?.date) || !Number.isFinite(e?.sgv)) continue;
    const diff = Math.abs(e.date - mealMs);
    if (diff <= bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
}

// ── Daily Coach generator ──────────────────────────────────────────────────
// Spawns `claude --print --model claude-opus-4-8` from /tmp (no CLAUDE.md inheritance)
// with the full day's food + glucose context inline. The agent returns a
// supportive nutrition coach paragraph for the daily report.
//
// Failure is non-fatal: if Opus times out, errors, or returns nothing,
// we fall back to a static "unavailable" string so the daily report still ships.
//
// Why /tmp as cwd: Claude Code auto-discovers CLAUDE.md from cwd up the tree.
// /tmp has no CLAUDE.md, so the agent gets a clean default system prompt
// instead of inheriting the food-log workflow instructions.
//
// Cost: ~1 Opus call per daily report = ~1 call/day under Max OAuth.
// Latency: ~30-90 sec, well within the 9:30 AM cron's tolerance.
async function generateDailyCoach(targetDate, foodPrevDay, statsDay, stats14, avg14) {
  const totalCarbs = sum(foodPrevDay, 'carbsEst');
  const totalCals = sum(foodPrevDay, 'caloriesEst');
  const totalProtein = sum(foodPrevDay, 'proteinEst');
  const mealCount = foodPrevDay.length;

  // Build the meal breakdown including each entry's Coach annotation if present
  const mealLines = foodPrevDay
    .slice()
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
    .map((m) => {
      const time = formatLaTime(m.timestamp);
      const cleanTitle = String(m.title || '')
        .replace(/\(BG:[^)]+\)/gi, '')
        .replace(/\(Pred:[^)]+\)/gi, '')
        .replace(/\(Protein:[^)]+\)/gi, '')
        .replace(/\[Coach:[^\]]+\]/gi, '')
        .replace(/\[Cumulative[^\]]+\]/gi, '')
        .replace(/\[photo\][^\s]*/gi, '')
        .replace(/\[📷\][^\s]*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      const coachMatch = String(m.title || '').match(/\[Coach:\s*([^\]]+)\]/);
      const coachNote = coachMatch ? `\n    (per-meal coach noted: ${coachMatch[1].trim()})` : '';
      return `- ${time}: ${cleanTitle} — ${fmt(m.carbsEst, 0)}g carbs, ${fmt(m.proteinEst, 0)}g protein, ${fmt(m.caloriesEst, 0)} kcal${coachNote}`;
    });

  const prompt = `You are a supportive nutrition coach for Maria Dennis (73 years old, Type 2 Diabetes managed with Metformin 500mg breakfast + 500mg lunch + 1000mg dinner, plus Lisinopril 10mg morning and Rosuvastatin 10mg every other day). You give her per-meal feedback throughout the day. Now you're writing the DAILY summary section for her morning report — a single supportive paragraph that reviews YESTERDAY (${targetDate}) as a whole.

YESTERDAY'S TOTALS:
- Meals logged: ${mealCount}
- Total carbs: ${fmt(totalCarbs, 0)} g
- Total protein: ${fmt(totalProtein, 0)} g
- Total calories: ${fmt(totalCals, 0)} kcal
- Average glucose: ${fmt(statsDay.average, 0)} mg/dL
- Time in Range (70-180): ${fmt(statsDay.tir, 0)}%

14-DAY BASELINE (for comparison):
- Avg carbs/day: ${fmt(avg14.carbs, 0)} g
- Avg protein/day: ${fmt(avg14.protein, 0)} g
- Avg calories/day: ${fmt(avg14.cals, 0)} kcal
- Avg meals/day: ${fmt(avg14.meals, 1)}

YESTERDAY'S MEAL DETAIL:
${mealLines.length ? mealLines.join('\n') : '(no meals logged)'}

Write a single supportive, friendly daily coaching paragraph (2-4 sentences, ~300-500 chars total) that:
1. Reviews how the WHOLE DAY's eating compares to a well-balanced T2D-friendly day (~half non-starchy veggies, ~quarter lean protein, ~quarter complex carbs, healthy fats; carb load distributed across meals; ~60-90g protein/day target).
2. ALWAYS celebrates at least one positive observation — even an imperfect day usually has something good.
3. Notes the biggest pattern or opportunity for improvement (if any), referencing specific meals from yesterday by name when relevant.
4. Compares against her 14-day baseline if there is a meaningful trend (e.g., "more vegetables than usual", "carbs were higher than your typical day").
5. Uses a warm, encouraging tone — like a friendly coach, not a clinician.
6. Is a single flowing paragraph, no bullet points, no headers, no markdown formatting.
7. Does NOT use square brackets [ ] or pipes | (they would break the daily report parser).
8. Does NOT include preamble like "Here's your daily summary" or "Yesterday you" — just the coaching content.
9. Addresses Maria directly in 2nd person ("you").
10. Does NOT mention this is AI-generated, does NOT add a sign-off, does NOT use emojis.

Reply with ONLY the paragraph. No other text. No JSON wrapping. Just the paragraph itself.`;

  const MAX_ATTEMPTS = 4;
  const RETRY_DELAY_MS = 45_000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    const result = await new Promise((resolve) => {
      const child = spawn(CLAUDE_BIN, [
        '--print',
        '--model', 'claude-opus-4-8',
        '--effort', 'xhigh',
        '--output-format', 'text',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
      ], {
        cwd: '/tmp',
        env: {
          ...process.env,
          HOME: '/Users/javier',
          USER: 'javier', // Required for Claude CLI auth in cron (no USER in cron env)
          PATH: '/Users/javier/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
          ...claudeTokenEnv(),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);

      const killTimer = setTimeout(() => {
        try { child.kill(); } catch {}
      }, 300_000); // 5-min hard cap — Opus xhigh typical latency is 2-5 min

      child.on('close', (code, signal) => {
        clearTimeout(killTimer);
        const text = stdout.trim();
        const elapsedMs = Date.now() - attemptStart;
        if (text && code === 0) {
          // Strip any brackets/pipes that would corrupt the report formatting,
          // collapse whitespace
          const cleaned = text.replace(/[\[\]|]/g, '').replace(/\s+/g, ' ').trim();
          resolve({ ok: true, text: cleaned, elapsedMs });
        } else {
          // Capture stdout too — Claude CLI prints auth errors to stdout, not stderr
          const combinedErr = (stderr || stdout || '').slice(0, 300);
          resolve({
            ok: false,
            code,
            signal,
            stderr: combinedErr,
            rawStdout: stdout,
            rawStderr: stderr,
            elapsedMs,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(killTimer);
        resolve({ ok: false, spawnError: err.message, elapsedMs: Date.now() - attemptStart });
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

    if (result.ok) return result.text;

    console.warn(`  Coach attempt ${attempt}/${MAX_ATTEMPTS} failed: code=${result.code} elapsedMs=${result.elapsedMs} err=${(result.stderr || result.spawnError || '').slice(0, 100)}`);

    // Rich per-attempt diagnostics: env, process, keychain ACL probe, network,
    // concurrent claude PIDs, follow-up probe. Never throws.
    try {
      captureCoachFailureDiagnostics({
        reportDateLA: targetDate,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        result,
      });
    } catch (diagErr) {
      console.warn(`  [coach-diag] capture threw: ${diagErr.message}`);
    }

    // Last attempt — return the fallback string
    if (attempt === MAX_ATTEMPTS) {
      const reason = result.spawnError
        ? `spawn error: ${result.spawnError}`
        : `model exit code ${result.code}, stderr: ${result.stderr}`;
      return `Daily coach summary unavailable today — please check yesterday's individual meal coach notes for per-meal guidance. (${reason} after ${MAX_ATTEMPTS} attempts)`;
    }

    // Wait before retrying
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
  }
}

async function main(options = {}) {
  const now = new Date();
  const reportDate = options.reportDate || laDateString(now); // date report runs
  const targetDate = options.targetDate || addDays(reportDate, -1); // always report on PREVIOUS day

  const start14 = addDays(targetDate, -13);
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));

  const sgvRows = fetchRecentSgvRows(5000);
  // Newest reading in the MySQL mirror — lets the sender distinguish a stale
  // mirror (fail closed) from a genuine CGM sensor gap (send with a warning).
  const newestSgvAtMs = sgvRows.length ? Math.max(...sgvRows.slice(0, 20).map(e => e.date)) : null;

  const glucosePrevDay = sgvRows.filter(e => laDateString(new Date(e.date)) === targetDate);
  const glucose14Days = sgvRows.filter(e => {
    const d = laDateString(new Date(e.date));
    return d >= start14 && d <= targetDate;
  });

  const statsDay = calculateGlucoseStats(glucosePrevDay);
  const coverage14Days = new Set(glucose14Days.map(e => laDateString(new Date(e.date)))).size;
  const has14dCoverage = coverage14Days >= MIN_14D_COVERAGE_DAYS;
  const stats14 = has14dCoverage
    ? calculateGlucoseStats(glucose14Days)
    : { count: 0, average: null, tir: null, gmi: null, stdDev: null, cv: null };

  const highs = glucosePrevDay.filter(e => e.sgv > 180).sort((a, b) => b.sgv - a.sgv);
  const lows = glucosePrevDay.filter(e => e.sgv < 70).sort((a, b) => a.sgv - b.sgv);
  const peak = glucosePrevDay.length > 0 ? glucosePrevDay.reduce((m, e) => e.sgv > m.sgv ? e : m, glucosePrevDay[0]) : null;

  const entries = normalized.entries || [];
  const foodPrevDay = entries.filter(e => e.category === 'Food' && e.date === targetDate);
  const medsPrevDay = entries.filter(e => e.category === 'Medication' && e.date === targetDate);

  const food14 = entries.filter(e => e.category === 'Food' && e.date >= start14 && e.date <= targetDate);
  const byDate = {};
  for (const e of food14) {
    byDate[e.date] = byDate[e.date] || { carbs: 0, cals: 0, protein: 0, meals: 0 };
    byDate[e.date].carbs += Number.isFinite(e.carbsEst) ? e.carbsEst : 0;
    byDate[e.date].cals += Number.isFinite(e.caloriesEst) ? e.caloriesEst : 0;
    byDate[e.date].protein += Number.isFinite(e.proteinEst) ? e.proteinEst : 0;
    byDate[e.date].meals += 1;
  }
  const days = Object.keys(byDate).sort();
  const avg14 = {
    carbs: days.length ? Object.values(byDate).reduce((s, d) => s + d.carbs, 0) / days.length : 0,
    cals: days.length ? Object.values(byDate).reduce((s, d) => s + d.cals, 0) / days.length : 0,
    protein: days.length ? Object.values(byDate).reduce((s, d) => s + d.protein, 0) / days.length : 0,
    meals: days.length ? Object.values(byDate).reduce((s, d) => s + d.meals, 0) / days.length : 0,
    days: days.length
  };

  const mealsDetailed = foodPrevDay
    .slice()
    .sort((a, b) => new Date(a.timestamp || `${a.date}T00:00:00${getLocalOffset(a.date + 'T00:00:00')}`).getTime() - new Date(b.timestamp || `${b.date}T00:00:00${getLocalOffset(b.date + 'T00:00:00')}`).getTime())
    .map((m) => {
      const mealIso = m.timestamp || `${m.date}T12:00:00${getLocalOffset(m.date + 'T12:00:00')}`;
      const bg = nearestBg(glucosePrevDay, mealIso);
      const bgText = bg ? `${bg.sgv} mg/dL` : 'N/A';
      return `- ${formatLaTime(mealIso)} — ${cleanMealTitle(m.title || m.entry || 'Meal')} — ${fmt(m.carbsEst, 1)}g carbs, ${fmt(m.caloriesEst, 0)} kcal, ${fmt(m.proteinEst, 1)}g protein — BG at meal: ${bgText}`;
    });

  const dayAvgDelta = Number.isFinite(statsDay.average) && Number.isFinite(stats14.average)
    ? statsDay.average - stats14.average
    : null;
  const dayTirDelta = Number.isFinite(statsDay.tir) && Number.isFinite(stats14.tir)
    ? statsDay.tir - stats14.tir
    : null;
  const carbsDelta = Number.isFinite(avg14.carbs) ? sum(foodPrevDay, 'carbsEst') - avg14.carbs : null;
  const calsDelta = Number.isFinite(avg14.cals) ? sum(foodPrevDay, 'caloriesEst') - avg14.cals : null;

  const wentWell = [];
  if (Number.isFinite(statsDay.tir) && statsDay.tir >= 90) wentWell.push(`Strong Time in Range at ${fmt(statsDay.tir, 1)}% ✅`);
  if ((highs.length || 0) <= 2) wentWell.push(`Limited high excursions (>${180} mg/dL): ${highs.length} ✅`);
  if ((lows.length || 0) === 0) wentWell.push('No hypoglycemia episodes (<70 mg/dL) ✅');
  if (Number.isFinite(sum(foodPrevDay, 'proteinEst')) && sum(foodPrevDay, 'proteinEst') >= 60) wentWell.push(`Good protein intake (${fmt(sum(foodPrevDay, 'proteinEst'), 1)}g) ✅`);

  const improve = [];
  if (Number.isFinite(carbsDelta) && carbsDelta > 30) improve.push(`Carbs were above 14-day baseline by ${fmt(carbsDelta, 1)}g; consider smaller late-day carb load.`);
  if (Number.isFinite(calsDelta) && calsDelta > 300) improve.push(`Calories were above baseline by ${fmt(calsDelta, 0)} kcal; consider portion tightening at dinner/snacks.`);
  if (highs.length > 0) improve.push(`There was ${highs.length} reading(s) >180 mg/dL; keep an eye on post-meal spacing/activity.`);

  const expectedGmiFromAvg = Number.isFinite(statsDay.average) ? (3.31 + (0.02392 * statsDay.average)) : null;

  // Generate the daily nutrition coach paragraph (2026-04-09 — added per Javi's request).
  // This calls Opus 4.8 via claude --print with the day's full food + glucose context.
  // Failure is non-fatal: if Sonnet is unreachable, generateDailyCoach returns a
  // graceful "unavailable today" string and the report still ships.
  // options.skipCoach: delivery-guarantee paths (report_watchdog fallback) must
  // never block on the LLM — the Coach retry budget (4 × 45s delays + up to
  // 5 min per attempt) cannot fit inside the watchdog's execSync timeout
  // (2026-07-12: transient 401s made the fallback time out and the day's
  // report was never delivered).
  const dailyCoachText = options.skipCoach
    ? 'Daily coach summary skipped in fallback delivery — see yesterday\'s per-meal coach notes for guidance.'
    : await generateDailyCoach(targetDate, foodPrevDay, statsDay, stats14, avg14);

  const trendsSection = has14dCoverage
    ? `- Average glucose: ${fmt(stats14.average, 1)} mg/dL\n- Time in Range (70-180): ${fmt(stats14.tir, 1)}%\n- GMI: ${fmt(stats14.gmi, 2)}%\n- Standard deviation: ${fmt(stats14.stdDev, 1)} mg/dL\n- CV: ${fmt(stats14.cv, 1)}%\n- Data points used: ${stats14.count}`
    : `- Unavailable — Nightscout has only ${coverage14Days} day(s) of CGM history in the 14-day window (need ≥${MIN_14D_COVERAGE_DAYS}). 14-day trends resume automatically once history is complete.`;

  const report = `🩺 DAILY HEALTH REPORT\n📅 Date: ${reportDate}\n🕒 Coverage window: ${targetDate} 00:00 – ${addDays(targetDate, 1)} 00:00 (${TZ})\n⚙️ Generated time: ${new Date().toISOString()}\n🤖 Model: ${MODEL}\n\n1) 📊 Today's Glucose Summary\n- Average glucose: ${fmt(statsDay.average, 1)} mg/dL\n- Time in Range (70-180): ${fmt(statsDay.tir, 1)}%\n- GMI: ${fmt(statsDay.gmi, 2)}%\n- Standard deviation: ${fmt(statsDay.stdDev, 1)} mg/dL\n- CV: ${fmt(statsDay.cv, 1)}%\n- Data points used: ${statsDay.count}\n\n2) 📉 14-day Trends (ending ${targetDate})\n${trendsSection}\n\n3) 🍽️ Nutrition (${targetDate})\n- Meals logged: ${foodPrevDay.length}\n- Total carbs: ${fmt(sum(foodPrevDay, 'carbsEst'), 1)} g\n- Total calories: ${fmt(sum(foodPrevDay, 'caloriesEst'), 0)} kcal\n- Total protein: ${fmt(sum(foodPrevDay, 'proteinEst'), 1)} g\n\n4) 🧾 Meal Details (${targetDate})\n${mealsDetailed.length ? mealsDetailed.join('\n') : '- No food entries logged'}\n\n5) 🥗 Daily Nutrition Coach\n${dailyCoachText}\n\n6) 📚 Nutrition Baseline (14-day daily average ending ${targetDate})\n- Average carbs/day: ${fmt(avg14.carbs, 1)} g\n- Average calories/day: ${fmt(avg14.cals, 1)} kcal\n- Average protein/day: ${fmt(avg14.protein, 1)} g\n- Average meals/day: ${fmt(avg14.meals, 1)}\n- Days in window with food entries: ${avg14.days}\n\n7) 💊 Medication Status (${targetDate})\n${medsPrevDay.length ? medsPrevDay.map(m => `- ${m.timestamp}: ${m.title}`).join('\n') : '- No medication entries logged'}\n\n8) 🚨 Outliers (${targetDate})\n- High readings >180: ${highs.length}\n- Low readings <70: ${lows.length}\n- Max glucose: ${peak ? `${peak.sgv} mg/dL at ${peak.dateString || new Date(peak.date).toISOString()}` : 'N/A'}\n\n9) 🧠 Extended Supervisor Analysis\n- Nice work overall today: ${wentWell.length ? wentWell.map(x => x.replace(/\s*✅$/, '')).join(' | ') : 'overall stable day with no major safety events'}.\n- Key trend signals: avg glucose vs 14-day baseline ${Number.isFinite(dayAvgDelta) ? `${fmt(dayAvgDelta, 1)} mg/dL` : 'N/A'}, TIR delta ${Number.isFinite(dayTirDelta) ? `${fmt(dayTirDelta, 1)}%` : 'N/A'}, carbs delta ${Number.isFinite(carbsDelta) ? `${fmt(carbsDelta, 1)} g` : 'N/A'}, calories delta ${Number.isFinite(calsDelta) ? `${fmt(calsDelta, 0)} kcal` : 'N/A'}.\n- Friendly focus for tomorrow: ${improve.length ? improve.join(' ') : 'No urgent corrections needed—just keep the same consistency and momentum.'}\n- You’re doing great—small consistent habits keep adding up. Keep it going 🌟\n\n10) 🛡️ Self-Audit (Data Integrity)\n- Target day enforced: ${targetDate} PT\n- Glucose points in target window: ${statsDay.count}\n- GMI formula check (3.31 + 0.02392 × Avg): ${fmt(expectedGmiFromAvg, 2)}%\n- Reported GMI: ${fmt(statsDay.gmi, 2)}%\n`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(OUTPUT_DIR, `daily_report_${reportDate}.txt`);
  fs.writeFileSync(reportPath, report);

  const metaPath = path.join(OUTPUT_DIR, 'daily_report_latest.json');
  fs.writeFileSync(metaPath, JSON.stringify({ reportDate, targetDate, reportPath, generatedAt: new Date().toISOString() }, null, 2) + '\n');

  console.log(reportPath);
  return {
    reportPath,
    reportDate,
    targetDate,
    statsDay,
    stats14,
    newestSgvAtMs,
    generatedAt: new Date().toISOString()
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const reportDateArg = args.find(a => a.startsWith('--report-date='));
  const targetDateArg = args.find(a => a.startsWith('--target-date='));
  const modelArg = args.find(a => a.startsWith('--model='));
  const reportDate = reportDateArg ? reportDateArg.split('=')[1] : null;
  const targetDate = targetDateArg ? targetDateArg.split('=')[1] : null;
  if (modelArg) process.env.REPORT_MODEL = modelArg.split('=')[1];

  main({ reportDate, targetDate }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, laDateString, addDays, calculateGlucoseStats, captureCoachFailureDiagnostics };
