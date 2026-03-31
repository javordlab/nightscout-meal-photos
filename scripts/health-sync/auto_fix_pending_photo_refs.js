#!/usr/bin/env node
/**
 * Auto-Fix Pending Photo References
 * 
 * Runs every 30 minutes. Finds entries in health_log.md with temporary
 * file_XXX references, uploads them, and replaces refs with real iili.io URLs.
 * 
 * This is a safety net for photos that slip through the main pipeline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HEALTH_LOG = '/Users/javier/.openclaw/workspace/health_log.md';
const INBOUND_DIR = '/Users/javier/.openclaw/media/inbound/';
const GALLERY_PATH = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';
const LOG_FILE = '/Users/javier/.openclaw/workspace/data/auto_fix_photos.log.jsonl';
const API_KEY = '6d207e02198a847aa98d0a2a901485a5';

async function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    const cmd = `curl -s -X POST "https://freeimage.host/api/1/upload" -F "key=${API_KEY}" -F "source=@${filePath}"`;
    try {
      const output = execSync(cmd, { timeout: 30000 }).toString();
      const res = JSON.parse(output);
      if (res.image && res.image.url) {
        resolve(res.image.url);
      } else {
        reject(new Error('No image URL in response: ' + JSON.stringify(res)));
      }
    } catch (e) {
      reject(e);
    }
  });
}

function findFileByPrefix(prefix) {
  if (!fs.existsSync(INBOUND_DIR)) return null;
  const files = fs.readdirSync(INBOUND_DIR).filter(f => f.match(/\.(jpg|jpeg|png)$/i));
  for (const f of files) {
    if (f.startsWith(prefix + '---')) {
      return path.join(INBOUND_DIR, f);
    }
  }
  return null;
}

function findAndFixTempRefs() {
  if (!fs.existsSync(HEALTH_LOG)) return [];

  const log = fs.readFileSync(HEALTH_LOG, 'utf8');
  const lines = log.split('\n');
  
  // Find lines with temporary file refs like [📷](file_XXX---uuid.jpg)
  const tempRefRegex = /\[📷\]\(file_(\d+)---([a-f0-9\-]+)\.jpg\)/g;
  const fixes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    while ((match = tempRefRegex.exec(line)) !== null) {
      const fileNum = match[1];
      const uuid = match[2];
      const filePrefix = `file_${fileNum}`;
      const tempRef = `file_${fileNum}---${uuid}.jpg`;
      
      fixes.push({ lineIndex: i, line, filePrefix, tempRef, uuid });
    }
  }

  if (fixes.length === 0) {
    console.log('No temporary photo refs found.');
    return [];
  }

  console.log(`Found ${fixes.length} temporary photo ref(s). Processing...`);

  const results = [];
  for (const fix of fixes) {
    try {
      const filePath = findFileByPrefix(fix.filePrefix);
      if (!filePath) {
        console.error(`  ⚠️  File not found for ${fix.tempRef}`);
        results.push({
          ts: new Date().toISOString(),
          tempRef: fix.tempRef,
          status: 'not_found'
        });
        continue;
      }

      const url = uploadFile(filePath).then(url => {
        // Replace in log
        const newRef = `[📷](${url})`;
        const oldRef = `[📷](${fix.tempRef})`;
        const updated = lines[fix.lineIndex].replace(oldRef, newRef);
        lines[fix.lineIndex] = updated;

        // Update gallery if it exists
        if (fs.existsSync(GALLERY_PATH)) {
          const gallery = JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8'));
          const dateMatch = fix.line.match(/2026-\d{2}-\d{2}T\d{2}:\d{2}/);
          if (dateMatch) {
            const entry = gallery.find(e => e.date.includes(dateMatch[0]));
            if (entry) {
              entry.photo = url;
              fs.writeFileSync(GALLERY_PATH, JSON.stringify(gallery, null, 2));
            }
          }
        }

        console.log(`  ✅ ${fix.tempRef} → ${url}`);
        return { tempRef: fix.tempRef, url, status: 'uploaded' };
      }).catch(e => {
        console.error(`  ❌ ${fix.tempRef}: ${e.message}`);
        return { tempRef: fix.tempRef, error: e.message, status: 'upload_failed' };
      });

      results.push(url);
    } catch (e) {
      console.error(`  ❌ Error processing ${fix.tempRef}:`, e.message);
      results.push({
        ts: new Date().toISOString(),
        tempRef: fix.tempRef,
        status: 'error',
        error: e.message
      });
    }
  }

  // Write back updated log only if all uploads succeeded
  Promise.all(results).then(allResults => {
    const allSuccess = allResults.every(r => r && r.status === 'uploaded');
    if (allSuccess && fixes.length > 0) {
      fs.writeFileSync(HEALTH_LOG, lines.join('\n'));
      console.log(`  → Updated health_log.md`);
    }

    // Log results
    const logEntry = {
      ts: new Date().toISOString(),
      found: fixes.length,
      results: allResults
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
  }).catch(e => {
    console.error('Error in async processing:', e.message);
  });
}

// Main
console.log(`[${new Date().toISOString()}] Auto-Fix Pending Photo References`);
findAndFixTempRefs();
