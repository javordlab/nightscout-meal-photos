const https = require('https');

const NOTION_KEY = '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';
const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

function notionQueryDatabase() {
  return new Promise((resolve, reject) => {
    // Query without filter to get all
    const data = JSON.stringify({ page_size: 100 });
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/databases/${DB_ID}/query`,
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
      res.on('end', () => {
        try { 
          const parsed = JSON.parse(d);
          resolve(parsed);
        } catch { 
          resolve({}); 
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const result = await notionQueryDatabase();
  
  if (result.error) {
    console.log('API Error:', JSON.stringify(result.error, null, 2));
    return;
  }
  
  const entries = result.results || [];
  console.log(`Total entries in database: ${entries.length}`);
  
  // Filter for March 19-21
  const marchEntries = entries.filter(p => {
    const date = p.properties?.Date?.date?.start;
    return (date?.startsWith('2026-03-19') || date?.startsWith('2026-03-20') || date?.startsWith('2026-03-21'));
  });
  
  console.log(`March 19-21 entries: ${marchEntries.length}`);
  
  // Show all March entries
  console.log('\nAll March entries:');
  marchEntries.forEach(p => {
    const title = p.properties?.Entry?.title?.[0]?.plain_text || 'no title';
    const date = p.properties?.Date?.date?.start || 'no date';
    const archived = p.archived ? '[ARCHIVED] ' : '';
    console.log(`  ${archived}${date} | ${title.slice(0, 60)}`);
  });
  
  // Group by date + base title
  const byKey = {};
  marchEntries.filter(p => !p.archived).forEach(p => {
    const title = p.properties?.Entry?.title?.[0]?.plain_text || '';
    const date = p.properties?.Date?.date?.start || '';
    const baseTitle = title
      .replace(/\s*\(Pred:[^)]*\)\s*/g, '')
      .replace(/\s*\(BG:[^)]*\)\s*/g, '')
      .trim();
    const key = `${date}|${baseTitle}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ id: p.id, title, date });
  });
  
  const duplicates = Object.entries(byKey).filter(([k, v]) => v.length > 1);
  console.log(`\n\nDuplicate groups: ${duplicates.length}`);
  
  duplicates.forEach(([key, pages]) => {
    console.log(`\n${key}:`);
    pages.forEach((p, i) => console.log(`  [${i+1}] ${p.title.slice(0, 70)}`));
  });
}

main().catch(console.error);
