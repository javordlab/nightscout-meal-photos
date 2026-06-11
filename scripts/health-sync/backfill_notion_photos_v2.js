#!/usr/bin/env node
/**
 * backfill_notion_photos_v2.js
 *
 * Rewritten to query Notion *directly* for all active Food pages and use their
 * "Entry Key" property to find the matching MySQL row. This avoids the bug in
 * sync_state.json where notion.page_id can point at archived duplicates.
 *
 * For each active Notion Food page:
 *   1. Read Entry Key property
 *   2. Look up MySQL health_log_entries for that entry_key
 *   3. If MySQL primary_photo_url is a GH Pages URL and Notion Photo is iili (or stale),
 *      PATCH Notion's Photo to the MySQL URL.
 */

const https = require('https');
const { execSync } = require('child_process');

const NOTION_KEY = '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';
const NOTION_DB  = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function notion(method, endpoint, body = null) {
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

async function queryAllActiveFoodPages() {
  const pages = [];
  let cursor = undefined;
  while (true) {
    const body = {
      filter: { property: 'Category', select: { equals: 'Food' } },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const r = await notion('POST', `/databases/${NOTION_DB}/query`, body);
    if (r.status !== 200) {
      console.error('query failed:', r.status, JSON.stringify(r.data).slice(0, 200));
      break;
    }
    for (const p of r.data.results || []) {
      if (p.archived) continue;
      pages.push(p);
    }
    if (!r.data.has_more) break;
    cursor = r.data.next_cursor;
    await sleep(150);
  }
  return pages;
}

function queryMysqlPhotoMap() {
  // entry_key -> primary_photo_url (only for rows that have a GH Pages URL)
  const sql = `
    SELECT entry_key, primary_photo_url
    FROM health_log_entries
    WHERE category='Food' AND deleted_at IS NULL
      AND primary_photo_url LIKE '%javordlab.github.io%';
  `;
  const out = execSync(`/usr/bin/sudo /opt/homebrew/opt/mysql@8.4/bin/mysql -N -B health_ssot`,
    { input: sql, encoding: 'utf8', timeout: 60000 }).trim();
  const map = new Map();
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ek, url] = line.split('\t');
    map.set(ek, url);
  }
  return map;
}

function readEntryKey(page) {
  const rt = page.properties?.['Entry Key']?.rich_text || [];
  return rt.map(t => t.plain_text).join('');
}

async function main() {
  console.log('Pulling all active Food pages from Notion...');
  const pages = await queryAllActiveFoodPages();
  console.log(`Active Food pages: ${pages.length}`);

  const mysqlMap = queryMysqlPhotoMap();
  console.log(`MySQL rows with GH Pages URL: ${mysqlMap.size}`);

  let patched = 0, already = 0, noEk = 0, noMysql = 0, failed = 0, ghSame = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const ek = readEntryKey(p);
    if (!ek) { noEk++; continue; }
    const mysqlUrl = mysqlMap.get(ek);
    if (!mysqlUrl) { noMysql++; continue; }
    const notionUrl = p.properties?.Photo?.url || '';
    if (notionUrl === mysqlUrl) { ghSame++; continue; }
    // Patch
    const r = await notion('PATCH', `/pages/${p.id}`, { properties: { Photo: { url: mysqlUrl } } });
    if (r.status === 200) patched++;
    else {
      failed++;
      if (failed <= 5) console.error(`  PATCH ${p.id} -> ${r.status}  ${JSON.stringify(r.data).slice(0,180)}`);
    }
    if ((i + 1) % 50 === 0) console.log(`  progress ${i+1}/${pages.length}: patched=${patched} same=${ghSame} no_mysql=${noMysql} fail=${failed}`);
    await sleep(350);  // ~3 req/s
  }
  console.log(`\nDone: patched=${patched} already_correct=${ghSame} no_entry_key=${noEk} no_mysql_match=${noMysql} failed=${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
