#!/usr/bin/env node
/**
 * Clean health_log.md - remove all placeholder entries
 * Keep only entries with actual food descriptions (not "[Photo - needs description]")
 */

const fs = require('fs');
const HEALTH_LOG = '/Users/javier/.openclaw/workspace/health_log.md';

function cleanLog() {
  const content = fs.readFileSync(HEALTH_LOG, 'utf8');
  const lines = content.split('\n');
  
  const cleaned = [];
  let removed = 0;
  let kept = 0;
  
  for (const line of lines) {
    // Keep header lines and non-food entries
    if (!line.startsWith('|') || line.includes('Date') || line.includes('---')) {
      cleaned.push(line);
      continue;
    }
    
    // Check if it's a placeholder entry
    if (line.includes('[Photo - needs description]')) {
      removed++;
      continue; // Skip this line
    }
    
    // Keep legitimate entries
    cleaned.push(line);
    kept++;
  }
  
  // Write cleaned log
  fs.writeFileSync(HEALTH_LOG, cleaned.join('\n'));
  
  console.log(`Cleaned health_log.md:`);
  console.log(`  Removed: ${removed} placeholder entries`);
  console.log(`  Kept: ${kept} legitimate entries`);
}

function restoreMarch20Entries() {
  // Add back the 4 actual March 20 entries that were manually logged
  const entries = [
    {
      date: '2026-03-20',
      time: '09:04',
      tz: '-07:00',
      mealType: 'Breakfast',
      entry: 'Breakfast: Smoked salmon on ciabatta with cream cheese/butter spread + small guava (Pred: 140-160 mg/dL @ 10:40-11:10 AM) [📷](https://iili.io/qenMlwl.jpg)',
      carbs: 25,
      cals: 300
    },
    {
      date: '2026-03-20',
      time: '09:14',
      tz: '-07:00',
      mealType: 'Snack',
      entry: 'Snack: Mixed nuts (pecans, Brazil nuts, hazelnuts) + dried goji berries (Pred: 150-160 mg/dL @ 11:00 AM) [📷](https://iili.io/qenM0t2.jpg)',
      carbs: 5.5,
      cals: 205
    },
    {
      date: '2026-03-20',
      time: '13:16',
      tz: '-07:00',
      mealType: 'Lunch',
      entry: 'Lunch: Prosciutto and brie on toasted ciabatta with milk (~5oz) (Pred: 180-200 mg/dL @ 2:45-3:15 PM) [📷](https://iili.io/qenMcu4.jpg)',
      carbs: 22,
      cals: 290
    },
    {
      date: '2026-03-20',
      time: '13:17',
      tz: '-07:00',
      mealType: 'Snack',
      entry: 'Snack: Half apple (~75g) (Pred: 110-120 mg/dL @ 2:45 PM) [📷](https://iili.io/qenMa9f.jpg)',
      carbs: 13,
      cals: 50
    }
  ];
  
  const lines = entries.map(e =
    `| ${e.date} | ${e.time} ${e.tz} | Maria Dennis | Food | ${e.mealType} | ${e.entry} | ${e.carbs} | ${e.cals} |`
  );
  
  return lines.join('\n');
}

function main() {
  console.log('Step 1: Cleaning placeholder entries...\n');
  cleanLog();
  
  console.log('\nStep 2: Restoring March 20 entries...\n');
  const march20Entries = restoreMarch20Entries();
  
  // Read cleaned log
  const content = fs.readFileSync(HEALTH_LOG, 'utf8');
  const lines = content.split('\n');
  
  // Insert March 20 entries after header
  const headerEnd = 2; // After "# Health Log" and "| Date | Time | ..."
  lines.splice(headerEnd, 0, march20Entries);
  
  fs.writeFileSync(HEALTH_LOG, lines.join('\n'));
  
  console.log('Step 3: Added 4 March 20 entries\n');
  console.log('health_log.md cleaned successfully!');
}

main();
