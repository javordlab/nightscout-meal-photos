#!/usr/bin/env node
// switch_model_fable_to_opus48.js — one-shot scheduled model switch.
//
// Scheduled by Javi on 2026-06-10 to run 2026-06-21 22:00 (cron `0 22 21 6 *`,
// the entry self-removes after this runs). Switches all health-critical flows
// from Fable 5 (claude-fable-5) to Opus 4.8 (claude-opus-4-8):
//   1. Live-test claude-opus-4-8 on the Max OAuth CLI — abort untouched if it fails.
//   2. config.foodlog.json: primary model → claude-opus-4-8 (fallback chain
//      unchanged: opus-4-7 stays first fallback).
//   3. generate_daily_report.js: all claude-fable-5 strings → claude-opus-4-8.
//   4. CLAUDE.md + AGENTS.md model-routing docs.
//   5. Targeted restart of ONLY the foodlog bridge (never bulk-unload) + verify
//      the startup log line shows the new model.
//   6. Wait out the :00/:05 cron sync window, then normalize + drift-sweep +
//      commit + push.
//   7. Remove its own crontab entry (the 5-field date would re-fire annually).
//   8. Telegram the outcome to Javi either way.
//
// --dry-run: runs the CLI test and prints planned changes; writes nothing.
'use strict';

const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const { sendAlert } = require('./telegram_alert');

const WS = '/Users/javier/.openclaw/workspace';
const CLAUDE_BIN = '/Users/javier/.local/bin/claude';
const OLD = 'claude-fable-5';
const NEW = 'claude-opus-4-8';
const CONFIG = `${WS}/scripts/claude-bridge/config.foodlog.json`;
const REPORT = `${WS}/scripts/generate_daily_report.js`;
const BRIDGE_LOG = `${WS}/data/claude_bridge_foodlog.log`;
const BRIDGE_LABEL = 'ai.openclaw.claude-bridge.foodlog';
const CRON_TAG = 'switch_model_fable_to_opus48';
const DRY = process.argv.includes('--dry-run');

const log = (m) => console.log(`[model-switch] ${m}`);

function removeOwnCronEntry() {
  try {
    const cur = execSync('crontab -l', { encoding: 'utf8' });
    if (!cur.includes(CRON_TAG)) return;
    const next = cur.split('\n').filter(l => !l.includes(CRON_TAG)).join('\n');
    execSync('crontab -', { input: next });
    log('removed own crontab entry');
  } catch (e) {
    log(`WARN: could not remove crontab entry: ${e.message}`);
  }
}

async function notify(text) {
  try { await sendAlert(text, undefined, { parseMode: null }); } catch {}
}

