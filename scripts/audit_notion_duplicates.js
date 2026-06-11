#!/usr/bin/env node
/**
 * audit_notion_duplicates.js
 * Queries the Notion Health Log database and identifies duplicate pages
 * (multiple pages sharing the same Entry Key).
 */

const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

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
  let pageNum = 0;

  while (true) {
    pageNum++;
    const body = {
      page_size: 100,
      sorts: [{ property: 'Date', direction: 'descending' }],
    };
    if (startCursor) body.start_cursor = startCursor;

    const res = await notionRequest('POST', `/databases/${NOTION_DB_ID}/query`, body);

    if (res.results) {
      allPages.push(...res.results);
      process.stderr.write(`  Fetched page ${pageNum}: ${res.results.length} results (total: ${allPages.length})\n`);
    }

    if (!res.has_more || !res.next_cursor) break;
    startCursor = res.next_cursor;
  }

  return allPages;
}

function extractProps(page) {
  const props = page.properties || {};
  const entryKey = props['Entry Key']?.rich_text?.[0]?.plain_text || '';
  const title = props['Entry']?.title?.[0]?.plain_text || '';
  const date = props['Date']?.date?.start || '';
  const category = props['Category']?.select?.name || '';
  const user = props['User']?.select?.name || '';
  const carbs = props['Carbs (est)']?.number;
  const cals = props['Calories (est)']?.number;
  return { id: page.id, entryKey, title, date, category, user, carbs, cals, createdTime: page.created_time };
}

async function main() {
  console.log('Fetching all pages from Maria Health Log...\n');
  const pages = await fetchAllPages();
  console.log(`\nTotal pages in Notion: ${pages.length}\n`);

  // Group by Entry Key
  const byKey = {};
  const noKey = [];

  for (const page of pages) {
    const p = extractProps(page);
    if (!p.entryKey) {
      noKey.push(p);
      continue;
    }
    if (!byKey[p.entryKey]) byKey[p.entryKey] = [];
    byKey[p.entryKey].push(p);
  }

  // Find duplicates (entry keys with >1 page)
  const duplicates = Object.entries(byKey)
    .filter(([_, pages]) => pages.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  console.log('=== DUPLICATE ANALYSIS ===\n');
  console.log(`Entry keys with duplicates: ${duplicates.length}`);
  console.log(`Total duplicate pages (extras): ${duplicates.reduce((sum, [_, p]) => sum + p.length - 1, 0)}`);
  console.log(`Pages with no Entry Key: ${noKey.length}\n`);

  if (duplicates.length === 0) {
    console.log('No duplicates found!');
    return;
  }

  // Summary table
  console.log('--- Duplicate Summary (sorted by count desc) ---\n');
  console.log('Count | Date (PT)            | Category   | Title (truncated)');
  console.log('------+----------------------+------------+------------------------------------------');

  for (const [key, pages] of duplicates) {
    const p = pages[0];
    const titleShort = p.title.length > 70 ? p.title.substring(0, 67) + '...' : p.title;
    console.log(`  ${String(pages.length).padStart(3)}  | ${p.date.substring(0, 19).padEnd(20)} | ${p.category.padEnd(10)} | ${titleShort}`);
  }

  // Detailed per-duplicate
  console.log('\n\n--- Detailed Duplicate Entries ---\n');
  for (const [key, pages] of duplicates) {
    console.log(`Entry Key: ${key}`);
    console.log(`  Title: ${pages[0].title.substring(0, 100)}`);
    console.log(`  Date: ${pages[0].date}`);
    console.log(`  Count: ${pages.length} pages (${pages.length - 1} extras to delete)`);
    console.log(`  Page IDs:`);
    for (const p of pages) {
      console.log(`    - ${p.id} (created: ${p.createdTime})`);
    }
    console.log('');
  }

  // Date distribution of duplicates
  console.log('\n--- Duplicates by Date ---\n');
  const byDate = {};
  for (const [key, pages] of duplicates) {
    const date = pages[0].date.substring(0, 10);
    if (!byDate[date]) byDate[date] = { keys: 0, extraPages: 0 };
    byDate[date].keys++;
    byDate[date].extraPages += pages.length - 1;
  }
  const sortedDates = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  console.log('Date       | Dup Keys | Extra Pages');
  console.log('-----------+----------+------------');
  for (const [date, stats] of sortedDates) {
    console.log(`${date} |    ${String(stats.keys).padStart(4)} |      ${String(stats.extraPages).padStart(4)}`);
  }

  // Total cleanup needed
  const totalExtras = duplicates.reduce((sum, [_, p]) => sum + p.length - 1, 0);
  console.log(`\n=== CLEANUP SUMMARY ===`);
  console.log(`Total unique entries with duplicates: ${duplicates.length}`);
  console.log(`Total extra pages to delete: ${totalExtras}`);
  console.log(`Total pages that should remain: ${Object.keys(byKey).length + noKey.length}`);
}

main().catch(console.error);
