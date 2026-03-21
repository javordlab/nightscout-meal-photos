#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const GALLERY_PATH = path.join(WORKSPACE, 'nightscout-meal-photos', 'data', 'notion_meals.json');

const { loadSyncState, saveSyncState, upsertEntry } = require('./sync_state');

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sameDay(a, b) {
  return String(a || '').slice(0, 10) === String(b || '').slice(0, 10);
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function main() {
  const normalized = loadJson(NORMALIZED_PATH, { entries: [] });
  const syncState = loadSyncState(SYNC_STATE_PATH);
  const galleryItems = loadJson(GALLERY_PATH, []);

  let notionMatches = 0;
  let galleryMatches = 0;

  for (const entry of normalized.entries || []) {
    const photo = entry.photoUrls && entry.photoUrls[0];
    const title = normalizeTitle(entry.title);

    const galleryMatch = galleryItems.find(item => {
      if (photo && item.photo === photo) return true;
      return sameDay(item.date, entry.timestamp) && normalizeTitle(item.title).includes(title);
    });

    if (!galleryMatch) continue;

    const patch = {
      content_hash: entry.contentHash,
      timestamp: entry.timestamp,
      user: entry.user,
      category: entry.category,
      meal_type: entry.mealType,
      title: entry.title,
      photo_urls: entry.photoUrls
    };

    if (galleryMatch.id) {
      patch.gallery = {
        ...(syncState.entries[entry.entryKey]?.gallery || {}),
        gallery_id: galleryMatch.id,
        last_synced_at: new Date().toISOString()
      };
      galleryMatches++;
    }

    if (/^[0-9a-f-]{20,}$/i.test(galleryMatch.id || '')) {
      patch.notion = {
        ...(syncState.entries[entry.entryKey]?.notion || {}),
        page_id: galleryMatch.id,
        last_synced_at: new Date().toISOString()
      };
      notionMatches++;
    }

    upsertEntry(syncState, entry.entryKey, patch);
  }

  saveSyncState(SYNC_STATE_PATH, syncState);
  console.log(`Enriched sync state. notionMatches=${notionMatches}, galleryMatches=${galleryMatches}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
