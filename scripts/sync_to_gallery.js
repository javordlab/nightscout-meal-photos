#!/usr/bin/env node
/**
 * Sync today's health_log entries to notion_meals.json for gallery
 */

const fs = require('fs');
const path = require('path');

const HEALTH_LOG = '/Users/javier/.openclaw/workspace/health_log.md';
const NOTION_MEALS = '/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json';

function parseHealthLog() {
  const content = fs.readFileSync(HEALTH_LOG, 'utf8');
  const lines = content.split('\n');
  const entries = [];
  
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('Date')) continue;
    
    const parts = line.split('|').map(p => p.trim()).filter(p => p);
    if (parts.length < 7) continue;
    
    const [date, time, user, category, mealType, entry, carbs, cals] = parts;
    
    // Skip non-food entries and non-March-20 entries
    if (category !== 'Food' || !date.startsWith('2026-03-20')) continue;
    
    // Skip placeholder entries
    if (entry.includes('[Photo - needs description]')) continue;
    
    // Extract photo URL from entry
    const photoMatch = entry.match(/\[📷\]\(([^)]+)\)/);
    const photoUrl = photoMatch ? photoMatch[1] : null;
    
    // Parse title (remove photo link and predictions)
    const title = entry.replace(/\[📷\]\([^)]+\)/g, '').replace(/\(Pred:[^)]+\)/g, '').replace(/\(BG:[^)]+\)/g, '').trim();
    
    // Parse carbs/cals
    const carbsNum = carbs === 'null' || !carbs ? null : parseFloat(carbs);
    const calsNum = cals === 'null' || !cals ? null : parseFloat(cals);
    
    entries.push({
      id: `manual-${date}-${time}`,
      title: title,
      type: mealType,
      date: (() => { const _tg = time.split(' '); const _og = _tg[1] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })(); return `${date}T${_tg[0]}:00.000${_og}`; })(),
      photo: photoUrl,
      carbs: carbsNum,
      cals: calsNum,
      delta: null,
      peak: null
    });
  }
  
  return entries;
}

function main() {
  console.log('Syncing March 20 entries to gallery...\n');
  
  // Load existing meals
  const meals = JSON.parse(fs.readFileSync(NOTION_MEALS, 'utf8'));
  
  // Filter out any existing March 20 entries (to avoid duplicates)
  const existing = meals.filter(m => !m.date.startsWith('2026-03-20'));
  
  // Parse health_log for March 20 entries
  const newEntries = parseHealthLog();
  
  console.log(`Found ${newEntries.length} new entries in health_log.md`);
  
  // Combine and sort by date
  const combined = [...newEntries, ...existing].sort((a, b) => 
    new Date(b.date) - new Date(a.date)
  );
  
  // Save
  fs.writeFileSync(NOTION_MEALS, JSON.stringify(combined, null, 2));
  
  console.log(`\nTotal entries in gallery: ${combined.length}`);
  console.log('\nNew entries added:');
  newEntries.forEach(e => {
    console.log(`  - ${e.type}: ${e.title.substring(0, 50)}`);
    console.log(`    Photo: ${e.photo ? '✅ ' + e.photo.substring(0, 40) : '❌ None'}`);
  });
}

main();
