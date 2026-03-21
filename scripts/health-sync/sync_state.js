const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = {
  version: 1,
  entries: {}
};

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadSyncState(filePath) {
  if (!fs.existsSync(filePath)) {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATE));

  const parsed = JSON.parse(raw);
  if (!parsed.entries || typeof parsed.entries !== 'object') {
    parsed.entries = {};
  }
  if (!parsed.version) parsed.version = 1;
  return parsed;
}

function saveSyncState(filePath, state) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

function getEntry(state, entryKey) {
  return state.entries[entryKey] || null;
}

function upsertEntry(state, entryKey, patch) {
  const current = state.entries[entryKey] || {};
  state.entries[entryKey] = {
    ...current,
    ...patch
  };
  return state.entries[entryKey];
}

module.exports = {
  DEFAULT_STATE,
  loadSyncState,
  saveSyncState,
  getEntry,
  upsertEntry
};
