#!/usr/bin/env node
/**
 * check_notion.js — Consolidated Notion database query tool.
 *
 * Usage:
 *   node check_notion.js --mode=today
 *   node check_notion.js --mode=24h
 *   node check_notion.js --mode=3d
 *   node check_notion.js --mode=recent [--count=10]
 *   node check_notion.js --mode=projections
 *
 * Replaces: check_notion_today.js, check_notion_last_24h.js,
 *           check_notion_last_3_days.js, check_notion_recent.js,
 *           check_notion_projections.js
 */

'use strict';

const https = require('https');

const NOTION_KEY = process.env.NOTION_KEY || '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';
const DATABASE_ID = process.env.NOTION_DB_ID || '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function localDateString(offset = 0) {
  const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function parseArgs() {
  const args = { mode: 'today', count: 10 };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--mode=')) args.mode = a.split('=')[1];
    if (a.startsWith('--count=')) args.count = parseInt(a.split('=')[1], 10) || 10;
  }
  return args;
}

function buildFilter(mode) {
  switch (mode) {
    case 'today':
      return { property: 'Date', date: { on_or_after: localDateString(0) } };
    case '24h':
      return { property: 'Date', date: { on_or_after: new Date(Date.now() - 24 * 3600000).toISOString() } };
    case '3d':
      return { property: 'Date', date: { on_or_after: localDateString(-3) } };
    case 'recent':
      return undefined; // no filter, use page_size
    case 'projections':
      return {
        and: [
          { property: 'Date', date: { on_or_after: localDateString(-3) } },
          { property: 'Type', select: { equals: 'Food' } }
        ]
      };
    default:
      console.error(`Unknown mode: ${mode}. Use: today, 24h, 3d, recent, projections`);
      process.exit(1);
  }
}

function queryNotion(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/databases/${DATABASE_ID}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function formatResult(page, mode) {
  const p = page.properties;
  const entry = p.Entry?.title?.[0]?.plain_text || 'Untitled';
  const date = p.Date?.date?.start || 'No Date';
  const type = p.Type?.select?.name || 'N/A';

  let line = `${date} | ${type} | ${entry}`;

  if (mode === 'projections') {
    const predBg = p['Predicted Peak BG']?.number ?? '-';
    const predTime = p['Predicted Peak Time']?.date?.start ?? '-';
    const actualPeak = p['2hr Peak BG']?.number ?? '-';
    line += ` | Pred: ${predBg} @ ${predTime} | Actual: ${actualPeak}`;
  }

  return line;
}

async function main() {
  const { mode, count } = parseArgs();
  const filter = buildFilter(mode);

  const body = {
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: mode === 'recent' ? count : 100
  };
  if (filter) body.filter = filter;

  console.log(`[check_notion] mode=${mode}\n`);

  const res = await queryNotion(body);
  if (!res.results) {
    console.error('Error:', JSON.stringify(res, null, 2));
    process.exit(1);
  }

  if (res.results.length === 0) {
    console.log('No results found.');
    return;
  }

  for (const page of res.results) {
    console.log(formatResult(page, mode));
  }

  console.log(`\n${res.results.length} entries.`);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
