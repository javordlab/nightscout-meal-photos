const fs = require('fs');

const LOG_PATH = '/Users/javier/.openclaw/workspace/health_log.md';

function calculateProjection(carbs) {
  if (!carbs || carbs <= 0) return null;
  let predictedBg = Math.round(120 + (carbs * 3.5));
  if (predictedBg > 300) predictedBg = 300;
  return predictedBg;
}

function main() {
  let content = fs.readFileSync(LOG_PATH, 'utf8');
  const lines = content.split('\n');
  
  let updated = 0;
  
  const newLines = lines.map(line => {
    // Only process Food entries without existing Pred:
    if (!line.includes('| Food |')) return line;
    if (line.includes('Pred:')) return line;
    
    // Parse the line
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 6) return line;
    
    const carbs = parseInt(parts[7]) || 0;
    const entryText = parts[6] || '';
    
    if (carbs <= 0) return line;
    
    // Calculate projection
    const predictedBg = calculateProjection(carbs);
    if (!predictedBg) return line;
    
    // Extract date/time from line
    const date = parts[1];
    const time = parts[2];
    if (!date || !time) return line;
    
    // Calculate peak time (+105 minutes)
    const dateStr = `${date}T${time.split(' ')[0]}`;
    const mealTime = new Date(dateStr);
    const peakTime = new Date(mealTime.getTime() + 105 * 60 * 1000);
    const peakTimeStr = peakTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Los_Angeles'
    });
    
    // Add projection to entry text
    const predText = ` (Pred: ${predictedBg} mg/dL @ ${peakTimeStr})`;
    
    // Find where to insert (before closing ) or at end)
    let newEntryText = entryText;
    if (entryText.includes('[📷]')) {
      // Insert before first [📷]
      newEntryText = entryText.replace(/(\s*\[📷\])/, `${predText}$1`);
    } else {
      // Append at end
      newEntryText = entryText + predText;
    }
    
    // Rebuild line
    parts[6] = newEntryText;
    const newLine = parts.join(' | ');
    
    console.log(`Added projection: ${parts[3]} - ${carbs}g -> ${predictedBg} mg/dL`);
    updated++;
    
    return newLine;
  });
  
  fs.writeFileSync(LOG_PATH, newLines.join('\n'));
  console.log(`\n✅ Updated ${updated} entries in health_log.md`);
}

main();