async function main() {
  // Idempotency guard
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (cfg.model === NEW) {
    log('config already on target model — nothing to do');
    if (!DRY) removeOwnCronEntry();
    return;
  }
  if (cfg.model !== OLD) {
    throw new Error(`config model is "${cfg.model}", expected "${OLD}" — aborting (manual state drift, review before switching)`);
  }

  // 1. Live-test the target model before touching anything
  log(`live-testing ${NEW} via claude CLI...`);
  const probe = spawnSync(CLAUDE_BIN, [
    '--print', '--model', NEW, '--effort', 'xhigh',
    '--output-format', 'text', '--no-session-persistence',
    'Reply with exactly: OK'
  ], { encoding: 'utf8', timeout: 180000, cwd: '/tmp' });
  if (probe.status !== 0 || !/OK/.test(probe.stdout || '')) {
    throw new Error(`live test of ${NEW} failed (exit ${probe.status}): ${(probe.stderr || probe.stdout || '').slice(0, 200)}`);
  }
  log('live test passed');

  if (DRY) {
    log(`DRY RUN — would set ${CONFIG} model: ${cfg.model} -> ${NEW}`);
    log(`DRY RUN — would replace ${OLD} -> ${NEW} in generate_daily_report.js, CLAUDE.md, AGENTS.md`);
    log('DRY RUN — would kickstart bridge, sweep, commit, push, self-remove cron entry');
    return;
  }

  // 2. Bridge config (fallback chain untouched — opus-4-7 remains first fallback)
  cfg.model = NEW;
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  log(`config.foodlog.json model -> ${NEW}`);

  // 3. Daily report Coach generator
  const rep = fs.readFileSync(REPORT, 'utf8');
  fs.writeFileSync(REPORT, rep.split(OLD).join(NEW));
  log('generate_daily_report.js updated');

  // 4. Docs
  for (const [file, pairs] of [
    [`${WS}/CLAUDE.md`, [
      ['**Claude Fable 5** (`claude-fable-5`) — switched from Opus 4.7 on 2026-06-10',
       '**Claude Opus 4.8** (`claude-opus-4-8`) — switched from Fable 5 on 2026-06-21 (scheduled), prev. Fable 5 since 2026-06-10'],
      ['**Why Fable 5 across the board:**', '**Why Opus 4.8 across the board:**'],
    ]],
    [`${WS}/AGENTS.md`, [
      ['Fable 5 Standardization (2026-06-10, prev. Opus 4.7 since 2026-04-19):** All health-critical tasks use `claude-fable-5`',
       'Opus 4.8 Standardization (2026-06-21, prev. Fable 5 since 2026-06-10):** All health-critical tasks use `claude-opus-4-8`'],
      ['All health system tasks use **Claude Fable 5** (`claude-fable-5`), switched from Opus 4.7 on 2026-06-10.',
       'All health system tasks use **Claude Opus 4.8** (`claude-opus-4-8`), switched from Fable 5 on 2026-06-21.'],
    ]],
  ]) {
    let s = fs.readFileSync(file, 'utf8');
    for (const [a, b] of pairs) {
      if (!s.includes(a)) log(`WARN: expected doc string not found in ${file}: "${a.slice(0, 60)}..."`);
      s = s.split(a).join(b);
    }
    s = s.split(OLD).join(NEW); // catch any stragglers
    fs.writeFileSync(file, s);
  }
  log('CLAUDE.md + AGENTS.md updated');

  // 5. Targeted bridge restart + verify (NEVER bulk-unload openclaw plists)
  execSync(`launchctl kickstart -k gui/501/${BRIDGE_LABEL}`);
  await new Promise(r => setTimeout(r, 5000));
  const tail = execSync(`tail -20 "${BRIDGE_LOG}"`, { encoding: 'utf8' });
  const started = tail.split('\n').reverse().find(l => l.includes('Starting —'));
  if (!started || !started.includes(`model=${NEW}`)) {
    throw new Error(`bridge restarted but startup log does not show model=${NEW}: ${(started || 'no Starting line').slice(0, 200)}`);
  }
  log(`bridge restarted on ${NEW}`);

  // 6. Commit — wait out the :00 pipeline / :05 radial cron window first so the
  // normalize+sweep doesn't race their sync_state writes.
  log('waiting 8 min for the cron sync window to clear...');
  await new Promise(r => setTimeout(r, 8 * 60 * 1000));
  let committed = false;
  try {
    execSync(`cd ${WS} && /opt/homebrew/bin/node scripts/health-sync/normalize_health_log.js`, { encoding: 'utf8' });
    execSync(`cd ${WS} && /opt/homebrew/bin/node scripts/health-sync/consolidate_sync_state_drift.js --apply`, { encoding: 'utf8' });
    execSync(`cd ${WS} && git add scripts/claude-bridge/config.foodlog.json scripts/generate_daily_report.js CLAUDE.md AGENTS.md data/sync_state.json data/sync_state_consolidation_report.json data/health_log.normalized.json health_log.md && git commit -m "feat: scheduled model switch Fable 5 -> Opus 4.8 (claude-opus-4-8)

One-shot job scheduled 2026-06-10, executed by
scripts/health-sync/switch_model_fable_to_opus48.js. Fallback chain
unchanged (Opus 4.7 first). Live CLI test passed before applying.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main`, { encoding: 'utf8' });
    committed = true;
    log('committed and pushed');
  } catch (e) {
    log(`WARN: commit/push failed: ${e.message.slice(0, 300)}`);
  }

  // 7. Self-remove the cron entry (would otherwise re-fire annually)
  removeOwnCronEntry();

  // 8. Report
  await notify(
    `✅ Scheduled model switch done (Jun 21, 10 PM)\n\n` +
    `Health app: Fable 5 → Opus 4.8 (claude-opus-4-8, effort xhigh)\n` +
    `• foodlog bridge restarted, log verified\n` +
    `• Daily Coach + docs updated\n` +
    `• Fallback chain unchanged (Opus 4.7 first)\n` +
    (committed ? `• Committed + pushed` :
      `⚠️ Commit/push FAILED — runtime switch IS live; commit manually from ${WS}`)
  );
}

main().catch(async (e) => {
  console.error(`[model-switch] FAILED: ${e.message}`);
  removeOwnCronEntry();
  await notify(
    `❌ Scheduled model switch (Fable 5 → Opus 4.8) FAILED: ${e.message.slice(0, 300)}\n\n` +
    `Nothing may have been switched — bridge likely still on Fable 5. ` +
    `Re-run manually: node scripts/health-sync/switch_model_fable_to_opus48.js`
  );
  process.exit(1);
});
