const { describe, it } = require('node:test');
const assert = require('node:assert');

const { upsertNightscoutTreatment } = require('../../scripts/health-sync/ns_upsert_safe');

function makeMockNs({ initialTreatments = [], hideRegexLookups = false } = {}) {
  const treatments = initialTreatments.map(t => ({ ...t }));
  const calls = { get: 0, post: 0, put: 0, delete: 0 };

  async function nsRequest(method, endpoint, body) {
    const url = new URL(`http://mock${endpoint}`);

    if (method === 'GET' && url.pathname === '/api/v1/treatments.json') {
      calls.get += 1;

      const byId = url.searchParams.get('find[_id]');
      if (byId) {
        return treatments.filter(t => t._id === byId);
      }

      const regex = url.searchParams.get('find[notes][$regex]');
      if (regex) {
        if (hideRegexLookups) return [];
        const re = new RegExp(regex);
        return treatments.filter(t => re.test(String(t.notes || '')));
      }

      const gte = url.searchParams.get('find[created_at][$gte]');
      const lte = url.searchParams.get('find[created_at][$lte]');
      const enteredBy = url.searchParams.get('find[enteredBy]');
      if (gte && lte) {
        const lo = Date.parse(gte);
        const hi = Date.parse(lte);
        return treatments.filter(t => {
          const ms = Date.parse(t.created_at || '');
          if (!Number.isFinite(ms)) return false;
          if (enteredBy && t.enteredBy !== enteredBy) return false;
          return ms >= lo && ms <= hi;
        });
      }

      return [];
    }

    if (method === 'POST' && url.pathname === '/api/v1/treatments.json') {
      calls.post += 1;
      const _id = `mock-${treatments.length + 1}`;
      treatments.push({ ...body, _id });
      return [{ _id }];
    }

    if (method === 'PUT' && url.pathname === '/api/v1/treatments.json') {
      calls.put += 1;
      const idx = treatments.findIndex(t => t._id === body._id);
      if (idx >= 0) treatments[idx] = { ...treatments[idx], ...body };
      return { result: { n: idx >= 0 ? 1 : 0 } };
    }

    if (method === 'DELETE' && url.pathname.startsWith('/api/v1/treatments/')) {
      calls.delete += 1;
      const id = url.pathname.split('/').pop();
      const idx = treatments.findIndex(t => t._id === id);
      if (idx >= 0) treatments.splice(idx, 1);
      return { ok: true };
    }

    return [];
  }

  return { nsRequest, treatments, calls };
}

describe('ns_upsert_safe', () => {
  it('canonicalizes duplicate key matches and deletes extras', async () => {
    const entryKey = 'sha256:dup-key';
    const token = `[entry_key:${entryKey}]`;
    const mock = makeMockNs({
      initialTreatments: [
        {
          _id: 'old-id',
          enteredBy: 'Javordclaw-SSoT',
          eventType: 'Meal Bolus',
          carbs: 20,
          notes: `Lunch A ${token}`,
          created_at: '2026-03-23T20:01:00.000Z'
        },
        {
          _id: 'new-id',
          enteredBy: 'Javordclaw-SSoT',
          eventType: 'Meal Bolus',
          carbs: 21,
          notes: `Lunch B ${token}`,
          created_at: '2026-03-23T20:02:00.000Z'
        }
      ]
    });

    const payload = {
      enteredBy: 'Javordclaw-SSoT',
      eventType: 'Meal Bolus',
      carbs: 55,
      notes: `Lunch updated ${token}`,
      created_at: '2026-03-23T20:01:00.000Z'
    };

    const res = await upsertNightscoutTreatment({
      nsRequest: mock.nsRequest,
      payload,
      entryKey,
      titleForMatch: 'Lunch updated'
    });

    assert.strictEqual(res.status, 'updated');
    assert.strictEqual(res.treatmentId, 'old-id');
    assert.strictEqual(res.telemetry.duplicate_key_conflict_count, 1);
    assert.strictEqual(mock.calls.delete, 1);

    const remaining = mock.treatments.filter(t => (t.notes || '').includes(token));
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0]._id, 'old-id');
    assert.strictEqual(remaining[0].carbs, 55);
  });

  it('returns conflict on ambiguous fallback and performs no destructive write', async () => {
    const entryKey = 'sha256:new-key';
    const payload = {
      enteredBy: 'Javordclaw-SSoT',
      eventType: 'Meal Bolus',
      carbs: 50,
      notes: `Lunch: Japanese meal set [entry_key:${entryKey}]`,
      created_at: '2026-03-23T20:01:00.000Z'
    };

    const mock = makeMockNs({
      initialTreatments: [
        {
          _id: 'cand-1',
          enteredBy: 'Javordclaw-SSoT',
          eventType: 'Meal Bolus',
          carbs: 40,
          notes: 'Lunch: Japanese meal set (old 1)',
          created_at: '2026-03-23T20:00:30.000Z'
        },
        {
          _id: 'cand-2',
          enteredBy: 'Javordclaw-SSoT',
          eventType: 'Meal Bolus',
          carbs: 45,
          notes: 'Lunch: Japanese meal set (old 2)',
          created_at: '2026-03-23T20:01:20.000Z'
        }
      ]
    });

    const res = await upsertNightscoutTreatment({
      nsRequest: mock.nsRequest,
      payload,
      entryKey,
      titleForMatch: 'Lunch: Japanese meal set',
      normalizeForMatch: (s) => String(s || '').toLowerCase()
    });

    assert.strictEqual(res.status, 'conflict');
    assert.strictEqual(res.reason, 'ns_ambiguous_fallback_match');
    assert.strictEqual(res.telemetry.ambiguous_match_count, 1);
    assert.strictEqual(mock.calls.put, 0);
    assert.strictEqual(mock.calls.post, 0);
    assert.strictEqual(mock.calls.delete, 0);
  });

  it('returns verify error when post succeeds but key verification cannot find a unique match', async () => {
    const entryKey = 'sha256:verify-fail';
    const payload = {
      enteredBy: 'Javordclaw-SSoT',
      eventType: 'Note',
      carbs: 0,
      notes: `Metformin 500mg [entry_key:${entryKey}]`,
      created_at: '2026-03-23T20:00:00.000Z'
    };

    const mock = makeMockNs({ hideRegexLookups: true });

    const res = await upsertNightscoutTreatment({
      nsRequest: mock.nsRequest,
      payload,
      entryKey,
      titleForMatch: 'Metformin 500mg'
    });

    assert.strictEqual(res.status, 'error');
    assert.strictEqual(res.error, 'nightscout_verify_failed');
    assert.strictEqual(res.telemetry.verify_fail_count, 1);
    assert.strictEqual(mock.calls.post, 1);
  });
});
