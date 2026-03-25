#!/usr/bin/env node
/**
 * record_write_to_ledger.js — PostToolUse hook script.
 *
 * Called after every successful Edit/Write to health_log.md.
 * Parses the newest entry (first data row after header), computes
 * its entry_key using the same logic as normalize_health_log.js,
 * and records it to the write ledger.
 *
 * This creates a synchronous proof-of-write that the PreToolUse
 * Telegram guard can check before allowing a confirmation message.
 *
 * Exit 0 always (non-blocking).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const HEALTH_LOG = path.join(WORKSPACE, 'health_log.md');
const { recordWrite } = require('./confirmation_ledger');

const BG_REGEX = /\(BG:\s*[^)]+\)/gi;
const PRED_REGEX = /\(Pred:\s*[^)]+\)/gi;
const PROTEIN_REGEX = /\(Protein:\s*[^)]+\)/gi;
const CARBS_MACRO_REGEX = /\(Carbs:[^)]*\)/gi;
const PHOTO_LINK_REGEX = /\[[^\]]*\]\([^)]+\)/g;

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function cleanWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Strip metadata from entry text — must match normalize_health_log.js stripMetadata exactly.
 */
function stripMetadata(entryText) {
  let text = cleanWhitespace(entryText.replace(PHOTO_LINK_REGEX, ''));
  text = cleanWhitespace(
    text
      .replace(BG_REGEX, '')
      .replace(PRED_REGEX, '')
      .replace(PROTEIN_REGEX, '')
      .replace(CARBS_MACRO_REGEX, '')
  );
  return text;
}

function inferOffset(dateValue) {
  const d = new Date(`${dateValue}T12:00:00`);
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(mins) / 60)).padStart(2, '0');
  const m = String(Math.abs(mins) % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function toIso(date, timeCell) {
  const trimmed = cleanWhitespace(timeCell);
  const parts = trimmed.split(' ');
  const timeOnly = parts[0];
  const offset = parts[1] || inferOffset(date);
  return `${date}T${timeOnly}:00${offset}`;
}

function parseTopEntry() {
  if (!fs.existsSync(HEALTH_LOG)) return null;

  const lines = fs.readFileSync(HEALTH_LOG, 'utf8').split('\n');

  // Find the first data row (starts with "| 20")
  for (const line of lines) {
    if (!line.startsWith('| 20')) continue;

    const raw = line.split('|').map(s => s.trim());
    if (raw.length < 10) continue;

    const date = raw[1];
    const time = raw[2];
    const user = raw[3];
    const category = raw[4];
    // Description spans from index 6 to length-3 (carbs at length-3, cals at length-2)
    const entryText = raw.slice(6, raw.length - 3).join(' | ');
    const timestamp = toIso(date, time);
    const title = stripMetadata(entryText);
    const entryKey = sha256(`${timestamp}|${user}|${title}`);

    return {
      entryKey,
      timestamp,
      category,
      description: entryText.slice(0, 120)
    };
  }
  return null;
}

function main() {
  try {
    const entry = parseTopEntry();
    if (!entry) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: '[write_ledger] No entry found at top of health_log.md — skipped.'
        }
      }));
      return;
    }

    const record = recordWrite(entry);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[write_ledger] ✓ Recorded ${entry.category} entry (${entry.entryKey.slice(0, 20)}…) to write ledger.`
      }
    }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[write_ledger] ⚠️ Failed to record write: ${err.message}`
      }
    }));
  }
}

main();
