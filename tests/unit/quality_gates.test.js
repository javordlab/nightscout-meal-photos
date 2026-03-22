const { describe, it } = require('node:test');
const assert = require('node:assert');

const { isPlaceholderText, validateEntry } = require('../../scripts/health-sync/quality_gates');

describe('quality_gates', () => {
  it('detects placeholder text', () => {
    assert.strictEqual(isPlaceholderText('[Photo received - awaiting manual description]'), true);
    assert.strictEqual(isPlaceholderText('Breakfast: Avocado toast'), false);
  });

  it('blocks breakfast entries without protein', () => {
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
    assert.ok(result.errors.some(e => e.reason === 'missing_protein_required_for_breakfast'));
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
});
