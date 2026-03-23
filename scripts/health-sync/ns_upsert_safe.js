const {
  NS_ENTERED_BY,
  buildEntryKeyRegex,
  notesContainEntryKey,
  createNsTelemetry
} = require('./ns_identity');

function defaultNormalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parsePostTreatmentId(res) {
  if (Array.isArray(res) && res[0]?._id) return res[0]._id;
  if (res && res._id) return res._id;
  return null;
}

function hasMeaningfulDiff(existing, payload) {
  return (
    (existing?.notes || '') !== (payload?.notes || '') ||
    (existing?.carbs ?? null) !== (payload?.carbs ?? null) ||
    (existing?.eventType || '') !== (payload?.eventType || '') ||
    (existing?.created_at || '') !== (payload?.created_at || '') ||
    (existing?.enteredBy || '') !== (payload?.enteredBy || '')
  );
}

async function upsertNightscoutTreatment({
  nsRequest,
  payload,
  entryKey,
  knownTreatmentId = null,
  titleForMatch = '',
  normalizeForMatch = defaultNormalize,
  withRetries = null,
  logger = () => {},
  telemetry = null
}) {
  if (!nsRequest || !payload || !entryKey) {
    throw new Error('ns_upsert_missing_required_arguments');
  }

  const t = telemetry || createNsTelemetry();
  const run = withRetries
    ? (label, fn) => withRetries(label, fn)
    : async (_label, fn) => fn();

  const keyRegex = buildEntryKeyRegex(entryKey);

  const findByKey = async () => {
    const res = await run('ns_find_by_key', () =>
      nsRequest('GET', `/api/v1/treatments.json?find[notes][$regex]=${encodeURIComponent(keyRegex)}&count=10`)
    );
    if (!Array.isArray(res)) return [];
    return res.filter(r => notesContainEntryKey(r.notes, entryKey));
  };

  const verifyByKey = async () => {
    const rows = await findByKey();
    if (rows.length === 1 && rows[0]?._id) {
      return { ok: true, treatmentId: rows[0]._id, matches: 1 };
    }
    t.verify_fail_count += 1;
    return { ok: false, treatmentId: null, matches: rows.length };
  };

  let existingByKey = await findByKey();

  if (existingByKey.length > 1) {
    t.duplicate_key_conflict_count += 1;
    existingByKey.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const canonical = existingByKey[0];
    const dupes = existingByKey.slice(1).filter(r => r?._id && r._id !== canonical._id);
    for (const dupe of dupes) {
      await run('ns_delete_duplicate', () => nsRequest('DELETE', `/api/v1/treatments/${dupe._id}`));
    }
    logger({ op: 'ns_duplicate_key_conflict', entryKey, canonicalId: canonical._id, duplicateCount: dupes.length });
    existingByKey = [canonical];
  }

  let existing = existingByKey[0] || null;

  if (!existing && knownTreatmentId) {
    const byId = await run('ns_find_by_id', () =>
      nsRequest('GET', `/api/v1/treatments.json?find[_id]=${encodeURIComponent(knownTreatmentId)}&count=1`)
    );
    if (Array.isArray(byId) && byId[0]?._id === knownTreatmentId) {
      existing = byId[0];
      logger({ op: 'ns_recovered_by_id', entryKey, treatmentId: knownTreatmentId });
    }
  }

  if (!existing) {
    const targetMs = new Date(payload.created_at || '').getTime();
    const lo = new Date(targetMs - 60 * 1000).toISOString();
    const hi = new Date(targetMs + 60 * 1000).toISOString();
    const fallback = await run('ns_find_fallback', () =>
      nsRequest(
        'GET',
        `/api/v1/treatments.json?find[created_at][$gte]=${encodeURIComponent(lo)}&find[created_at][$lte]=${encodeURIComponent(hi)}&find[enteredBy]=${encodeURIComponent(NS_ENTERED_BY)}&count=10`
      )
    );

    const candidates = Array.isArray(fallback) ? fallback : [];
    const wanted = normalizeForMatch(titleForMatch || payload.notes || '').slice(0, 24);
    const strong = candidates.filter(r => {
      if (!r || (r.eventType || '') !== (payload.eventType || '')) return false;
      if (r.created_at === payload.created_at) return true;
      const rowMs = new Date(r.created_at || '').getTime();
      const close = Number.isFinite(rowMs) && Number.isFinite(targetMs) && Math.abs(rowMs - targetMs) <= 90 * 1000;
      if (!close || !wanted) return false;
      const rowNorm = normalizeForMatch(String(r.notes || '').replace(/\[entry_key:[^\]]+\]/g, ''));
      return rowNorm.includes(wanted);
    });

    if (strong.length === 1) {
      t.fallback_match_count += 1;
      existing = strong[0];
      logger({ op: 'ns_fallback_match', entryKey, treatmentId: existing._id });
    } else if (strong.length > 1) {
      t.ambiguous_match_count += 1;
      const candidateIds = strong.map(r => r._id).filter(Boolean);
      logger({ op: 'ns_ambiguous_fallback_match', entryKey, candidateIds, timestamp: payload.created_at, eventType: payload.eventType });
      return {
        status: 'conflict',
        reason: 'ns_ambiguous_fallback_match',
        candidateIds,
        telemetry: t
      };
    }
  }

  let mode = 'noop';
  if (existing) {
    if (hasMeaningfulDiff(existing, payload)) {
      await run('ns_update', () => nsRequest('PUT', '/api/v1/treatments.json', { ...payload, _id: existing._id }));
      mode = 'updated';
    }
  } else {
    const postRes = await run('ns_create', () => nsRequest('POST', '/api/v1/treatments.json', payload));
    const createdId = parsePostTreatmentId(postRes);
    logger({ op: 'ns_created', entryKey, treatmentId: createdId });
    mode = 'created';
  }

  const verified = await run('ns_verify', verifyByKey);
  if (!verified.ok) {
    return {
      status: 'error',
      error: 'nightscout_verify_failed',
      matches: verified.matches,
      telemetry: t
    };
  }

  return {
    status: mode === 'noop' ? 'updated' : mode,
    treatmentId: verified.treatmentId,
    telemetry: t
  };
}

module.exports = { upsertNightscoutTreatment };
