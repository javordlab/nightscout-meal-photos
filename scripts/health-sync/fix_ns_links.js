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

function nsRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = `${NS_URL}${endpoint}`;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      method,
      headers: {
        'api-secret': NS_SECRET,
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    
    const req = https.request(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d || '{}')); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function loadSyncState() {
  const p = path.join(WORKSPACE, 'data/sync_state.json');
  if (!fs.existsSync(p)) return { version: 1, entries: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveSyncState(state) {
  fs.writeFileSync(path.join(WORKSPACE, 'data/sync_state.json'), JSON.stringify(state, null, 2));
}

async function main() {
  // Load log entries
  const logContent = fs.readFileSync(path.join(WORKSPACE, 'health_log.md'), 'utf8');
  const logLines = logContent.split('\n').filter(l => l.match(/^\| 2026-03-2/));
  
  // Parse log entries
  const logEntries = logLines.map(line => {
    const parts = line.split('|').map(x => x.trim());
    if (parts.length < 7) return null;
    const date = parts[1];
    const time = parts[2];
    const user = parts[3];
    const category = parts[4];
    const mealType = parts[5];
    const entryText = parts[6];
    
    // Build timestamp
    const _tp2 = time.split(' '); const _off2 = _tp2[1] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
    const timestamp = `${date}T${_tp2[0]}:00${_off2}`;
    
    // Extract title
    const titleMatch = entryText.match(/^[^:]+:\s*(.+)/);
    const title = titleMatch ? titleMatch[1].replace(/\[📷\].*$/, '').trim() : entryText;
    
    // Build entry_key
    const basis = [timestamp, user, category, mealType, title.toLowerCase()].join('|');
    const entryKey = sha256(basis);
    
    return { timestamp, user, category, mealType, title, entryKey, entryText };
  }).filter(Boolean);
  
  console.log(`Parsed ${logEntries.length} log entries`);
  
  // Get Nightscout treatments
  const treatments = await nsRequest('GET', '/api/v1/treatments.json?find[created_at][$gte]=2026-03-20&count=50');
  
  console.log(`Found ${treatments.length} treatments`);
  
  const state = loadSyncState();
  let updated = 0;
  let matched = 0;
  
  for (const t of treatments) {
    const tTime = new Date(t.created_at);
    const tLocal = new Date(tTime.toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    
    // Find matching log entry
    const match = logEntries.find(e => {
      const eTime = new Date(e.timestamp);
      const diff = Math.abs(eTime.getTime() - tLocal.getTime());
      return diff < 60 * 1000; // Within 1 minute
    });
    
    if (match) {
      matched++;
      
      // Update treatment notes with entry_key if missing
      if (!t.notes?.includes('[entry_key:')) {
        const updatedNotes = `${t.notes} [entry_key:${match.entryKey}]`;
        await nsRequest('PUT', '/api/v1/treatments.json', {
          ...t,
          notes: updatedNotes
        });
        console.log(`Updated ${t._id} with entry_key`);
        updated++;
      }
      
      // Update sync_state
      if (!state.entries[match.entryKey]) {
        state.entries[match.entryKey] = {};
      }
      state.entries[match.entryKey].nightscout = {
        treatment_id: t._id,
        last_synced_at: new Date().toISOString()
      };
      state.entries[match.entryKey].timestamp = match.timestamp;
      state.entries[match.entryKey].user = match.user;
      state.entries[match.entryKey].category = match.category;
      state.entries[match.entryKey].meal_type = match.mealType;
      state.entries[match.entryKey].title = match.title;
    }
  }
  
  saveSyncState(state);
  console.log(`\nMatched ${matched} treatments, updated ${updated} with entry_key`);
}

main().catch(console.error);
