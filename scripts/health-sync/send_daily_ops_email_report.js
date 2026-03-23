#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');

const PATHS = {
  postLog: path.join(DATA_DIR, 'post_log_sync.log.jsonl'),
  unified: path.join(DATA_DIR, 'unified_sync.log.jsonl'),
  pendingPhotos: path.join(DATA_DIR, 'pending_photo_entries.json'),
  validation: path.join(DATA_DIR, 'health_sync_validation_report.json'),
  watchdog: path.join(DATA_DIR, 'photo_link_watchdog_report.json'),
  lock: path.join(DATA_DIR, 'sync.lock'),
  todo: path.join(WORKSPACE, 'TODO.md'),
  outLatest: path.join(DATA_DIR, 'daily_ops_report_latest.md')
};

function parseArgs(argv) {
  const out = {
    lookbackHours: 24,
    to: process.env.DAILY_REPORT_EMAIL_TO || null,
    email: false,
    subjectPrefix: '[Health Sync Daily Ops]'
  };

  for (const arg of argv) {
    if (arg.startsWith('--lookback-hours=')) out.lookbackHours = Number(arg.split('=')[1] || 24);
    if (arg.startsWith('--to=')) out.to = arg.split('=')[1] || null;
    if (arg === '--email') out.email = true;
    if (arg.startsWith('--subject-prefix=')) out.subjectPrefix = arg.split('=')[1] || out.subjectPrefix;
  }

  if (!Number.isFinite(out.lookbackHours) || out.lookbackHours <= 0) out.lookbackHours = 24;
  return out;
}

