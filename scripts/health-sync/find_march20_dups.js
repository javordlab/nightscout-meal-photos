const https = require('https');
const NOTION_KEY = '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';

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

async function main() {
  // Search for specific terms from March 20
  const searches = [
    'Smoked salmon',
    'Prosciutto and brie',
    'Mixed nuts',
    'Half apple',
    'Protein ball'
  ];
  
  for (const term of searches) {
    console.log(`\n=== Searching: ${term} ===`);
    const result = await notionSearch(term);
    
    const march20 = result.results?.filter(p => {
      const date = p.properties?.Date?.date?.start;
      return date?.startsWith('2026-03-20');
    });
    
    if (march20?.length > 0) {
      console.log(`Found ${march20.length} entries for March 20:`);
      march20.forEach(p => {
        const title = p.properties?.title?.title?.[0]?.plain_text || 
                      p.properties?.Entry?.title?.[0]?.plain_text || 'unknown';
        console.log(`  ${p.id} | ${title.slice(0, 50)}`);
      });
      
      if (march20.length > 1) {
        console.log('  *** DUPLICATE DETECTED ***');
      }
    }
  }
}

main().catch(console.error);
