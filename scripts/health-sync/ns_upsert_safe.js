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

  // NS's /treatments.json endpoint silently truncates regex-by-notes searches to
  // a recent default window (observed ~30-60 days). Without an explicit
  // created_at[$gte], old treatments are invisible and the dispatcher falsely
  // concludes "no existing match" → POSTs again → verify fails → 38+ logged
  // `nightscout_verify_failed` errors traced to entries from 2026-03-28. The
  // by-id lookup below isn't affected. A 2-year lookback comfortably covers
  // anything the SSoT could reference.
  const NS_REGEX_LOOKBACK_MS = 2 * 365 * 24 * 60 * 60 * 1000;
  const findByKeySince = new Date(Date.now() - NS_REGEX_LOOKBACK_MS).toISOString();

  const findByKey = async () => {
    const res = await run('ns_find_by_key', () =>
      nsRequest('GET', `/api/v1/treatments.json?find[notes][$regex]=${encodeURIComponent(keyRegex)}&find[created_at][$gte]=${encodeURIComponent(findByKeySince)}&count=10`)
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
      // Adopt the doc only if it isn't tagged as a DIFFERENT entry's
      // treatment. A stale sync_state pointer can reference a doc that a
      // same-minute sibling now owns (NS merges POSTs sharing created_at —
      // see the slot probe below); blindly PUTting onto it would destroy the
      // sibling's treatment.
      const foreign = /\[entry_key:(sha256:[0-9a-f]+)\]/.exec(byId[0].notes || '');
      if (foreign && foreign[1] !== entryKey) {
        logger({ op: 'ns_stale_known_id', entryKey, treatmentId: knownTreatmentId, ownerKey: foreign[1].slice(0, 24) });
      } else {
        existing = byId[0];
        logger({ op: 'ns_recovered_by_id', entryKey, treatmentId: knownTreatmentId });
      }
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
      // Immediately patch the entry_key token into notes so future runs find it by key (not fallback)
      if (!notesContainEntryKey(existing.notes, entryKey)) {
        const patchedNotes = `${(existing.notes || '').trim()} [entry_key:${entryKey}]`;
        await run('ns_patch_entry_key', () =>
          nsRequest('PUT', '/api/v1/treatments.json', { ...existing, notes: patchedNotes })
        );
        existing = { ...existing, notes: patchedNotes };
      }
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
  let resolvedId = existing?._id || null;

  if (existing) {
    // Keep the doc's stored created_at when it's the same instant in a
    // different string format (NS normalizes to UTC Z; the payload carries a
    // local offset — a bare string compare PUT-churned every processed entry),
    // or when the doc sits in a +Ns sibling slot within its minute (see slot
    // probe below) — moving it back to :00 would re-collide with its sibling.
    if (existing.created_at && payload.created_at) {
      const em = new Date(existing.created_at).getTime();
      const pm = new Date(payload.created_at).getTime();
      const sameMinute = Number.isFinite(em) && Number.isFinite(pm) &&
        Math.floor(em / 60000) === Math.floor(pm / 60000);
      if (sameMinute && (em === pm || em % 60000 !== 0)) {
        payload = { ...payload, created_at: existing.created_at };
      }
    }
    if (hasMeaningfulDiff(existing, payload)) {
      await run('ns_update', () => nsRequest('PUT', '/api/v1/treatments.json', { ...payload, _id: existing._id }));
      mode = 'updated';
    }
  } else {
    // NS merges POSTs that share a created_at — server-verified 2026-07-23:
    // the second POST returns 200 WITHOUT _id and overwrites the existing
    // doc's fields in place. Same-minute same-category siblings are
    // legitimate in the SSoT (two food items logged in one message), so never
    // blind-POST: probe the exact second and walk forward one second at a
    // time until the slot is free, then create there. The skip-gate keeps
    // synced entries out of this path, so probes only run for new entries.
    let createAt = payload.created_at;
    const baseMs = new Date(payload.created_at || '').getTime();
    if (Number.isFinite(baseMs)) {
      let slotMs = baseMs;
      let free = false;
      for (let s = 0; s < 60 && !free; s++) {
        const lo = new Date(slotMs).toISOString();
        const hi = new Date(slotMs + 999).toISOString();
        const occ = await run('ns_probe_slot', () =>
          nsRequest('GET', `/api/v1/treatments.json?find[created_at][$gte]=${encodeURIComponent(lo)}&find[created_at][$lte]=${encodeURIComponent(hi)}&count=5`)
        );
        free = !(Array.isArray(occ) && occ.length > 0);
        if (!free) slotMs += 1000;
      }
      if (!free) {
        logger({ op: 'ns_no_free_slot', entryKey, timestamp: payload.created_at });
        return { status: 'conflict', reason: 'ns_no_free_slot', candidateIds: [], telemetry: t };
      }
      if (slotMs !== baseMs) {
        // Preserve the original offset representation, bumping only seconds.
        const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):(\d{2})(.*)$/.exec(String(payload.created_at));
        const bumped = m ? Number(m[2]) + Math.round((slotMs - baseMs) / 1000) : 60;
        createAt = bumped < 60 ? `${m[1]}:${String(bumped).padStart(2, '0')}${m[3]}` : new Date(slotMs).toISOString();
        logger({ op: 'ns_slot_shifted', entryKey, from: payload.created_at, to: createAt });
      }
    }
    const postRes = await run('ns_create', () => nsRequest('POST', '/api/v1/treatments.json', { ...payload, created_at: createAt }));
    resolvedId = parsePostTreatmentId(postRes);
    if (!resolvedId) {
      logger({ op: 'ns_post_returned_no_id', entryKey, note: 'possible created_at merge despite slot probe' });
    }
    logger({ op: 'ns_created', entryKey, treatmentId: resolvedId });
    mode = 'created';
  }

  // Verify by _id (NS regex search on notes is unreliable; skip it)
  if (resolvedId) {
    return {
      status: mode === 'noop' ? 'updated' : mode,
      treatmentId: resolvedId,
      telemetry: t
    };
  }

  // Fallback: try regex verify only when we have no id at all
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
