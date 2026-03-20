#!/usr/bin/env node
/**
 * Delete duplicate "[Photo - needs description]" entries from Notion
 */

const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function queryNotion() {
  const data = JSON.stringify({
    filter: {
      property: "Entry",
      title: { contains: "[Photo - needs description]" }
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

  const data = JSON.stringify({
    archived: true
  });

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
  console.log('Finding "[Photo - needs description]" entries to delete...\n');
  
  const result = await queryNotion();
  if (!result.results) {
    console.log('Error:', result);
    return;
  }

  console.log(`Found ${result.results.length} placeholder entries\n`);

  if (result.results.length === 0) {
    console.log('No placeholder entries to delete.');
    return;
  }

  console.log('Deleting ALL placeholder entries...\n');
  
  let deleted = 0;
  let failed = 0;
  
  for (const page of result.results) {
    const title = page.properties.Entry?.title[0]?.plain_text || 'Untitled';
    const date = page.properties.Date?.date?.start || 'No date';
    process.stdout.write(`Deleting ${date} - ${title.substring(0, 40)}... `);
    try {
      await deletePage(page.id);
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
