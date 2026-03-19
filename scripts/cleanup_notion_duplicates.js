const fs = require('fs');
const https = require('https');

const NOTION_KEY = "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";
const DUPLICATES_PATH = '/Users/javier/.openclaw/workspace/tmp/notion_duplicates.json';

async function notionRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        ...(data && { 'Content-Type': 'application/json' })
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, data: JSON.parse(data || '{}') });
        } else {
          resolve({ success: false, status: res.statusCode, data: JSON.parse(data || '{}') });
        }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(DUPLICATES_PATH)) {
    console.log('No duplicates file found. Run generate_notion_gallery_data.js first.');
    return;
  }
  
  const duplicates = JSON.parse(fs.readFileSync(DUPLICATES_PATH, 'utf8'));
  console.log(`Found ${duplicates.length} duplicates to delete\n`);
  
  let deleted = 0;
  let failed = 0;
  
  for (const dup of duplicates) {
    process.stdout.write(`Archiving: ${dup.title.substring(0, 50)}... `);
    // Notion API requires PATCH to archive, not DELETE
    const result = await notionRequest('PATCH', `/pages/${dup.id}`, { archived: true });
    
    if (result.success) {
      console.log('✓');
      deleted++;
    } else {
      console.log(`✗ (status ${result.status}: ${result.data?.message || 'Unknown error'})`);
      failed++;
    }
    
    // Rate limit: 3 requests per second
    await new Promise(r => setTimeout(r, 350));
  }
  
  console.log(`\nDone: ${deleted} deleted, ${failed} failed`);
  
  // Clean up duplicates file
  fs.unlinkSync(DUPLICATES_PATH);
  console.log('Cleaned up duplicates file');
}

main().catch(console.error);
