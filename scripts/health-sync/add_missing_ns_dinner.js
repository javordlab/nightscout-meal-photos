const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const WORKSPACE = '/Users/javier/.openclaw/workspace';

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function nsPost(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      headers: {
        'api-secret': NS_SECRET,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(`${NS_URL}/api/v1/treatments.json`, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Read health_log
  const logContent = fs.readFileSync(path.join(WORKSPACE, 'health_log.md'), 'utf8');
  const lines = logContent.split('\n');
  
  // Find March 21 01:45 dinner entry
  const dinnerLine = lines.find(l => 
    l.includes('2026-03-21') && l.includes('01:45') && l.includes('Dinner')
  );
  
  if (!dinnerLine) {
    console.log('Dinner entry not found in health_log');
    return;
  }
  
  console.log('Found dinner entry:', dinnerLine.slice(0, 100));
  
  // Parse entry
  const parts = dinnerLine.split('|').map(x => x.trim());
  const date = parts[1];
  const time = parts[2];
  const user = parts[3];
  const category = parts[4];
  const mealType = parts[5];
  const entryText = parts[6];
  const carbs = parts[7];
  const cals = parts[8];
  
  // Build timestamp in UTC
  const timestamp = `${date}T${time.split(' ')[0]}:00-07:00`;
  const entryDate = new Date(timestamp);
  const utcTime = entryDate.toISOString();
  
  // Extract photo URL
  const photoMatch = entryText.match(/\[📷\]\(([^)]+)\)/);
  const photoUrl = photoMatch ? photoMatch[1] : null;
  
  // Build notes
  let notes = entryText.replace(/\[📷\]\([^)]+\)/g, '').trim();
  
  // Calculate entry_key
  const titleMatch = entryText.match(/^[^:]+:\s*(.+?)(?:\s*\[📷\]|$)/);
  const title = titleMatch ? titleMatch[1].trim() : entryText;
  const basis = [timestamp, user, category, mealType, title.toLowerCase()].join('|');
  const entryKey = sha256(basis);
  
  notes += ` [entry_key:${entryKey}]`;
  if (photoUrl) {
    notes += ` 📷 ${photoUrl}`;
  }
  
  console.log('\nCreating Nightscout entry:');
  console.log('  UTC time:', utcTime);
  console.log('  Event type:', category === 'Food' ? 'Meal Bolus' : 'Note');
  console.log('  Notes:', notes.slice(0, 80) + '...');
  
  // Create treatment
  const treatment = {
    eventType: category === 'Food' ? 'Meal Bolus' : 'Note',
    created_at: utcTime,
    carbs: carbs !== 'null' ? parseFloat(carbs) : undefined,
    protein: cals !== 'null' ? parseFloat(cals) : undefined,
    notes: notes
  };
  
  const result = await nsPost(treatment);
  console.log('\nResult:', JSON.stringify(result, null, 2));
  
  // Update sync_state
  const syncStatePath = path.join(WORKSPACE, 'data/sync_state.json');
  const state = JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
  
  if (!state.entries[entryKey]) {
    state.entries[entryKey] = {};
  }
  
  state.entries[entryKey].nightscout = {
    treatment_id: result._id || result[0]?._id,
    last_synced_at: new Date().toISOString()
  };
  state.entries[entryKey].timestamp = timestamp;
  state.entries[entryKey].title = title;
  
  fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2));
  console.log('\nUpdated sync_state with treatment_id');
}

main().catch(console.error);
