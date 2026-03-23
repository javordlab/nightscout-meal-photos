#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const NORMALIZED_PATH = path.join(WORKSPACE, 'data', 'health_log.normalized.json');
const ENVELOPES_PATH = path.join(WORKSPACE, 'data', 'telegram_media_envelopes.jsonl');
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');
const REPORT_PATH = path.join(WORKSPACE, 'data', 'photo_link_watchdog_report.json');

const NOTION_KEY = process.env.NOTION_KEY || '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';
const IMAGE_TYPES = new Set(['PHOTO', 'PHOTO_TEXT', 'IMAGE_DOCUMENT']);

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadEnvelopes() {
  if (!fs.existsSync(ENVELOPES_PATH)) return [];
  return fs.readFileSync(ENVELOPES_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .filter(e => IMAGE_TYPES.has(String(e.contentType || '').toUpperCase()))
    .map(e => ({ ...e, tsMs: new Date(e.timestamp).getTime() }))
    .filter(e => Number.isFinite(e.tsMs));
}

function notionRequest(method, endpoint) {
  return new Promise((resolve, reject) => {
    const url = `https://api.notion.com/v1${endpoint}`;
    const req = https.request(url, {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function findNearestFoodEntry(envelope, entries) {
  const candidates = entries
    .filter(e => e.category === 'Food')
    .map(e => {
      const tsMs = new Date(e.timestamp).getTime();
      return { entry: e, diffMs: Math.abs(tsMs - envelope.tsMs) };
    })
    .filter(x => Number.isFinite(x.diffMs) && x.diffMs <= 3 * 60 * 1000)
    .sort((a, b) => a.diffMs - b.diffMs);

  return candidates[0] || null;
}

async function main(options = {}) {
  const lookbackHours = Number(options.lookbackHours || 24);
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;

  const normalized = loadJson(NORMALIZED_PATH, { entries: [] });
  const entries = normalized.entries || [];
  const syncState = loadJson(SYNC_STATE_PATH, { entries: {} }).entries || {};
  const envelopes = loadEnvelopes().filter(e => e.tsMs >= cutoffMs);

  const report = {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    imageEnvelopeCount: envelopes.length,
    matchedFoodEntries: 0,
    missing_photo_link_count: 0,
    missing_notion_photo_count: 0,
    issues: []
  };

  const notionPhotoCache = new Map();

  for (const env of envelopes) {
    const nearest = findNearestFoodEntry(env, entries);
    if (!nearest) continue;
    report.matchedFoodEntries++;

    const entry = nearest.entry;
    const hasLocalPhoto = Array.isArray(entry.photoUrls) && entry.photoUrls.length > 0;

    let hasNotionPhoto = null;
    const stateRow = syncState[entry.entryKey];
    const notionPageId = stateRow?.notion?.page_id || null;

    if (notionPageId) {
      if (!notionPhotoCache.has(notionPageId)) {
        try {
          const page = await notionRequest('GET', `/pages/${notionPageId}`);
          const url = page?.properties?.Photo?.url || null;
          notionPhotoCache.set(notionPageId, Boolean(url));
        } catch {
          notionPhotoCache.set(notionPageId, null);
        }
      }
      hasNotionPhoto = notionPhotoCache.get(notionPageId);
    }

    if (!hasLocalPhoto || hasNotionPhoto === false) {
      if (!hasLocalPhoto) report.missing_photo_link_count++;
      if (hasNotionPhoto === false) report.missing_notion_photo_count++;
      report.issues.push({
        envelopeId: env.envelopeId,
        messageId: env.messageId,
        contentType: env.contentType,
        envelopeTimestamp: env.timestamp,
        matchedEntryKey: entry.entryKey,
        matchedEntryTimestamp: entry.timestamp,
        matchedEntryTitle: entry.title,
        hasLocalPhoto,
        hasNotionPhoto,
        notionPageId
      });
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    missing_photo_link_count: report.missing_photo_link_count,
    missing_notion_photo_count: report.missing_notion_photo_count,
    issues: report.issues.length,
    reportPath: REPORT_PATH
  }, null, 2));

  return report;
}

if (require.main === module) {
  const arg = process.argv.find(a => a.startsWith('--lookback-hours='));
  const lookbackHours = arg ? Number(arg.split('=')[1]) : 24;
  main({ lookbackHours }).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { main, findNearestFoodEntry };
