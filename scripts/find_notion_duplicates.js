#!/usr/bin/env node
/**
 * Find and report Notion duplicates
 */

const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function queryNotion() {
  const data = JSON.stringify({
    filter: {
      property: "Date",
      date: { on_or_after: "2026-03-19" }
    },
    sorts: [{ property: "Date", direction: "descending" }]
  });

  const options = {
    hostname: 'api.notion.com',
    path: `/v1/databases/${DATABASE_ID}/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const result = await queryNotion();
  if (!result.results) {
    console.log('Error:', result);
    return;
  }

  const entries = result.results.map(page => ({
    id: page.id,
    title: page.properties.Entry?.title[0]?.plain_text || 'Untitled',
    date: page.properties.Date?.date?.start || 'No date',
    created: page.created_time
  }));

  // Find duplicates by title + date combination
  const seen = new Map();
  const duplicates = [];

  entries.forEach(entry => {
    const key = `${entry.title}|${entry.date}`;
    if (seen.has(key)) {
      duplicates.push({
        first: seen.get(key),
        duplicate: entry
      });
    } else {
      seen.set(key, entry);
    }
  });

  console.log(`Total entries since 2026-03-19: ${entries.length}`);
  console.log(`Duplicates found: ${duplicates.length}`);

  if (duplicates.length > 0) {
    console.log('\nDuplicate entries:');
    duplicates.forEach(d => {
      console.log(`\n  Original: ${d.first.title}`);
      console.log(`    ID: ${d.first.id}`);
      console.log(`    Date: ${d.first.date}`);
      console.log(`    Created: ${d.first.created}`);
      console.log(`  Duplicate: ${d.duplicate.title}`);
      console.log(`    ID: ${d.duplicate.id}`);
      console.log(`    Date: ${d.duplicate.date}`);
      console.log(`    Created: ${d.duplicate.created}`);
    });
  }
}

main().catch(console.error);
