#!/usr/bin/env node
/**
 * cleanup_notion_duplicates.js
 *
 * One-shot script to archive duplicate Notion pages in the Maria Health Log.
 * For each Entry Key with multiple pages, keeps the OLDEST page (original)
 * and archives the rest.
 *
 * Usage:
 *   node scripts/cleanup_notion_duplicates.js          # dry-run (default)
 *   node scripts/cleanup_notion_duplicates.js --apply   # actually archive
 */

const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const DRY_RUN = !process.argv.includes('--apply');

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: `/v1${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function fetchAllPages() {
  const allPages = [];
  let startCursor = undefined;
  while (true) {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    const res = await notionRequest('POST', `/databases/${NOTION_DB_ID}/query`, body);
    if (res.results) allPages.push(...res.results.filter(r => !r.archived));
    if (!res.has_more || !res.next_cursor) break;
    startCursor = res.next_cursor;
  }
  return allPages;
}

async function main() {
  if (DRY_RUN) {
    console.log('=== DRY RUN (pass --apply to actually archive) ===\n');
  } else {
    console.log('=== APPLYING — will archive duplicate pages ===\n');
  }

  console.log('Fetching all pages from Notion...');
  const pages = await fetchAllPages();
  console.log(`Total active pages: ${pages.length}\n`);

  // Group by Entry Key
  const byKey = {};
  for (const page of pages) {
    const entryKey = page.properties?.['Entry Key']?.rich_text?.[0]?.plain_text || '';
    if (!entryKey) continue;
    if (!byKey[entryKey]) byKey[entryKey] = [];
    byKey[entryKey].push({
      id: page.id,
      createdTime: page.created_time,
      title: (page.properties?.Entry?.title?.[0]?.plain_text || '').slice(0, 80),
      date: page.properties?.Date?.date?.start || '',
    });
  }

  // Find duplicates
  const duplicates = Object.entries(byKey).filter(([_, p]) => p.length > 1);

  if (duplicates.length === 0) {
    console.log('No duplicates found. Nothing to do.');
    return;
  }

  let totalArchived = 0;
  let totalKept = 0;

  for (const [key, pages] of duplicates) {
    // Sort by created_time ascending — keep the oldest (original)
    pages.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    const keep = pages[0];
    const toArchive = pages.slice(1);

    console.log(`Entry Key: ${key.slice(0, 20)}...`);
    console.log(`  Title: ${keep.title}`);
    console.log(`  Date: ${keep.date}`);
    console.log(`  KEEP: ${keep.id} (created ${keep.createdTime})`);

    for (const dupe of toArchive) {
      if (DRY_RUN) {
        console.log(`  [DRY] Would archive: ${dupe.id} (created ${dupe.createdTime})`);
      } else {
        process.stdout.write(`  Archiving: ${dupe.id}...`);
        await notionRequest('PATCH', `/pages/${dupe.id}`, { archived: true });
        console.log(' done');
      }
    }

    totalKept++;
    totalArchived += toArchive.length;
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Duplicate groups: ${duplicates.length}`);
  console.log(`Pages kept (canonical): ${totalKept}`);
  console.log(`Pages ${DRY_RUN ? 'to archive' : 'archived'}: ${totalArchived}`);
  console.log(`Pages unaffected: ${pages.length - totalArchived - totalKept}`);

  if (DRY_RUN) {
    console.log('\nRe-run with --apply to execute.');
  }
}

main().catch(console.error);
