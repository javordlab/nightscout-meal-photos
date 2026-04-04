#!/usr/bin/env node
/**
 * audit_telegram_confirmations.js — Async safety-net audit (Layer 2).
 *
 * Runs every 2 hours via cron. Cross-references the write ledger
 * against health_log.normalized.json to detect phantom writes:
 * entries claimed written but missing from the log.
 *
 * If phantoms found: alerts Javi via Telegram DM and appends to violations.log.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const DATA_DIR = path.join(WORKSPACE, 'data');
const NORMALIZED_PATH = path.join(DATA_DIR, 'health_log.normalized.json');
const AUDIT_REPORT_PATH = path.join(DATA_DIR, 'telegram_confirmation_audit.json');
const VIOLATIONS_LOG = path.join(DATA_DIR, 'violations.log');
const { loadLedgerLastHours } = require('./confirmation_ledger');
const { sendAlert } = require('./telegram_alert');

function loadNormalizedEntries() {
  if (!fs.existsSync(NORMALIZED_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  } catch {
    return [];
  }
}


function appendViolation(entry) {
  try {
    fs.mkdirSync(path.dirname(VIOLATIONS_LOG), { recursive: true });
    fs.appendFileSync(VIOLATIONS_LOG, JSON.stringify(entry) + '\n');
  } catch {}
}

async function main() {
  const lookbackHours = parseInt(process.argv[2] || '24', 10);

  // Load write ledger entries from the lookback window
  const ledgerEntries = loadLedgerLastHours(lookbackHours);
  if (ledgerEntries.length === 0) {
    const report = {
      lastRunAt: new Date().toISOString(),
      lookbackHours,
      totalLedgerEntries: 0,
      phantomCount: 0,
      phantoms: [],
      status: 'ok_no_entries'
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUDIT_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    console.log(`[audit] No ledger entries in last ${lookbackHours}h. OK.`);
    return;
  }

  // Load normalized health_log entries
  const normalizedEntries = loadNormalizedEntries();
  const entryKeySet = new Set(normalizedEntries.map(e => e.entryKey));

  // Find phantoms: ledger says written, but not in normalized log
  const phantoms = ledgerEntries.filter(le => !entryKeySet.has(le.entryKey));

  const report = {
    lastRunAt: new Date().toISOString(),
    lookbackHours,
    totalLedgerEntries: ledgerEntries.length,
    phantomCount: phantoms.length,
    phantoms: phantoms.map(p => ({
      entryKey: p.entryKey,
      timestamp: p.timestamp,
      category: p.category,
      description: p.description,
      ledgerTs: p.ts
    })),
    status: phantoms.length === 0 ? 'ok' : 'phantom_detected'
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  if (phantoms.length > 0) {
    const ts = new Date().toISOString();

    // Log each phantom to violations.log
    for (const p of phantoms) {
      appendViolation({
        ts,
        type: 'phantom_telegram_confirmation',
        entryKey: p.entryKey,
        timestamp: p.timestamp,
        category: p.category,
        description: p.description,
        ledgerTs: p.ts
      });
    }

    // Alert Javi via Telegram DM (bridge bot)
    const phantomList = phantoms.map(p =>
      `  - ${p.timestamp} ${p.category}: ${p.description}`
    ).join('\n');

    const alertText = [
      `⛔ PHANTOM CONFIRMATION AUDIT`,
      `${phantoms.length} entry(ies) claimed written but MISSING from health_log.md:`,
      phantomList,
      ``,
      `These entries were recorded in the write ledger but are not in the normalized log.`,
      `Check health_log.md and recover if needed.`
    ].join('\n');

    try {
      await sendAlert(alertText);
      console.log(`[audit] Alert sent to Javi DM.`);
    } catch (err) {
      console.error(`[audit] Failed to send Telegram alert: ${err.message}`);
    }

    console.log(`[audit] ⛔ ${phantoms.length} phantom(s) detected. See ${AUDIT_REPORT_PATH}`);
    process.exitCode = 1;
  } else {
    console.log(`[audit] ✓ All ${ledgerEntries.length} ledger entries verified in health_log.md.`);
  }
}

main().catch(err => {
  console.error(`[audit] Fatal: ${err.message}`);
  process.exitCode = 2;
});
