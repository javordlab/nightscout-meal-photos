'use strict';

const crypto = require('crypto');
const fs = require('fs');

const ID_RE = /\[id:([a-f0-9]{8})\]/;
const ID_RE_GLOBAL = /\[id:([a-f0-9]{8})\]/g;
const DATA_ROW_PREFIX_RE = /^\| \d{4}-\d{2}-\d{2} \|/;
// Modern 8-column row: title followed by | <carbs> | <cals> | where each may be number, decimal, dash, or empty.
const TRAILING_COLS_RE_MODERN = /(\s*\|\s*(?:[\d.]+|-)?\s*\|\s*(?:[\d.]+|-)?\s*\|)\s*$/;
// Legacy 5-column row: title is the last field, only a closing pipe trails.
const TRAILING_COLS_RE_LEGACY = /(\s*\|)\s*$/;

function generateRowId() {
  return crypto.randomBytes(4).toString('hex');
}

function extractRowId(text) {
  if (!text) return null;
  const m = text.match(ID_RE);
  return m ? m[1] : null;
}

function stripRowId(text) {
  if (!text) return text;
  return text.replace(ID_RE_GLOBAL, '').replace(/\s+/g, ' ').trim();
}

function isDataRow(line) {
  return DATA_ROW_PREFIX_RE.test(line);
}

function stampLine(line, idFactory = generateRowId) {
  if (!isDataRow(line)) return { changed: false, line };
  if (ID_RE.test(line)) return { changed: false, line, existingId: extractRowId(line) };

  const m = line.match(TRAILING_COLS_RE_MODERN) || line.match(TRAILING_COLS_RE_LEGACY);
  if (!m) return { changed: false, line, error: 'no-trailing-cols' };

  const id = idFactory();
  const idxTrailing = line.length - m[0].length;
  const before = line.slice(0, idxTrailing).replace(/\s+$/, '');
  const trailing = m[0];
  return { changed: true, line: `${before} [id:${id}]${trailing}`, id };
}

function stampFile(filePath, { dryRun = false } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const stats = { scanned: 0, stamped: 0, alreadyStamped: 0, errors: 0, errorSamples: [] };
  const usedIds = new Set();

  for (const line of lines) {
    if (!isDataRow(line)) continue;
    stats.scanned++;
    const existing = extractRowId(line);
    if (existing) {
      stats.alreadyStamped++;
      usedIds.add(existing);
    }
  }

  function uniqueId() {
    let id;
    do { id = generateRowId(); } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  }

  const out = lines.map(line => {
    const res = stampLine(line, uniqueId);
    if (res.error) {
      stats.errors++;
      if (stats.errorSamples.length < 5) stats.errorSamples.push({ line: line.slice(0, 120), error: res.error });
      return line;
    }
    if (res.changed) stats.stamped++;
    return res.line;
  });

  if (!dryRun && stats.stamped > 0) {
    fs.writeFileSync(filePath, out.join('\n'));
  }
  return stats;
}

module.exports = {
  generateRowId,
  extractRowId,
  stripRowId,
  isDataRow,
  stampLine,
  stampFile,
  ID_RE,
};
