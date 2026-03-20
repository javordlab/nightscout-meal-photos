#!/usr/bin/env node
/**
 * Photo-to-Log Pipeline
 * Watches /Users/javier/.openclaw/media/inbound/ for new photos
 * Processes them with OCR/nutrition extraction
 * Adds entries to health_log.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const INBOUND_DIR = '/Users/javier/.openclaw/media/inbound/';
const STATE_FILE = '/Users/javier/.openclaw/workspace/.photo_pipeline_state.json';
const HEALTH_LOG = '/Users/javier/.openclaw/workspace/health_log.md';
const MAX_RETRIES = 3;

// Load processed files state
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { processed: [], failed: [], lastRun: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Get current BG from Nightscout
async function getCurrentBG() {
  try {
    const result = execSync(
      'curl -s "https://p01--sefi--s66fclg7g2lm.code.run/api/v1/entries.json?count=1" -H "API-SECRET: JaviCare2026"',
      { encoding: 'utf8', timeout: 10000 }
    );
    const data = JSON.parse(result);
    if (data && data[0]) {
      return { sgv: data[0].sgv, direction: data[0].direction };
    }
  } catch (e) {
    console.log('BG fetch failed:', e.message);
  }
  return null;
}

// Upload photo to get URL
async function uploadPhoto(photoPath) {
  const API_KEY = '6d207e02198a847aa98d0a2a901485a5';
  try {
    const result = execSync(
      `curl -s -X POST "https://freeimage.host/api/1/upload" -F "key=${API_KEY}" -F "source=@${photoPath}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const data = JSON.parse(result);
    return data.image?.url || null;
  } catch (e) {
    console.error('Upload failed:', e.message);
    return null;
  }
}

// Analyze photo with vision model
async function analyzePhoto(photoPath) {
  // For now, use simple heuristics based on filename/time
  // In production, this would call an OCR/nutrition API
  const stats = fs.statSync(photoPath);
  const timestamp = stats.mtime;
  const hour = timestamp.getHours();
  
  // Determine meal type based on time
  let mealType = 'Snack';
  if (hour >= 6 && hour < 11) mealType = 'Breakfast';
  else if (hour >= 11 && hour < 15) mealType = 'Lunch';
  else if (hour >= 17 && hour < 21) mealType = 'Dinner';
  else if (hour >= 14 && hour < 17) mealType = 'Snack';
  else if (hour >= 20) mealType = 'Dessert';
  
  return {
    timestamp: timestamp,
    mealType: mealType,
    needsManualEntry: true // Flag for manual carb/cal estimation
  };
}

// Add entry to health_log.md
function addToLog(entry) {
  const date = entry.timestamp.toISOString().split('T')[0];
  const time = entry.timestamp.toISOString().split('T')[1].slice(0, 5);
  const tzOffset = entry.timestamp.getTimezoneOffset() === 480 ? '-08:00' : '-07:00'; // PDT/PST
  
  const logLine = `| ${date} | ${time} ${tzOffset} | Maria Dennis | Food | ${entry.mealType} | ${entry.mealType}: ${entry.description} (BG: ${entry.bg || 'Unknown'}) (Pred: TBD) [📷](${entry.photoUrl}) | ${entry.carbs || 'null'} | ${entry.cals || 'null'} |`;
  
  // Read current log
  let logContent = fs.readFileSync(HEALTH_LOG, 'utf8');
  
  // Insert after header (first 2 lines)
  const lines = logContent.split('\n');
  lines.splice(2, 0, logLine);
  
  fs.writeFileSync(HEALTH_LOG, lines.join('\n'));
  console.log(`Added: ${entry.mealType} at ${time}`);
}

// Main processing loop
async function main() {
  console.log('Photo Pipeline Starting...', new Date().toISOString());
  
  const state = loadState();
  const files = fs.readdirSync(INBOUND_DIR)
    .filter(f => f.match(/\.(jpg|jpeg|png)$/i))
    .filter(f => !state.processed.includes(f))
    .filter(f => !state.failed.includes(f))
    .map(f => ({
      name: f,
      path: path.join(INBOUND_DIR, f),
      mtime: fs.statSync(path.join(INBOUND_DIR, f)).mtime
    }))
    .sort((a, b) => a.mtime - b.mtime); // Process oldest first
  
  if (files.length === 0) {
    console.log('No new photos to process');
    return;
  }
  
  console.log(`Found ${files.length} unprocessed photos`);
  
  // Get current BG once for all entries
  const bg = await getCurrentBG();
  
  for (const file of files) {
    console.log(`\nProcessing: ${file.name}`);
    
    try {
      // Analyze photo
      const analysis = await analyzePhoto(file.path);
      
      // Upload to get URL
      const photoUrl = await uploadPhoto(file.path);
      if (!photoUrl) {
        throw new Error('Photo upload failed');
      }
      
      // Create entry
      const entry = {
        timestamp: analysis.timestamp,
        mealType: analysis.mealType,
        description: '[Photo - needs description]', // Placeholder
        photoUrl: photoUrl,
        bg: bg ? `${bg.sgv} mg/dL ${bg.direction}` : 'Unknown',
        carbs: null, // Will need manual backfill
        cals: null
      };
      
      // Add to log
      addToLog(entry);
      
      // Mark as processed
      state.processed.push(file.name);
      
    } catch (e) {
      console.error(`Failed to process ${file.name}:`, e.message);
      
      // Track failures
      const failEntry = state.failed.find(f => f.file === file.name);
      if (failEntry) {
        failEntry.retries++;
        if (failEntry.retries >= MAX_RETRIES) {
          console.log(`Giving up on ${file.name} after ${MAX_RETRIES} retries`);
        }
      } else {
        state.failed.push({ file: file.name, retries: 1, error: e.message });
      }
    }
  }
  
  state.lastRun = new Date().toISOString();
  saveState(state);
  
  console.log('\nPipeline Complete');
  console.log(`Processed: ${state.processed.length} total`);
  console.log(`Failed: ${state.failed.length} total`);
  
  // Run sync after adding entries
  console.log('\nTriggering radial sync...');
  try {
    execSync('cd /Users/javier/.openclaw/workspace && node scripts/radial_dispatcher.js', {
      stdio: 'inherit',
      timeout: 120000
    });
  } catch (e) {
    console.error('Sync failed:', e.message);
  }
}

main().catch(console.error);
