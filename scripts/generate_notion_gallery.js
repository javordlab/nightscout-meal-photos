#!/usr/bin/env node
// generate_notion_gallery.js - Generate gallery JSON from sync_state

const fs = require('fs');
const path = require('path');

const SYNC_STATE_PATH = path.join(__dirname, '..', 'data', 'sync_state.json');
const GALLERY_PATH = path.join(__dirname, '..', 'nightscout-meal-photos', 'data', 'notion_meals.json');

function generateGallery() {
  console.log('Generating Notion gallery data...');
  
  const state = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
  const gallery = [];
  
  for (const [key, entry] of Object.entries(state.entries)) {
    // Only include entries with photos (sync_state uses snake_case)
    const photoUrls = entry.photo_urls || entry.photoUrls || [];
    if (photoUrls.length === 0) continue;
    
    // Parse predictions from title if present
    let predictedPeak = null;
    let predictedTime = null;
    
    const title = entry.title || '';
    const predMatch = title.match(/Pred:\s*(\d+)-?(\d+)?\s*mg\/dL/);
    if (predMatch) {
      if (predMatch[2]) {
        // Range like "145-155 mg/dL"
        predictedPeak = Math.round((parseInt(predMatch[1]) + parseInt(predMatch[2])) / 2);
      } else {
        // Single value like "150 mg/dL"
        predictedPeak = parseInt(predMatch[1]);
      }
    }
    
    const timeMatch = title.match(/@\s*(\d+):(\d+)\s*(AM|PM)/);
    if (timeMatch) {
      // Use the timestamp from entry and replace time
      const date = new Date(entry.timestamp);
      let hours = parseInt(timeMatch[1]);
      const mins = timeMatch[2];
      const ampm = timeMatch[3];
      
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      
      date.setHours(hours, parseInt(mins), 0, 0);
      predictedTime = date.toISOString();
    }
    
    gallery.push({
      id: `notion-${key.slice(0, 20)}`,
      entry_key: key,
      title: title.replace(/\s*\(Pred:.*?\)/, '').trim(), // Remove prediction from title
      type: entry.mealType || entry.category,
      date: entry.timestamp,
      photo: photoUrls[0],
      carbs: entry.carbsEst,
      cals: entry.caloriesEst,
      preMeal: entry.preMeal,
      delta: entry.delta,
      peak: entry.peak,
      predictedPeak: predictedPeak,
      predictedTime: predictedTime
    });
  }
  
  // Sort by date descending (newest first)
  gallery.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  fs.writeFileSync(GALLERY_PATH, JSON.stringify(gallery, null, 2));
  
  console.log(`Generated ${gallery.length} gallery entries`);
  console.log(`Saved to ${GALLERY_PATH}`);
}

generateGallery();
