const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const https = require('https');

const { syncNightscout } = require('../../scripts/health-sync/unified_sync');

describe('Nightscout identity hardening', () => {
  const originalRequest = https.request;
  const treatments = [];
  const calls = { post: [], put: [] };

  function parseUrl(url) {
    return new URL(url);
  }

  function makeResponse(payload) {
    const res = new EventEmitter();
    process.nextTick(() => {
      res.emit('data', JSON.stringify(payload));
      res.emit('end');
    });
    return res;
  }

  function findByRegexToken(regexEncoded) {
    const decoded = decodeURIComponent(regexEncoded || '');
    let re = null;
    try {
      re = new RegExp(decoded);
    } catch {
      return [];
    }
    return treatments.filter(t => re.test(String(t.notes || '')));
  }

  before(() => {
    https.request = (url, options, callback) => {
      const req = new EventEmitter();
      let rawBody = '';

      req.write = (chunk) => {
        rawBody += chunk;
      };

      req.end = () => {
        const parsedUrl = parseUrl(url);
        const pathname = parsedUrl.pathname;
        const method = options?.method || 'GET';
        const body = rawBody ? JSON.parse(rawBody) : null;

        let payload = [];

        if (pathname === '/api/v1/treatments.json' && method === 'POST') {
          const _id = `mock-${treatments.length + 1}`;
          const row = { ...body, _id };
          treatments.push(row);
          calls.post.push(row);
          payload = [{ _id }];
        } else if (pathname === '/api/v1/treatments.json' && method === 'PUT') {
          const idx = treatments.findIndex(t => t._id === body?._id);
          if (idx >= 0) treatments[idx] = { ...treatments[idx], ...body };
          calls.put.push(body);
          payload = { result: { n: idx >= 0 ? 1 : 0 } };
        } else if (pathname === '/api/v1/treatments.json' && method === 'GET') {
          const q = parsedUrl.searchParams;
          const byId = q.get('find[_id]');
          const byRegex = q.get('find[notes][$regex]');

          if (byId) {
            payload = treatments.filter(t => t._id === byId);
          } else if (byRegex) {
            payload = findByRegexToken(byRegex);
          } else {
            payload = [];
          }
        }

        callback(makeResponse(payload));
      };

      req.on = req.addListener.bind(req);
      return req;
    };
  });

  after(() => {
    https.request = originalRequest;
  });

  beforeEach(() => {
    treatments.length = 0;
    calls.post.length = 0;
    calls.put.length = 0;
  });

  it('creates separate treatments for near timestamps with different eventType', async () => {
    const state = { version: 1, entries: {} };

    const medEntry = {
      entryKey: 'sha256:med-1300',
      timestamp: '2026-03-23T13:00:00-07:00',
      user: 'Maria Dennis',
      category: 'Medication',
      title: 'Metformin 500mg (lunch)',
      carbsEst: 0,
      caloriesEst: 0,
      photoUrls: []
    };

    const foodEntry = {
      entryKey: 'sha256:food-1301',
      timestamp: '2026-03-23T13:01:00-07:00',
      user: 'Maria Dennis',
      category: 'Food',
      title: 'Lunch: Japanese meal set',
      carbsEst: 55,
      caloriesEst: 480,
      proteinEst: 22,
      photoUrls: []
    };

    const medRes = await syncNightscout(medEntry, state);
    const foodRes = await syncNightscout(foodEntry, state);

    assert.strictEqual(medRes.status, 'created');
    assert.strictEqual(foodRes.status, 'created');
    assert.strictEqual(treatments.length, 2);

    const medRow = treatments.find(t => (t.notes || '').includes('[entry_key:sha256:med-1300]'));
    const foodRow = treatments.find(t => (t.notes || '').includes('[entry_key:sha256:food-1301]'));

    assert.ok(medRow, 'medication row should exist by entry_key');
    assert.ok(foodRow, 'food row should exist by entry_key');
    assert.strictEqual(medRow.eventType, 'Note');
    assert.strictEqual(foodRow.eventType, 'Meal Bolus');
  });

  it('updates by entry_key/treatment_id without touching adjacent entries', async () => {
    const state = { version: 1, entries: {} };

    const medEntry = {
      entryKey: 'sha256:med-1300',
      timestamp: '2026-03-23T13:00:00-07:00',
      user: 'Maria Dennis',
      category: 'Medication',
      title: 'Metformin 500mg (lunch)',
      carbsEst: 0,
      caloriesEst: 0,
      photoUrls: []
    };

    const foodEntry = {
      entryKey: 'sha256:food-1301',
      timestamp: '2026-03-23T13:01:00-07:00',
      user: 'Maria Dennis',
      category: 'Food',
      title: 'Lunch: Japanese meal set',
      carbsEst: 55,
      caloriesEst: 480,
      proteinEst: 22,
      photoUrls: []
    };

    await syncNightscout(medEntry, state);
    const firstFood = await syncNightscout(foodEntry, state);

    const updatedFood = { ...foodEntry, carbsEst: 60, title: 'Lunch: Japanese meal set + tea' };
    const secondFood = await syncNightscout(updatedFood, state);

    assert.strictEqual(firstFood.status, 'created');
    assert.strictEqual(secondFood.status, 'updated');

    const medRow = treatments.find(t => (t.notes || '').includes('[entry_key:sha256:med-1300]'));
    const foodRow = treatments.find(t => (t.notes || '').includes('[entry_key:sha256:food-1301]'));

    assert.ok(medRow);
    assert.ok(foodRow);
    assert.strictEqual(medRow.carbs, 0);
    assert.strictEqual(foodRow.carbs, 60);
    assert.strictEqual(treatments.length, 2, 'should not create extra row for food update');
    assert.ok(calls.put.length >= 1, 'food update should issue PUT');
  });
});
