#!/usr/bin/env node
/**
 * backfill_notion_photos.js
 *
 * One-off: for every health_ssot.health_log_entries row whose primary_photo_url
 * is already a GitHub Pages URL, look up the Notion page_id via sync_state.json
 * and PATCH the page's "Photo" property to match.
 *
 * Safe to re-run: it's idempotent (just writes the same URL if already correct).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const WORKSPACE  = '/Users/javier/.openclaw/workspace';
const SYNC_STATE = path.join(WORKSPACE, 'data', 'sync_state.json');
const NOTION_KEY = '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';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function notionPatchPhoto(pageId, url) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ properties: { Photo: { url } } });
    const req = https.request(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', err => resolve({ status: 0, body: err.message }));
    req.write(body);
    req.end();
  });
}

function loadNotionIndex() {
  const j = JSON.parse(fs.readFileSync(SYNC_STATE, 'utf8'));
  const map = new Map();
  for (const [ek, v] of Object.entries(j.entries || {})) {
    if (v?.notion?.page_id) map.set(ek, v.notion.page_id);
  }
  return map;
}

function queryGhPagesRows() {
  const sql = `
    SELECT entry_key, primary_photo_url
    FROM health_log_entries
    WHERE category = 'Food'
      AND deleted_at IS NULL
      AND primary_photo_url LIKE '%javordlab.github.io%'
    ORDER BY event_date DESC;
  `;
  const out = execSync(
    `/usr/bin/sudo /opt/homebrew/opt/mysql@8.4/bin/mysql -N -B health_ssot`,
    { input: sql, encoding: 'utf8', timeout: 60000 }
  ).trim();
  if (!out) return [];
  return out.split('\n').map(line => {
    const [entry_key, primary_photo_url] = line.split('\t');
    return { entry_key, primary_photo_url };
  });
}

async function main() {
  const notionIndex = loadNotionIndex();
  const rows = queryGhPagesRows();
  console.log(`backfill_notion_photos: ${rows.length} rows, ${notionIndex.size} page_id mappings in sync_state`);

  let ok = 0, fail = 0, nopage = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pageId = notionIndex.get(r.entry_key);
    if (!pageId) { nopage++; continue; }
    const res = await notionPatchPhoto(pageId, r.primary_photo_url);
    if (res.status === 200) ok++;
    else {
      fail++;
      if (fail <= 5) console.error(`  PATCH ${pageId} -> ${res.status} ${res.body.slice(0, 140)}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  progress ${i + 1}/${rows.length}: ok=${ok} fail=${fail} nopage=${nopage}`);
    // Notion API has a 3 req/s rate limit. Sleep 350ms to stay under it.
    await sleep(350);
  }
  console.log(`\nbackfill_notion_photos done: patched=${ok} failed=${fail} no_page_id=${nopage}`);
}

main().catch(e => { console.error(e); process.exit(1); });
