#!/usr/bin/env node
/**
 * publish_photos_to_gh_pages.js
 *
 * For every health_ssot.health_log_entries row whose primary_photo_url still
 * points at iili.io (free host, expires), find the original local file via
 * data/photo_upload_log.jsonl, copy it into
 * nightscout-meal-photos/uploads/YYYY-MM-DD/<entry_key_prefix>.jpg,
 * rewrite primary_photo_url to the durable GitHub Pages URL, and keep the
 * iili.io URL as a secondary entry in photo_urls.
 *
 * Then trigger deploy_gh_pages.js so the file is actually served.
 *
 * Designed to be run after every sync (cron).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { writeReceipt } = require('./cron_receipt');

const WORKSPACE   = '/Users/javier/.openclaw/workspace';
const SITE_DIR    = path.join(WORKSPACE, 'nightscout-meal-photos');
const UPLOADS_DIR = path.join(SITE_DIR, 'uploads');
const UPLOAD_LOG  = path.join(WORKSPACE, 'data', 'photo_upload_log.jsonl');
const DEPLOY      = path.join(WORKSPACE, 'scripts', 'health-sync', 'deploy_gh_pages.js');
const PHASH_HELPER = path.join(WORKSPACE, 'scripts', 'health-sync', 'match_iili_to_local.py');
const INBOUND     = '/Users/javier/.openclaw/media/inbound';

const GH_BASE   = 'https://javordlab.github.io/nightscout-meal-photos/uploads';
const NOTION_KEY = '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';

const NOTION_DB = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

function notionReq(method, endpoint, body = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(`https://api.notion.com/v1${endpoint}`, { method, headers }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', err => resolve({ status: 0, data: { error: err.message } }));
    if (data) req.write(data);
    req.end();
  });
}

// Look up the *active* Notion page for an entry_key by querying the DB.
// This avoids stale page_ids in sync_state.json that point at archived duplicates.
async function findActivePageId(entryKey) {
  const r = await notionReq('POST', `/databases/${NOTION_DB}/query`, {
    filter: { property: 'Entry Key', rich_text: { equals: entryKey } },
    page_size: 5,
  });
  if (r.status !== 200) return null;
  const active = (r.data.results || []).filter(p => !p.archived);
  return active.length ? active[0].id : null;
}

async function notionPatchPhoto(entryKey, url) {
  const pageId = await findActivePageId(entryKey);
  if (!pageId) return { status: 404, body: 'no active page found' };
  const r = await notionReq('PATCH', `/pages/${pageId}`, { properties: { Photo: { url } } });
  return { status: r.status, body: typeof r.data === 'string' ? r.data.slice(0,200) : JSON.stringify(r.data).slice(0,200) };
}

// Fallback when photo_upload_log.jsonl has no mapping: download each iili URL,
// phash it, compare to local inbound files. Returns a Map of iiliUrl -> full path
// (or null for unmatched / expired URLs).
function phashMatchBatch(urls) {
  if (!urls.length) return new Map();
  try {
    const out = execSync(`/usr/bin/python3 ${PHASH_HELPER}`, {
      input: JSON.stringify({ urls }),
      encoding: 'utf8',
      timeout: 60000 + urls.length * 2000,
    });
    const results = JSON.parse(out);
    const map = new Map();
    for (const r of results) {
      if (r.match) map.set(r.url, path.join(INBOUND, r.match));
      else map.set(r.url, null);
    }
    return map;
  } catch (e) {
    console.error(`phashMatchBatch failed: ${e.message}`);
    return new Map();
  }
}

function loadUploadMap() {
  const map = new Map();
  if (!fs.existsSync(UPLOAD_LOG)) return map;
  const data = fs.readFileSync(UPLOAD_LOG, 'utf8');
  for (const line of data.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const j = JSON.parse(s);
      if (j.iiliUrl && j.photoPath) map.set(j.iiliUrl, j.photoPath);
    } catch { /* skip malformed */ }
  }
  return map;
}

function runMySQL(sql) {
  return execSync(
    `/usr/bin/sudo /opt/homebrew/opt/mysql@8.4/bin/mysql -N -B health_ssot`,
    { input: sql, encoding: 'utf8', timeout: 60000 }
  );
}

function queryPending() {
  const sql = `
    SELECT entry_key, event_date, primary_photo_url
    FROM health_log_entries
    WHERE category = 'Food'
      AND deleted_at IS NULL
      AND primary_photo_url LIKE '%iili.io%'
    ORDER BY event_date DESC
    LIMIT 500;
  `;
  const out = runMySQL(sql).trim();
  if (!out) return [];
  return out.split('\n').map(line => {
    const [entry_key, event_date, primary_photo_url] = line.split('\t');
    return { entry_key, event_date, primary_photo_url };
  });
}

