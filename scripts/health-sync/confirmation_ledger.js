#!/usr/bin/env node
/**
 * confirmation_ledger.js — Write ledger for health_log.md entries.
 *
 * Records every successful write+readback to health_log.md so that
 * the PreToolUse Telegram guard can verify a real write happened
 * before a confirmation message is sent.
 *
 * Ledger file: data/write_ledger.jsonl (append-only JSONL)
 * Each line: { ts, entryKey, timestamp, category, description }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WORKSPACE = process.cwd();
const LEDGER_PATH = path.join(WORKSPACE, 'data', 'write_ledger.jsonl');

/**
 * Record a successful write to health_log.md.
 * @param {{ entryKey: string, timestamp: string, category: string, description: string }} entry
 */
function recordWrite({ entryKey, timestamp, category, description }) {
  if (!entryKey || !timestamp) {
    throw new Error('recordWrite requires entryKey and timestamp');
  }
  const record = {
    ts: new Date().toISOString(),
    entryKey,
    timestamp,
    category: category || 'Unknown',
    description: (description || '').slice(0, 120)
  };
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(record) + '\n');
  return record;
}

/**
 * Check if an entry_key was written recently (within windowMs, default 30 min).
 * @param {string} entryKey
 * @param {number} [windowMs=1800000]
 * @returns {boolean}
 */
function hasRecentWrite(entryKey, windowMs = 30 * 60 * 1000) {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const lines = readLedgerLines();
  for (let i = lines.length - 1; i >= 0; i--) {
    const rec = lines[i];
    if (rec.ts < cutoff) break; // ledger is append-only, so once past cutoff we're done
    if (rec.entryKey === entryKey) return true;
  }
  return false;
}

/**
 * Load all ledger records since a given ISO timestamp.
 * @param {string} sinceIso
 * @returns {Array<Object>}
 */
function loadLedger(sinceIso) {
  return readLedgerLines().filter(r => r.ts >= sinceIso);
}

/**
 * Load all ledger records from the last N hours.
 * @param {number} hours
 * @returns {Array<Object>}
 */
function loadLedgerLastHours(hours) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return loadLedger(since);
}

/**
 * Read and parse all valid JSONL lines from the ledger file.
 * @returns {Array<Object>}
 */
function readLedgerLines() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const raw = fs.readFileSync(LEDGER_PATH, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  LEDGER_PATH,
  recordWrite,
  hasRecentWrite,
  loadLedger,
  loadLedgerLastHours,
  readLedgerLines
};
