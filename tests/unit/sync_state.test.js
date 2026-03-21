const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_DIR = path.join(__dirname, '..', 'fixtures');
const TEST_STATE_PATH = path.join(TEST_DIR, 'test_sync_state.json');
const TEST_LOG_PATH = path.join(TEST_DIR, 'test_health_log.md');

// Import modules under test
const { loadSyncState, saveSyncState, upsertEntry, getEntry } = require('../../scripts/health-sync/sync_state');

describe('Sync State Management', () => {
  before(() => {
    // Setup test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  after(() => {
    // Cleanup
    if (fs.existsSync(TEST_STATE_PATH)) {
      fs.unlinkSync(TEST_STATE_PATH);
    }
  });

  it('should create new sync state', () => {
    const state = loadSyncState(TEST_STATE_PATH);
    assert.strictEqual(state.version, 1);
    assert.deepStrictEqual(state.entries, {});
  });

  it('should upsert entry with notion page_id', () => {
    const state = loadSyncState(TEST_STATE_PATH);
    const entryKey = 'sha256:test123';
    
    upsertEntry(state, entryKey, {
      notion: { page_id: 'test-page-123', last_synced_at: new Date().toISOString() }
    });
    
    const entry = getEntry(state, entryKey);
    assert.strictEqual(entry.notion.page_id, 'test-page-123');
    
    saveSyncState(TEST_STATE_PATH, state);
    
    // Verify persistence
    const reloaded = loadSyncState(TEST_STATE_PATH);
    assert.strictEqual(reloaded.entries[entryKey].notion.page_id, 'test-page-123');
  });

  it('should upsert entry with nightscout treatment_id', () => {
    const state = loadSyncState(TEST_STATE_PATH);
    const entryKey = 'sha256:test456';
    
    upsertEntry(state, entryKey, {
      nightscout: { treatment_id: 'treat-456', last_synced_at: new Date().toISOString() }
    });
    
    const entry = getEntry(state, entryKey);
    assert.strictEqual(entry.nightscout.treatment_id, 'treat-456');
  });

  it('should merge updates without losing existing data', () => {
    const state = loadSyncState(TEST_STATE_PATH);
    const entryKey = 'sha256:test789';
    
    // First upsert
    upsertEntry(state, entryKey, {
      notion: { page_id: 'page-789', last_synced_at: '2024-01-01' },
      nightscout: { treatment_id: 'treat-789', last_synced_at: '2024-01-01' }
    });
    
    // Second upsert should preserve existing data
    upsertEntry(state, entryKey, {
      notion: { page_id: 'page-789-updated', last_synced_at: '2024-01-02' }
    });
    
    const entry = getEntry(state, entryKey);
    assert.strictEqual(entry.notion.page_id, 'page-789-updated');
    assert.strictEqual(entry.nightscout.treatment_id, 'treat-789'); // Should be preserved
  });
});

describe('Entry Key Generation', () => {
  const crypto = require('crypto');
  
  function generateEntryKey(entry) {
    const basis = `${entry.timestamp}|${entry.user}|${entry.title}`;
    return `sha256:${crypto.createHash('sha256').update(basis).digest('hex')}`;
  }

  it('should generate consistent entry keys', () => {
    const entry = {
      timestamp: '2026-03-21T09:00:00-07:00',
      user: 'Maria Dennis',
      title: 'Breakfast: Test entry'
    };
    
    const key1 = generateEntryKey(entry);
    const key2 = generateEntryKey(entry);
    
    assert.strictEqual(key1, key2);
    assert.ok(key1.startsWith('sha256:'));
  });

  it('should generate different keys for different entries', () => {
    const entry1 = {
      timestamp: '2026-03-21T09:00:00-07:00',
      user: 'Maria Dennis',
      title: 'Breakfast: Entry 1'
    };
    
    const entry2 = {
      timestamp: '2026-03-21T09:00:00-07:00',
      user: 'Maria Dennis',
      title: 'Breakfast: Entry 2'
    };
    
    const key1 = generateEntryKey(entry1);
    const key2 = generateEntryKey(entry2);
    
    assert.notStrictEqual(key1, key2);
  });
});