function sqlLiteral(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

async function main() {
  const map = loadUploadMap();
  if (map.size === 0) {
    console.log('publish_photos: no upload log entries yet');
    writeReceipt({ status: 'noop', summary: 'no upload log entries yet' });
    return;
  }
  const pending = queryPending();
  if (pending.length === 0) {
    console.log('publish_photos: no iili-URL rows to promote');
    writeReceipt({ status: 'noop', summary: 'no iili-URL rows to promote' });
    return;
  }

  let published = 0;
  let missing = 0;
  let phashRecovered = 0;
  const updates = [];
  const notionPatches = [];  // {pageId, ghUrl, entry_key}
  const ssotRewrites = [];   // {iili, gh} — for rewriting health_log.md below

  // First pass: collect pending iili URLs that aren't in the log (need phash).
  const phashUrls = [];
  for (const row of pending) {
    const cached = map.get(row.primary_photo_url);
    if (!cached || !fs.existsSync(cached)) {
      phashUrls.push(row.primary_photo_url);
    }
  }
  const phashMap = phashUrls.length ? phashMatchBatch(phashUrls) : new Map();
  if (phashUrls.length) {
    const hits = [...phashMap.values()].filter(Boolean).length;
    console.log(`publish_photos: phash fallback ran for ${phashUrls.length} URL(s), matched ${hits}`);
  }

  for (const row of pending) {
    let localPath = map.get(row.primary_photo_url);
    if (!localPath || !fs.existsSync(localPath)) {
      localPath = phashMap.get(row.primary_photo_url);
      if (!localPath || !fs.existsSync(localPath)) { missing++; continue; }
      phashRecovered++;
      // Append the recovered mapping to the log so next run uses the fast path.
      try {
        fs.appendFileSync(UPLOAD_LOG, JSON.stringify({
          photoPath: localPath,
          iiliUrl: row.primary_photo_url,
          uploadedAt: new Date().toISOString(),
          source: 'phash_recovery',
        }) + '\n');
      } catch {}
    }

    const day = row.event_date;
    const prefix = row.entry_key.replace(/^sha256:/, '').slice(0, 16);
    const destDir = path.join(UPLOADS_DIR, day);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, `${prefix}.jpg`);
    fs.copyFileSync(localPath, destPath);
    published++;

    const ghUrl = `${GH_BASE}/${day}/${prefix}.jpg`;
    updates.push(
      `UPDATE health_log_entries ` +
      `SET photo_urls = JSON_ARRAY(${sqlLiteral(ghUrl)}, primary_photo_url), ` +
      `    primary_photo_url = ${sqlLiteral(ghUrl)} ` +
      `WHERE entry_key = ${sqlLiteral(row.entry_key)};`
    );

    // We query Notion for the active page_id at patch time (sync_state can be stale).
    notionPatches.push({ entry_key: row.entry_key, ghUrl });
    ssotRewrites.push({ iili: row.primary_photo_url, gh: ghUrl });
  }

  if (updates.length === 0) {
    console.log(`publish_photos: ${missing} rows had no local file; nothing to publish`);
    writeReceipt({ status: 'noop', summary: `${missing} rows had no local file; nothing to publish`, metrics: { missing } });
    return;
  }

  const sql = 'START TRANSACTION;\n' + updates.join('\n') + '\nCOMMIT;\n';
  runMySQL(sql);
  console.log(`publish_photos: promoted ${published} MySQL photos (${phashRecovered} via phash, ${missing} unmapped)`);

  // Rewrite the SSoT (health_log.md) inline so the next radial_dispatcher run
  // propagates the github URLs downstream instead of reverting Notion to iili.
  try {
    const HEALTH_LOG = path.join(WORKSPACE, 'health_log.md');
    let txt = fs.readFileSync(HEALTH_LOG, 'utf8');
    let rewrites = 0;
    for (const { iili, gh } of ssotRewrites) {
      if (!iili || !txt.includes(iili)) continue;
      const esc = iili.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const before = txt;
      txt = txt.replace(new RegExp(esc, 'g'), gh);
      if (txt !== before) rewrites++;
    }
    if (rewrites) {
      // Atomic write: health_log.md is the SSoT — a crash mid-write must not
      // leave it truncated.
      const tmp = HEALTH_LOG + '.tmp';
      fs.writeFileSync(tmp, txt);
      fs.renameSync(tmp, HEALTH_LOG);
      console.log(`publish_photos: rewrote ${rewrites} iili URL(s) in health_log.md (SSoT)`);
    }
  } catch (e) {
    console.error(`publish_photos: health_log.md rewrite failed: ${e.message}`);
  }

  // Patch Notion pages — query each entry_key for the active page at patch time.
  let notionOk = 0, notionFail = 0, notionNoPage = 0;
  for (const p of notionPatches) {
    const r = await notionPatchPhoto(p.entry_key, p.ghUrl);
    if (r.status === 200) notionOk++;
    else if (r.status === 404) notionNoPage++;
    else {
      notionFail++;
      if (notionFail <= 3) console.error(`  Notion PATCH (${p.entry_key.slice(0,20)}) -> ${r.status}  ${r.body.slice(0,150)}`);
    }
  }
  console.log(`publish_photos: patched ${notionOk} Notion pages (${notionFail} failed, ${notionNoPage} no active page)`);

  // Deploy to GitHub Pages
  let deployFailed = false;
  try {
    execSync(`/opt/homebrew/bin/node ${DEPLOY}`, { stdio: 'inherit', timeout: 180000 });
  } catch (e) {
    console.error(`publish_photos: deploy_gh_pages.js failed: ${e.message}`);
    deployFailed = true;
    process.exitCode = 1;
  }

  // Cron receipt: 'partial' if any Notion patch or the deploy failed (the run
  // still published photos), 'ok' otherwise. Outright failures are reported
  // as 'error' in main().catch below.
  const partial = notionFail > 0 || deployFailed;
  writeReceipt({
    status: partial ? 'partial' : 'ok',
    summary: `published ${published} (${phashRecovered} phash, ${missing} unmapped); Notion ${notionOk} ok / ${notionFail} failed / ${notionNoPage} no page${deployFailed ? '; DEPLOY FAILED' : ''}`,
    metrics: { published, missing, phashRecovered, notionOk, notionFail, notionNoPage, deployFailed: deployFailed ? 1 : 0 },
  });
}

main().catch(e => {
  console.error('publish_photos fatal:', e.message);
  writeReceipt({ status: 'error', summary: `fatal: ${e.message}` });
  process.exit(1);
});
