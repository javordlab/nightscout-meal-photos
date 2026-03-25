#!/usr/bin/env node
/**
 * Sync missing entries from health_log.md to Notion
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NOTION_KEY = process.env.NOTION_KEY || "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";
const DATA_SOURCE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NS_SECRET_HASH = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const SYNC_STATE_PATH = path.join(WORKSPACE, 'data', 'sync_state.json');

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST', 
      headers: { 
        'Authorization': 'Bearer ' + NOTION_KEY, 
        'Notion-Version': '2022-06-28', 
        'Content-Type': 'application/json', 
        'Content-Length': Buffer.byteLength(data) 
      }
    };
    const req = https.request(url, options, (res) => { 
      let body = ''; 
      res.on('data', (c) => body += c); 
      res.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function extractBgStatus(entryText) {
  const bgMatch = entryText.match(/BG:\s*(\d+)\s*mg\/dL\s*(➡️|↗️|↘️|Flat|Rising|Falling)?/i);
  if (!bgMatch) return null;
  return {
    bg: parseInt(bgMatch[1]),
    trend: bgMatch[2] || 'Flat'
  };
}

function extractPrediction(entryText) {
  const predMatch = entryText.match(/\(Pred:\s*([^)]+)\)/);
  if (!predMatch) return null;
  const predText = predMatch[1];
  
  // Try to extract peak BG range or single value
  const rangeMatch = predText.match(/(\d+)-(\d+)\s*mg\/dL/);
  const singleMatch = predText.match(/(\d+)\s*mg\/dL/);
  const timeMatch = predText.match(/(\d+:\d+\s*(?:AM|PM)?)/i);
  
  let peakBgLow = null, peakBgHigh = null;
  if (rangeMatch) {
    peakBgLow = parseInt(rangeMatch[1]);
    peakBgHigh = parseInt(rangeMatch[2]);
  } else if (singleMatch) {
    peakBgLow = peakBgHigh = parseInt(singleMatch[1]);
  }
  
  return {
    peakBgLow,
    peakBgHigh,
    peakTime: timeMatch ? timeMatch[1] : null
  };
}

function extractPhotoUrls(entryText) {
  const urls = [];
  const regex = /\[📷\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(entryText)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function parseEntryLine(line) {
  // Handle the pipe-separated format from health_log.md
  // Remove leading/trailing pipes and split
  const parts = line.replace(/^\|\s*/, '').replace(/\s*\|$/, '').split('|').map(x => x.trim()).filter(x => x !== '');
  
  // Expected: Date, Time, User, Category, Meal Type, Entry, Carbs, Cals
  if (parts.length < 6) return null;
  
  const date = parts[0];
  const timeWithOffset = parts[1];
  const user = parts[2];
  const category = parts[3];
  const mealType = parts[4];
  const entryText = parts[5];
  const carbs = parts[6] !== 'null' ? parseFloat(parts[6]) : null;
  const cals = parts[7] !== 'null' ? parseFloat(parts[7]) : null;
  
  // Parse time with offset to create proper ISO timestamp
  const timeMatch = timeWithOffset.match(/(\d{2}:\d{2})\s*([+-]\d{2}:\d{2})?/);
  if (!timeMatch) return null;
  
  const time = timeMatch[1];
  const offset = timeMatch[2] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
  const timestamp = `${date}T${time}:00${offset}`;
  
  // Extract title (before parenthetical)
  const titleMatch = entryText.match(/^([^([]+)/);
  const title = titleMatch ? titleMatch[1].trim() : entryText.slice(0, 50);
  
  // Calculate entry_key
  const basis = [timestamp, user, category, mealType, title.toLowerCase()].join('|');
  const entryKey = sha256(basis);
  
  return {
    timestamp,
    date,
    user,
    category,
    mealType,
    title,
    entryText,
    carbs,
    cals,
    entryKey
  };
}

async function createNotionPage(entry) {
  const bgData = extractBgStatus(entry.entryText);
  const pred = extractPrediction(entry.entryText);
  const photoUrls = extractPhotoUrls(entry.entryText);
  
  const properties = {
    'Entry': {
      title: [{ text: { content: entry.title } }]
    },
    'Date': {
      date: { start: entry.timestamp }
    },
    'Category': {
      select: { name: entry.category }
    },
    'User': {
      select: { name: entry.user }
    }
  };
  
  // Add optional fields
  if (entry.mealType && entry.mealType !== '-') {
    properties['Meal Type'] = { select: { name: entry.mealType } };
  }
  
  if (entry.carbs !== null && !isNaN(entry.carbs)) {
    properties['Carbs'] = { number: entry.carbs };
  }
  
  if (entry.cals !== null && !isNaN(entry.cals)) {
    properties['Calories'] = { number: entry.cals };
  }
  
  if (bgData) {
    properties['Pre-Meal BG'] = { number: bgData.bg };
    properties['BG Trend'] = { select: { name: bgData.trend } };
  }
  
  if (pred && pred.peakBgLow !== null) {
    properties['Predicted Peak BG'] = { number: pred.peakBgLow };
  }
  
  if (pred && pred.peakTime) {
    // Parse and format peak time
    const mealTime = new Date(entry.timestamp);
    const [hours, minutes] = pred.peakTime.match(/(\d+):(\d+)/).slice(1, 3);
    const isPM = pred.peakTime.toLowerCase().includes('pm');
    let peakHours = parseInt(hours);
    if (isPM && peakHours !== 12) peakHours += 12;
    if (!isPM && peakHours === 12) peakHours = 0;
    
    const _pm = -new Date().getTimezoneOffset(); const _ps = _pm >= 0 ? '+' : '-'; const _localOff = `${_ps}${String(Math.floor(Math.abs(_pm)/60)).padStart(2,'0')}:${String(Math.abs(_pm)%60).padStart(2,'0')}`;
    const peakTimeIso = `${entry.date}T${String(peakHours).padStart(2, '0')}:${minutes}:00${_localOff}`;
    properties['Predicted Peak Time'] = { date: { start: peakTimeIso } };
  }
  
  // Build content
  const children = [];
  
  // Add entry text as paragraph
  children.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ text: { content: entry.entryText } }]
    }
  });
  
  // Add photos
  if (photoUrls.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: [{ text: { content: 'Photos' } }] }
    });
    
    for (const url of photoUrls) {
      if (url !== 'pending') {
        children.push({
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url: url }
          }
        });
      }
    }
  }
  
  const payload = {
    parent: { database_id: DATA_SOURCE_ID },
    properties: properties,
    children: children
  };
  
  const result = await postJson('https://api.notion.com/v1/pages', payload);
  return result;
}

