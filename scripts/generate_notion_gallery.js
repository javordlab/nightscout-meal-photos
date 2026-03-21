#!/usr/bin/env node
// generate_notion_gallery.js - Generate gallery JSON from normalized health log + sync_state outcomes

const fs = require('fs');
const path = require('path');

const NORMALIZED_PATH = path.join(__dirname, '..', 'data', 'health_log.normalized.json');
const SYNC_STATE_PATH = path.join(__dirname, '..', 'data', 'sync_state.json');
const GALLERY_PATH = path.join(__dirname, '..', 'nightscout-meal-photos', 'data', 'notion_meals.json');

function generateGallery() {
  console.log('Generating Notion gallery data...');
  
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
  const syncState = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
  const gallery = [];
  
  // Build lookup for actual outcomes from sync_state
  const outcomesByKey = {};
  for (const [key, entry] of Object.entries(syncState.entries)) {
    if (entry.actual_outcomes) {
      outcomesByKey[key] = entry.actual_outcomes;
    }
  }
  
  for (const entry of normalized.entries) {
    // Only include entries with photos
    if (!entry.photoUrls || entry.photoUrls.length === 0) continue;
    
    // Get actual outcomes from sync_state if available
    const actualOutcomes = outcomesByKey[entry.entryKey] || {};
    const predicted = entry.predicted || {};
    
    gallery.push({
      id: entry.entryKey.slice(0, 30),
      entry_key: entry.entryKey,
      title: entry.title,
      type: entry.mealType || entry.category,
      date: entry.timestamp,
      photo: entry.photoUrls[0],
      carbs: entry.carbsEst,
      cals: entry.caloriesEst,
      preMeal: actualOutcomes.preMealBg || actualOutcomes.pre_meal_bg,
      delta: actualOutcomes.bgDelta || actualOutcomes.bg_delta,
      peak: actualOutcomes.peakBg || actualOutcomes.peak_bg,
      predictedPeak: predicted.peakBgText || null,
      predictedTime: predicted.peakTimeText || null
    });
  }
  
  // Sort by date descending (newest first)
  gallery.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  fs.writeFileSync(GALLERY_PATH, JSON.stringify(gallery, null, 2));
  
  console.log(`Generated ${gallery.length} gallery entries`);
  console.log(`Saved to ${GALLERY_PATH}`);
}

generateGallery();
