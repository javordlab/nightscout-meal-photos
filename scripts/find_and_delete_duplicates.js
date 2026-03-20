#!/usr/bin/env node
/**
 * Find and delete duplicate entries in Notion database
 * Identifies duplicates by exact title + date match
 */

const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function queryNotion() {
  const allResults = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const body = {
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: 100
    };
    if (startCursor) body.start_cursor = startCursor;
    
    const data = JSON.stringify(body);
    
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

    const result = await new Promise((resolve, reject) => {
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
    
    if (result.results) {
      allResults.push(...result.results);
    }
    
    hasMore = result.has_more;
    startCursor = result.next_cursor;
  }
  
  return allResults;
}

async function deletePage(pageId) {
  const options = {
    hostname: 'api.notion.com',
    path: `/v1/pages/${pageId}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };

  const data = JSON.stringify({ archived: true });

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
  console.log('Querying all Notion entries...\n');
  
  const entries = await queryNotion();
  console.log(`Total entries: ${entries.length}\n`);

  // Find duplicates by title + exact date
  const seen = new Map();
  const duplicates = [];
  const unique = [];

  entries.forEach(page => {
    const title = page.properties.Entry?.title[0]?.plain_text || 'Untitled';
    const date = page.properties.Date?.date?.start;
    const key = `${title}|${date}`;
    
    if (seen.has(key)) {
      duplicates.push({
        first: seen.get(key),
        duplicate: { id: page.id, title, date, created: page.created_time }
      });
    } else {
      seen.set(key, { id: page.id, title, date, created: page.created_time });
      unique.push({ id: page.id, title, date });
    }
  });

  console.log(`Unique entries: ${unique.length}`);
  console.log(`Duplicate entries: ${duplicates.length}\n`);

  if (duplicates.length === 0) {
    console.log('No exact duplicates found by title+date.');
    
    // Check for entries from March 19 around 8:56 PM
    console.log('\n--- Entries from March 19 8:50-9:00 PM ---');
    const mar19Entries = entries.filter(e => {
      const date = e.properties.Date?.date?.start;
      return date && date.startsWith('2026-03-19T20:5');
    });
    
    mar19Entries.forEach(e => {
      const title = e.properties.Entry?.title[0]?.plain_text || 'Untitled';
      const date = e.properties.Date?.date?.start;
      console.log(`${date} | ${title.substring(0, 60)}`);
    });
    
    return;
  }

  console.log('Duplicate entries found:\n');
  duplicates.forEach(d => {
    console.log(`  Original: ${d.first.date} - ${d.first.title.substring(0, 50)}`);
    console.log(`  Duplicate: ${d.duplicate.date} - ${d.duplicate.title.substring(0, 50)}`);
    console.log(`  Created: ${d.duplicate.created}`);
    console.log();
  });

  console.log(`\nDeleting ${duplicates.length} duplicates...\n`);
  
  let deleted = 0;
  let failed = 0;
  
  for (const dup of duplicates) {
    process.stdout.write(`Deleting ${dup.duplicate.id}... `);
    try {
      await deletePage(dup.duplicate.id);
      console.log('OK');
      deleted++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}`);
}

main().catch(console.error);
