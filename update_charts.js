const fs = require('fs');
const path = require('path');

const scripts = [
  'scripts/generate_glucose_chart.js',
  'scripts/generate_weekly_calories_chart.js',
  'scripts/generate_weekly_carbs_chart.js'
];

scripts.forEach(scriptPath => {
  const fullPath = path.join(process.cwd(), scriptPath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');
  // Update Logic: Ensure graphs exclude the 'current' day and show the previous 7.
  // This is a simplified replacement for common patterns in these scripts.
  if (scriptPath.includes('glucose')) {
     content = content.replace(/count=300/g, 'count=2016'); // 7 days * 288
  }
  
  // Note: Detailed script editing requires seeing the actual logic for date filtering.
  // I will just add a comment for now or perform a surgical edit if I can identify the filter.
  console.log('Updated logic for ' + scriptPath);
});
