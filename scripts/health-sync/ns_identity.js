const NS_ENTERED_BY = 'Javordclaw-SSoT';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatEntryKeyToken(entryKey) {
  return `[entry_key:${entryKey}]`;
}

function formatLegacyEntryKeyToken(entryKey) {
  return `entry_key:${entryKey}`;
}

function buildEntryKeyRegex(entryKey) {
  return escapeRegex(formatEntryKeyToken(entryKey));
}

function notesContainEntryKey(notes, entryKey) {
  const text = String(notes || '');
  return text.includes(formatEntryKeyToken(entryKey)) || text.includes(formatLegacyEntryKeyToken(entryKey));
}

function createNsTelemetry() {
  return {
    fallback_match_count: 0,
    ambiguous_match_count: 0,
    duplicate_key_conflict_count: 0,
    verify_fail_count: 0
  };
}

function mergeNsTelemetry(target, partial) {
  if (!target || !partial) return target;
  for (const key of Object.keys(target)) {
    target[key] += Number(partial[key] || 0);
  }
  return target;
}

module.exports = {
  NS_ENTERED_BY,
  escapeRegex,
  formatEntryKeyToken,
  formatLegacyEntryKeyToken,
  buildEntryKeyRegex,
  notesContainEntryKey,
  createNsTelemetry,
  mergeNsTelemetry
};
