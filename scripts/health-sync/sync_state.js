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

// Entry keys are content hashes, so SSoT title/text rewrites move an entry to a
// NEW key while its NS/Notion IDs stay on the old record. This merges any
// sibling record at the same (timestamp, user, category) into the canonical
// record and deletes the sibling — keeping sync_state 1 record per entry.
// Conservative: a sibling holding a DIFFERENT live ID than the canonical record
// is left in place (conflicts are the audit's job, not a cron write path's).
// Returns the number of siblings pruned; caller decides whether to save.
function consolidateDriftSiblings(state, canonicalKey, { timestamp, user, category }) {
  const canonical = state.entries[canonicalKey];
  if (!canonical) return 0;
  let pruned = 0;
  for (const [key, rec] of Object.entries(state.entries)) {
    if (key === canonicalKey) continue;
    if (rec.timestamp !== timestamp || rec.user !== user || rec.category !== category) continue;
    const pageConflict = rec.notion?.page_id && canonical.notion?.page_id &&
      rec.notion.page_id !== canonical.notion.page_id;
    const nsConflict = rec.nightscout?.treatment_id && canonical.nightscout?.treatment_id &&
      rec.nightscout.treatment_id !== canonical.nightscout.treatment_id;
    if (pageConflict || nsConflict) continue;
    if (!canonical.notion?.page_id && rec.notion?.page_id) canonical.notion = rec.notion;
    if (!canonical.nightscout?.treatment_id && rec.nightscout?.treatment_id) canonical.nightscout = rec.nightscout;
    if (!canonical.gallery?.gallery_id && rec.gallery?.gallery_id) canonical.gallery = rec.gallery;
    if (!canonical.outcomes_backfilled && rec.outcomes_backfilled) canonical.outcomes_backfilled = true;
    if ((!canonical.photo_urls || canonical.photo_urls.length === 0) && rec.photo_urls?.length) {
      canonical.photo_urls = rec.photo_urls;
    }
    delete state.entries[key];
    pruned++;
  }
  return pruned;
}

module.exports = {
  DEFAULT_STATE,
  loadSyncState,
  saveSyncState,
  getEntry,
  upsertEntry,
  consolidateDriftSiblings
};