function loadSyncState() {
  if (!fs.existsSync(SYNC_STATE_PATH)) {
    return { entries: {} };
  }
  return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
}

function saveSyncState(state) {
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  console.log('Syncing missing entries to Notion...\n');
  
  // Read health_log
  const logContent = fs.readFileSync(path.join(WORKSPACE, 'health_log.md'), 'utf8');
  const lines = logContent.split('\n').filter(l => l.includes('|') && (l.includes('2026-03-21') || l.includes('2026-03-22')));
  
  // Filter for actual data lines (not headers)
  const dataLines = lines.filter(l => {
    const parts = l.split('|').map(x => x.trim());
    return parts.length >= 6 && 
           parts[0].match(/^\d{4}-\d{2}-\d{2}$/) &&
           parts[1].match(/^\d{2}:\d{2}/);
  });
  
  console.log(`Found ${dataLines.length} entries from March 21-22`);
  
  // Load sync state and audit report
  const state = loadSyncState();
  const auditReport = JSON.parse(fs.readFileSync(
    path.join(WORKSPACE, 'data', 'health_sync_audit_report.json'), 'utf8'
  ));
  
  // Get entries marked as missing from Notion
  const missingEntryKeys = new Set();
  for (const disc of auditReport.discrepancies || []) {
    const notionMissing = disc.issues.find(i => i.type === 'notion_page_missing');
    if (notionMissing) {
      missingEntryKeys.add(disc.entryKey);
    }
  }
  
  console.log(`${missingEntryKeys.size} entries need to be added to Notion\n`);
  
  let added = 0;
  let errors = 0;
  
  for (const line of dataLines) {
    const entry = parseEntryLine(line);
    if (!entry) continue;
    
    if (!missingEntryKeys.has(entry.entryKey)) {
      continue; // Already exists
    }
    
    console.log(`Adding: ${entry.title} @ ${entry.timestamp}`);
    
    try {
      const result = await createNotionPage(entry);
      
      if (result.id) {
        console.log(`  ✓ Created Notion page: ${result.id}`);
        
        // Update sync state
        if (!state.entries[entry.entryKey]) {
          state.entries[entry.entryKey] = {};
        }
        state.entries[entry.entryKey].notion = {
          page_id: result.id,
          last_synced_at: new Date().toISOString()
        };
        
        added++;
      } else {
        console.log(`  ✗ Failed: ${JSON.stringify(result)}`);
        errors++;
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
      errors++;
    }
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 350));
  }
  
  // Save updated sync state
  saveSyncState(state);
  
  console.log(`\n✓ Sync complete: ${added} added, ${errors} errors`);
}

main().catch(console.error);