function readJson(pathname, fallback) {
  if (!fs.existsSync(pathname)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(pathname, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(pathname) {
  if (!fs.existsSync(pathname)) return [];
  const lines = fs.readFileSync(pathname, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed
    }
  }
  return rows;
}

function inWindow(ts, sinceMs, nowMs) {
  const ms = new Date(ts || 0).getTime();
  return Number.isFinite(ms) && ms >= sinceMs && ms <= nowMs;
}

function tallyReasons(blockedRows) {
  const map = new Map();
  for (const row of blockedRows) {
    const errs = Array.isArray(row.errors) ? row.errors : [];
    for (const err of errs) {
      const r = String(err?.reason || 'unknown');
      map.set(r, (map.get(r) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function fmtTs(ms) {
  return new Date(ms).toISOString();
}

function buildReport(data) {
  const lines = [];
  lines.push(`# Daily Health Sync Ops Report`);
  lines.push(``);
  lines.push(`- Window: ${data.sinceIso} → ${data.nowIso}`);
  lines.push(`- Generated: ${data.generatedAt}`);
  lines.push(``);

  lines.push(`## Summary`);
  lines.push(`- Immediate sync attempts (manual_post_log): ${data.summary.manualAttempts}`);
  lines.push(`- Immediate sync successes: ${data.summary.manualSuccess}`);
  lines.push(`- Immediate sync queued due to lock: ${data.summary.manualQueued}`);
  lines.push(`- Immediate sync errors: ${data.summary.manualErrors}`);
  lines.push(`- Sync lock currently present: ${data.summary.lockPresent ? 'YES' : 'NO'}`);
  lines.push(`- Sync lock age (minutes): ${data.summary.lockAgeMin ?? 'n/a'}`);
  lines.push(`- NS fallback matches: ${data.summary.nsFallbackMatches}`);
  lines.push(`- NS ambiguous conflicts: ${data.summary.nsAmbiguousConflicts}`);
  lines.push(`- NS duplicate-key conflicts: ${data.summary.nsDuplicateConflicts}`);
  lines.push(`- Validation blocked entries: ${data.summary.validationBlocked}`);
  lines.push(`- Missing photo links (watchdog): ${data.summary.missingPhotoLinks}`);
  lines.push(`- Pending photo queue (total): ${data.summary.pendingPhotosTotal}`);
  lines.push(`- Pending photo retries unresolved: ${data.summary.pendingRetriesUnresolved}`);
  lines.push(`- Pending nutrition metadata items: ${data.summary.pendingNutritionMetadata}`);
  lines.push(`- Open backlog items (TODO unchecked): ${data.summary.pendingBacklogCount}`);
  lines.push(``);

  lines.push(`## Resolved yesterday`);
  lines.push(`- Immediate sync successes: ${data.summary.manualSuccess}`);
  lines.push(`- NS fallback auto-resolutions applied: ${data.summary.nsFallbackMatches}`);
  lines.push(`- NS duplicate-key conflicts auto-cleaned: ${data.summary.nsDuplicateConflicts}`);
  if (data.resolved.uploadedFromRetry > 0) {
    lines.push(`- Photo uploads recovered by retry: ${data.resolved.uploadedFromRetry}`);
  }
  lines.push(``);

  lines.push(`## Still pending`);
  lines.push(`- Pending photo retries unresolved: ${data.summary.pendingRetriesUnresolved}`);
  lines.push(`- Pending nutrition metadata items: ${data.summary.pendingNutritionMetadata}`);
  if (data.summary.lockPresent) {
    lines.push(`- Sync lock still present (age ~${data.summary.lockAgeMin} min)`);
  }
  lines.push(`- Validation warnings currently present: ${data.summary.validationWarnings}`);
  if (data.pendingBacklogItems.length > 0) {
    lines.push(`- Backlog items still open (top):`);
    for (const item of data.pendingBacklogItems.slice(0, 8)) {
      lines.push(`  - ${item}`);
    }
  }
  lines.push(``);

  lines.push(`## Needs manual action`);
  if (data.summary.manualErrors > 0) {
    lines.push(`- Investigate ${data.summary.manualErrors} immediate sync error(s) in post_log_sync logs.`);
  }
  if (data.summary.nsAmbiguousConflicts > 0) {
    lines.push(`- Resolve ${data.summary.nsAmbiguousConflicts} NS ambiguous conflict(s).`);
  }
  if (data.summary.missingPhotoLinks > 0) {
    lines.push(`- Fix ${data.summary.missingPhotoLinks} missing photo link(s).`);
  }
  if (data.summary.validationBlocked > 0) {
    lines.push(`- Review ${data.summary.validationBlocked} blocked entries (quality gate failures).`);
  }
  if (
    data.summary.manualErrors === 0 &&
    data.summary.nsAmbiguousConflicts === 0 &&
    data.summary.missingPhotoLinks === 0 &&
    data.summary.validationBlocked === 0
  ) {
    lines.push(`- No urgent manual actions detected in this window.`);
  }
  lines.push(``);

  lines.push(`## Top blocked validation reasons`);
  if (data.topBlockedReasons.length === 0) {
    lines.push(`- none`);
  } else {
    for (const [reason, count] of data.topBlockedReasons.slice(0, 10)) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push(``);

  lines.push(`## Key issue details`);
  if (data.issueDetails.length === 0) {
    lines.push(`- none`);
  } else {
    for (const issue of data.issueDetails.slice(0, 25)) {
      lines.push(`- [${issue.type}] ${issue.detail}`);
    }
  }
  lines.push(``);

  return lines.join('\n') + '\n';
}

function loadPendingBacklogItems(todoPath) {
  if (!fs.existsSync(todoPath)) return [];
  const lines = fs.readFileSync(todoPath, 'utf8').split('\n');
  return lines
    .map(l => l.trim())
    .filter(l => l.startsWith('- [ ] '))
    .map(l => l.replace(/^- \[ \] /, '').trim());
}

function sendEmail(to, subject, bodyFilePath) {
  const escapedSubject = subject.replace(/"/g, '\\"');
  execSync(`/usr/bin/mail -s "${escapedSubject}" ${to} < "${bodyFilePath}"`, { stdio: 'inherit' });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const nowMs = Date.now();
  const sinceMs = nowMs - opts.lookbackHours * 60 * 60 * 1000;

  const postLogRows = readJsonl(PATHS.postLog).filter(r => inWindow(r.ts, sinceMs, nowMs));
  const unifiedRows = readJsonl(PATHS.unified).filter(r => inWindow(r.ts, sinceMs, nowMs));
  const pendingPhotos = readJson(PATHS.pendingPhotos, []);
  const validation = readJson(PATHS.validation, { errors: [], warnings: [] });
  const watchdog = readJson(PATHS.watchdog, { missing_photo_link_count: 0, issues: [] });
  const pendingBacklogItems = loadPendingBacklogItems(PATHS.todo);

  const manualAttempts = postLogRows.filter(r => String(r.trigger) === 'manual_post_log').length;
  const manualSuccess = postLogRows.filter(r => r.op === 'post_log_sync_success').length;
  const manualQueued = postLogRows.filter(r => r.op === 'post_log_sync_queued').length;
  const manualErrors = postLogRows.filter(r => r.op === 'post_log_sync_error').length;

  const nsFallbackMatches = unifiedRows.filter(r => r.op === 'ns_fallback_match').length;
  const nsAmbiguousConflicts = unifiedRows.filter(r => r.op === 'ns_ambiguous_fallback_match').length;
  const nsDuplicateConflicts = unifiedRows.filter(r => r.op === 'ns_duplicate_key_conflict').length;

  const blockedRows = unifiedRows.filter(r => r.op === 'entry_blocked');
  const topBlockedReasons = tallyReasons(blockedRows);

  const pendingList = Array.isArray(pendingPhotos) ? pendingPhotos : [];
  const pendingRetriesUnresolved = pendingList.filter(p => !/^https?:\/\//i.test(String(p.photoUrl || ''))).length;
  const pendingNutritionMetadata = pendingList.filter(p => p.reason === 'nutrition_metadata_required_before_log').length;
  const uploadedFromRetry = pendingList.filter(p => {
    const ts = new Date(p.uploadedAt || 0).getTime();
    return Number.isFinite(ts) && ts >= sinceMs && ts <= nowMs;
  }).length;

  const lockPresent = fs.existsSync(PATHS.lock);
  const lockAgeMin = lockPresent
    ? Math.round((Date.now() - fs.statSync(PATHS.lock).mtimeMs) / 60000)
    : null;

  const issueDetails = [];

  for (const row of postLogRows.filter(r => r.op === 'post_log_sync_error').slice(0, 8)) {
    issueDetails.push({ type: 'post_log_sync_error', detail: `${row.source || 'unknown'} :: ${row.error || 'unknown_error'}` });
  }

  for (const row of unifiedRows.filter(r => r.op === 'ns_ambiguous_fallback_match').slice(0, 8)) {
    issueDetails.push({ type: 'ns_ambiguous_fallback_match', detail: `${row.entryKey || 'n/a'} :: candidates=${(row.candidateIds || []).join(',')}` });
  }

  const validationErrors = Array.isArray(validation.errors) ? validation.errors : [];
  const validationWarnings = Array.isArray(validation.warnings) ? validation.warnings : [];

  for (const issue of (watchdog.issues || []).slice(0, 8)) {
    issueDetails.push({ type: 'missing_photo_link', detail: `${issue.entryKey || 'n/a'} :: ${issue.reason || 'missing_photo_link'}` });
  }

  for (const row of blockedRows.slice(0, 8)) {
    const firstReason = row?.errors?.[0]?.reason || 'unknown';
    issueDetails.push({ type: 'entry_blocked', detail: `${row.entryKey || 'n/a'} :: ${firstReason}` });
  }

  const reportData = {
    generatedAt: new Date().toISOString(),
    sinceIso: fmtTs(sinceMs),
    nowIso: fmtTs(nowMs),
    summary: {
      manualAttempts,
      manualSuccess,
      manualQueued,
      manualErrors,
      lockPresent,
      lockAgeMin,
      nsFallbackMatches,
      nsAmbiguousConflicts,
      nsDuplicateConflicts,
      validationBlocked: blockedRows.length,
      validationWarnings: validationWarnings.length,
      missingPhotoLinks: Number(watchdog.missing_photo_link_count || 0),
      pendingPhotosTotal: pendingList.length,
      pendingRetriesUnresolved,
      pendingNutritionMetadata,
      pendingBacklogCount: pendingBacklogItems.length
    },
    resolved: {
      uploadedFromRetry
    },
    pendingBacklogItems,
    topBlockedReasons,
    issueDetails
  };

  const reportText = buildReport(reportData);
  fs.writeFileSync(PATHS.outLatest, reportText);

  const datedPath = path.join(
    DATA_DIR,
    `daily_ops_report_${new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, '')}.md`
  );
  fs.writeFileSync(datedPath, reportText);

  const subject = `${opts.subjectPrefix} ${new Date().toISOString().slice(0, 10)} (last ${opts.lookbackHours}h)`;

  let emailStatus = 'not_requested';
  if (opts.email) {
    if (!opts.to) {
      emailStatus = 'failed_missing_recipient';
    } else {
      try {
        sendEmail(opts.to, subject, PATHS.outLatest);
        emailStatus = 'sent';
      } catch (e) {
        emailStatus = `failed:${e.message}`;
      }
    }
  }

  const out = {
    status: 'ok',
    lookbackHours: opts.lookbackHours,
    reportPath: PATHS.outLatest,
    datedPath,
    emailStatus,
    to: opts.to || null,
    subject,
    summary: reportData.summary
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main };
