const https = require('https');
const fs = require('fs');
const path = require('path');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const WORKSPACE = '/Users/javier/.openclaw/workspace';

function nsRequest(method, endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${NS_URL}${endpoint}`;
    const options = {
      method,
      headers: { 'api-secret': NS_SECRET }
    };
    https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    }).on('error', reject).end();
  });
}

async function main() {
  // Get all treatments from March 20-21
  const treatments = await new Promise((resolve, reject) => {
    https.get(`${NS_URL}/api/v1/treatments.json?find[created_at][$gte]=2026-03-20&count=200`, 
      { headers: { 'api-secret': NS_SECRET } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d || '[]')); } catch { resolve([]); }
        });
      }
    ).on('error', reject);
  });
  
  // Read health_log to get valid entries
  const logContent = fs.readFileSync(path.join(WORKSPACE, 'health_log.md'), 'utf8');
  const logLines = logContent.split('\n').filter(l => l.includes('| 2026-03-2'));
  
  console.log('Valid log entries:');
  logLines.forEach(l => {
    const parts = l.split('|');
    if (parts.length > 6) {
      const date = parts[1]?.trim();
      const time = parts[2]?.trim();
      const entry = parts[6]?.trim();
      console.log(`  ${date} ${time} | ${entry?.slice(0, 50)}`);
    }
  });
  
  console.log('\nNightscout treatments:');
  treatments.filter(t => t.created_at?.startsWith('2026-03-2')).forEach(t => {
    const utc = new Date(t.created_at).toISOString();
    const pdt = new Date(t.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    console.log(`  UTC: ${utc} | PDT: ${pdt} | ${t.notes?.slice(0, 50)}`);
  });
  
  // Find suspect treatments (no matching log entry)
  console.log('\nSuspect treatments (check if these match log entries):');
  const suspect = treatments.filter(t => {
    if (!t.created_at?.startsWith('2026-03-2')) return false;
    const tDate = new Date(t.created_at);
    const tPDT = new Date(tDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const dateStr = tPDT.toISOString().slice(0, 10);
    const timeStr = tPDT.toTimeString().slice(0, 5);
    
    // Check if this matches any log entry
    const match = logLines.find(l => {
      const parts = l.split('|');
      if (parts.length < 3) return false;
      const logDate = parts[1]?.trim();
      const logTime = parts[2]?.trim()?.split(' ')[0]; // Remove timezone
      return logDate === dateStr && logTime?.startsWith(timeStr);
    });
    
    return !match;
  });
  
  suspect.forEach(t => {
    console.log(`  ${t._id} | ${t.created_at} | ${t.notes?.slice(0, 50)}`);
  });
}

main().catch(console.error);
