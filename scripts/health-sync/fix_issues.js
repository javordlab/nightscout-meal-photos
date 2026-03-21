const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NOTION_KEY = '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';
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const WORKSPACE = '/Users/javier/.openclaw/workspace';

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function notionSearch(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, filter: { value: 'page', property: 'object' } });
    const options = {
      hostname: 'api.notion.com',
      path: '/v1/search',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function notionDelete(pageId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ archived: true });
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/pages/${pageId}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // 1. Find and delete duplicate pages
  console.log('=== Finding Notion duplicates ===');
  const result = await notionSearch('2026-03');
  
  // Group by normalized title+date
  const byKey = {};
  result.results?.forEach(p => {
    const title = p.properties?.title?.title?.[0]?.plain_text || 
                  p.properties?.Entry?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const key = `${date}|${title.toLowerCase().trim()}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(p);
  });
  
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`Found ${duplicates.length} duplicate groups`);
  
  for (const [key, pages] of duplicates) {
    console.log(`\nDuplicate: ${key}`);
    // Keep first, archive rest
    for (let i = 1; i < pages.length; i++) {
      console.log(`  Archiving: ${pages[i].id}`);
      await notionDelete(pages[i].id);
    }
    console.log(`  Kept: ${pages[0].id}`);
  }
  
  // 2. Find missing dinner in Nightscout
  console.log('\n=== Checking Nightscout ===');
  const treatments = await new Promise((resolve, reject) => {
    https.get(`${NS_URL}/api/v1/treatments.json?find[created_at][$gte]=2026-03-20&count=100`,
      { headers: { 'api-secret': NS_SECRET } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      }
    ).on('error', reject);
  });
  
  // Read health_log
  const logContent = fs.readFileSync(path.join(WORKSPACE, 'health_log.md'), 'utf8');
  const logLines = logContent.split('\n').filter(l => l.includes('| 2026-03-2'));
  
  // Find dinner entries in log
  const dinnerEntries = logLines.filter(l => l.includes('| Dinner |')).map(l => {
    const parts = l.split('|').map(x => x.trim());
    return { date: parts[1], time: parts[2], entry: parts[6] };
  });
  
  console.log('Dinner entries in log:', dinnerEntries.length);
  dinnerEntries.forEach(d => console.log(`  ${d.date} ${d.time} | ${d.entry?.slice(0, 50)}`));
  
  // Check which dinners are missing from Nightscout
  const missing = dinnerEntries.filter(d => {
    const date = d.date;
    const time = d.time.split(' ')[0];
    const [h, m] = time.split(':');
    const pdtTime = new Date(`${date}T${time}:00-07:00`);
    const utcTime = new Date(pdtTime.getTime() + 7 * 60 * 60 * 1000);
    
    // Check if any treatment matches
    return !treatments.some(t => {
      const tTime = new Date(t.created_at);
      const diff = Math.abs(tTime.getTime() - utcTime.getTime());
      return diff < 2 * 60 * 1000; // Within 2 minutes
    });
  });
  
  console.log('\nMissing from Nightscout:', missing.length);
  missing.forEach(m => console.log(`  ${m.date} ${m.time}`));
  
  console.log('\n=== Done ===');
}

main().catch(console.error);
