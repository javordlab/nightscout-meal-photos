const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '..', 'fixtures');

// We need to override the LEDGER_PATH for testing. The module uses a hardcoded
// path, so we test via its exported functions after temporarily swapping the file.
const ledgerModule = require('../../scripts/health-sync/confirmation_ledger');
const REAL_LEDGER_PATH = ledgerModule.LEDGER_PATH;
const TEST_LEDGER_PATH = path.join(TEST_DIR, 'test_write_ledger.jsonl');

describe('Confirmation Ledger', () => {
  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    // Point the ledger to test path by temporarily overwriting the file
    cleanup();
  });

  after(() => {
    cleanup();
  });

  function cleanup() {
    if (fs.existsSync(TEST_LEDGER_PATH)) fs.unlinkSync(TEST_LEDGER_PATH);
    // Also clean up the real ledger test entries (we'll use the real module
    // but verify via direct file reads against the real path)
    if (fs.existsSync(REAL_LEDGER_PATH)) {
      // Save and restore later
    }
  }

  it('should record a write entry as valid JSONL', () => {
    const entry = {
      entryKey: 'sha256:abc123',
      timestamp: '2026-03-24T20:06:00-07:00',
      category: 'Activity',
      description: '25 minutes walk'
    };

    const record = ledgerModule.recordWrite(entry);

    assert.ok(record.ts, 'should have a timestamp');
    assert.strictEqual(record.entryKey, 'sha256:abc123');
    assert.strictEqual(record.category, 'Activity');
    assert.strictEqual(record.description, '25 minutes walk');

    // Verify the file has valid JSONL
    const raw = fs.readFileSync(REAL_LEDGER_PATH, 'utf8').trim();
    const lines = raw.split('\n');
    assert.ok(lines.length >= 1, 'should have at least one line');

    const parsed = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(parsed.entryKey, 'sha256:abc123');
  });

  it('should append multiple entries without overwriting', () => {
    const entry1 = {
      entryKey: 'sha256:first',
      timestamp: '2026-03-24T10:00:00-07:00',
      category: 'Food',
      description: 'Breakfast: Oatmeal'
    };
    const entry2 = {
      entryKey: 'sha256:second',
      timestamp: '2026-03-24T12:00:00-07:00',
      category: 'Medication',
      description: 'Metformin 500mg (lunch)'
    };

    ledgerModule.recordWrite(entry1);
    ledgerModule.recordWrite(entry2);

    const all = ledgerModule.readLedgerLines();
    const keys = all.map(r => r.entryKey);
    assert.ok(keys.includes('sha256:first'), 'should contain first entry');
    assert.ok(keys.includes('sha256:second'), 'should contain second entry');
  });

  it('should reject writes missing required fields', () => {
    assert.throws(
      () => ledgerModule.recordWrite({ timestamp: '2026-03-24T10:00:00-07:00' }),
      /entryKey/,
      'should throw if entryKey missing'
    );
    assert.throws(
      () => ledgerModule.recordWrite({ entryKey: 'sha256:x' }),
      /timestamp/,
      'should throw if timestamp missing'
    );
  });

  it('should detect recent writes with hasRecentWrite', () => {
    // The entries we wrote above should still be recent (written seconds ago)
    const has = ledgerModule.hasRecentWrite('sha256:abc123');
    assert.strictEqual(has, true, 'should find recently written entry');

    const missing = ledgerModule.hasRecentWrite('sha256:nonexistent');
    assert.strictEqual(missing, false, 'should not find nonexistent entry');
  });

  it('should filter by time window in loadLedger', () => {
    const futureIso = new Date(Date.now() + 60000).toISOString();
    const results = ledgerModule.loadLedger(futureIso);
    assert.strictEqual(results.length, 0, 'future cutoff should return no entries');

    const pastIso = new Date(Date.now() - 3600000).toISOString();
    const results2 = ledgerModule.loadLedger(pastIso);
    assert.ok(results2.length > 0, 'past cutoff should return entries');
  });

  it('should truncate description to 120 chars', () => {
    const longDesc = 'A'.repeat(200);
    const record = ledgerModule.recordWrite({
      entryKey: 'sha256:longdesc',
      timestamp: '2026-03-24T15:00:00-07:00',
      category: 'Food',
      description: longDesc
    });
    assert.strictEqual(record.description.length, 120);
  });
});
