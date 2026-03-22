#!/usr/bin/env node
// health_sync_pipeline.js - Phase 4: unified daily pipeline
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const LOG_PATH = path.join(WORKSPACE, 'data', 'pipeline.log.jsonl');

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
}

async function runStep(name, modulePath, args = {}) {
  console.log(`\n=== ${name} ===`);
  log({ op: 'step_start', name });
  const start = Date.now();
  
  try {
    const mod = require(modulePath);
    const result = await mod.main(args);
    const duration = Date.now() - start;
    log({ op: 'step_complete', name, duration, result: typeof result === 'object' ? 'object' : result });
    console.log(`Completed in ${duration}ms`);
    return { success: true, result };
  } catch (e) {
    const duration = Date.now() - start;
    log({ op: 'step_error', name, duration, error: e.message });
    console.error(`Failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function main(options = {}) {
  const mode = options.mode || 'full'; // full, sync-only, outcomes-only, audit-only
  const since = options.since || new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  console.log(`Health Sync Pipeline - Mode: ${mode}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Since: ${since}`);

  log({ op: 'pipeline_start', mode, since });
  const pipelineStart = Date.now();

  const results = {};

  // Step 1: Normalize
  if (mode === 'full' || mode === 'sync-only') {
    results.normalize = await runStep('Normalize', './normalize_health_log');
    if (!results.normalize.success) {
      log({ op: 'pipeline_abort', reason: 'normalize_failed' });
      return results;
    }
  }

  // Step 2: Enrich
  if (mode === 'full' || mode === 'sync-only') {
    results.enrich = await runStep('Enrich', './enrich_sync_state');
  }

  // Step 3: Validate (hard gate)
  if (mode === 'full' || mode === 'sync-only') {
    results.validate = await runStep('Validate', './validate_health_sync', { failOnError: true, since });
    if (!results.validate.success) {
      log({ op: 'pipeline_abort', reason: 'validation_failed' });
      return results;
    }
  }

  // Step 4: Sync to Nightscout/Notion/Gallery
  if (mode === 'full' || mode === 'sync-only') {
    results.sync = await runStep('Unified Sync', './unified_sync', { since });
  }

  // Step 5: Backfill outcomes
  if (mode === 'full' || mode === 'outcomes-only') {
    results.outcomes = await runStep('Outcome Backfill', './backfill_outcomes', { since, minAgeHours: 3 });
  }

  // Step 6: Audit
  if (mode === 'full' || mode === 'audit-only') {
    results.audit = await runStep('Audit', './audit_health_sync', { since });
  }

  // Step 7: Repair (if audit found issues and not dry-run)
  if ((mode === 'full' || mode === 'audit-only') && results.audit?.success && !options.dryRun) {
    const reportPath = path.join(WORKSPACE, 'data', 'health_sync_audit_report.json');
    if (fs.existsSync(reportPath)) {
      const audit = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (audit.discrepancies?.length > 0) {
        results.repair = await runStep('Repair', './repair_health_sync', { dryRun: options.dryRun });
      } else {
        console.log('\n=== Repair ===');
        console.log('No discrepancies found - skipping repair');
      }
    }
  }

  const pipelineDuration = Date.now() - pipelineStart;
  log({ op: 'pipeline_complete', duration: pipelineDuration, results: Object.keys(results) });
  
  console.log(`\n=== Pipeline Complete ===`);
  console.log(`Duration: ${pipelineDuration}ms`);
  console.log(`Results:`, Object.entries(results).map(([k, v]) => `${k}: ${v.success ? '✓' : '✗'}`).join(', '));

  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const modeArg = args.find(a => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'full';
  const sinceArg = args.find(a => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.split('=')[1] : null;
  const dryRun = args.includes('--dry-run');

  main({ mode, since, dryRun }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, runStep };
