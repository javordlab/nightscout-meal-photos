const { describe, it } = require('node:test');
const assert = require('node:assert');

const { isPlaceholderText, validateEntry } = require('../../scripts/health-sync/quality_gates');

describe('quality_gates', () => {
  it('detects placeholder text', () => {
    assert.strictEqual(isPlaceholderText('[Photo received - awaiting manual description]'), true);
    assert.strictEqual(isPlaceholderText('Breakfast: Avocado toast'), false);
  });

  it('blocks food entries without protein', () => {
    const entry = {
      timestamp: '2026-03-22T09:12:00-07:00',
      category: 'Food',
      mealType: 'Breakfast',
      title: 'Breakfast: Avocado toast',
      carbsEst: 21,
      caloriesEst: 340,
      proteinEst: null,
      photoUrls: ['https://example.com/photo.jpg']
    };

    const result = validateEntry(entry);
    assert.ok(result.errors.some(e => e.reason === 'missing_protein_required_for_food' || e.reason === 'missing_protein_required_for_breakfast'));
  });

  it('blocks placeholder food entries', () => {
    const entry = {
      timestamp: '2026-03-22T09:12:00-07:00',
      category: 'Food',
      title: 'Breakfast: [Photo received - awaiting manual description]',
      carbsEst: 21,
      caloriesEst: 340,
      proteinEst: 17,
      photoUrls: ['https://example.com/photo.jpg']
    };

    const result = validateEntry(entry);
    assert.ok(result.errors.some(e => e.reason === 'placeholder_food_entry_blocked'));
  });

  it('accepts complete food entries', () => {
    const entry = {
      timestamp: '2026-03-22T09:12:00-07:00',
      category: 'Food',
      title: 'Breakfast: Avocado toast',
      notes: 'BG: 121 mg/dL Flat; Protein: 17g',
      carbsEst: 21,
      caloriesEst: 340,
      proteinEst: 17,
      photoUrls: ['https://example.com/photo.jpg']
    };

    const result = validateEntry(entry);
    assert.strictEqual(result.errors.length, 0);
  });

  it('blocks image-origin food entry missing photo url', () => {
    const entry = {
      timestamp: '2026-03-23T13:01:00-07:00',
      category: 'Food',
      mealType: 'Lunch',
      title: 'Lunch: Japanese meal set',
      carbsEst: 55,
      caloriesEst: 480,
      proteinEst: 22,
      photoUrls: []
    };

    const result = validateEntry(entry, {
      findImageOriginMatch: () => ({
        contentType: 'IMAGE_DOCUMENT',
        messageId: 3267,
        diffMinutes: 0
      })
    });

    assert.ok(result.errors.some(e => e.reason === 'missing_photo_url_for_image_origin_entry'));
  });

  it('does not apply image-origin photo gate to non-food categories', () => {
    const entry = {
      timestamp: '2026-03-23T13:00:00-07:00',
      category: 'Medication',
      title: 'Metformin 500mg (lunch)',
      carbsEst: null,
      caloriesEst: null,
      proteinEst: null,
      photoUrls: []
    };

    const result = validateEntry(entry, {
      findImageOriginMatch: () => ({ contentType: 'IMAGE_DOCUMENT', messageId: 3267 })
    });

    assert.ok(!result.errors.some(e => e.reason === 'missing_photo_url_for_image_origin_entry'));
  });
});
