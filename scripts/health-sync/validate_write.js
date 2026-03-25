#!/usr/bin/env node
/**
 * validate_write.js — Post-write quality gate for health_log.md
 *
 * Checks all Food entries written today (local date) for required fields:
 *   - Meal-type prefix (Breakfast/Lunch/Snack/Dinner/Dessert)
 *   - BG annotation (BG: value trend)
 *   - Pred annotation (Pred: range @ time)
 *   - Macros (Protein | Carbs | Cals)
 *
 * Outputs JSON for Claude Code hook additionalContext injection.
 * Appends violations to data/violations.log.
 * Exits 0 always (non-blocking validator — violations are advisory).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const HEALTH_LOG = path.join(WORKSPACE, 'health_log.md');
const VIOLATIONS_LOG = path.join(WORKSPACE, 'data', 'violations.log');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const BG_REGEX = /\(BG:\s*[^)]+\)/i;
const PRED_REGEX = /\(Pred:\s*[^)]+@[^)]+\)/i;
const MACROS_REGEX = /\(Protein:\s*[^|)]+\|\s*Carbs:\s*[^|)]+\|\s*Cals:\s*[^)]+\)/i;
const MEAL_TYPE_PREFIX = /^(Breakfast|Lunch|Snack|Dinner|Dessert):/i;

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function appendViolation(entry) {
  try {
    fs.mkdirSync(path.dirname(VIOLATIONS_LOG), { recursive: true });
    fs.appendFileSync(VIOLATIONS_LOG, JSON.stringify(entry) + '\n');
  } catch {}
}

function parseLogLine(line) {
  // Split naively, then rejoin description parts.
  // Description can contain '|' inside macro annotations like (Protein: Xg | Carbs: ~Xg | Cals: ~X).
  // Format: | DATE | TIME | USER | CATEGORY | MEAL_TYPE | DESCRIPTION... | CARBS | CALS |
  // raw[0] = '' (before first |), raw[raw.length-1] = '' (after last |)
  // raw[raw.length-2] = CALS, raw[raw.length-3] = CARBS
  // raw.slice(6, raw.length-3) = all description parts
  const raw = line.split('|').map(s => s.trim());
  if (raw.length < 10) return null;

  const date = raw[1];
  const time = raw[2];
  const user = raw[3];
  const category = raw[4];
  const mealType = raw[5];
  const cals = raw[raw.length - 2];
  const carbs = raw[raw.length - 3];
  const description = raw.slice(6, raw.length - 3).join(' | ');

  return { date, time, user, category, mealType, description, carbs, cals };
}

function validateFoodEntry(line) {
  const violations = [];

  const parsed = parseLogLine(line);
  if (!parsed) return null;
  if (parsed.category !== 'Food') return null;

  const { date, time, mealType, description } = parsed;

  if (!MEAL_TYPE_PREFIX.test(description)) {
    violations.push(`missing meal-type prefix (Breakfast:/Lunch:/Snack:/Dinner:/Dessert:)`);
  }

  if (!BG_REGEX.test(description)) {
    violations.push('missing BG annotation (BG: value trend)');
  }

  if (!PRED_REGEX.test(description)) {
    violations.push('missing Pred annotation (Pred: range @ time)');
  }

  if (!MACROS_REGEX.test(description)) {
    violations.push('missing macros (Protein | Carbs | Cals)');
  }

  return {
    date,
    time,
    mealType,
    description: description.slice(0, 80),
    violations
  };
}

function main() {
  const today = localDateString();

  if (!fs.existsSync(HEALTH_LOG)) {
    const result = { status: 'skipped', reason: 'health_log_not_found' };
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[validate_write] SKIPPED: health_log.md not found`
      }
    }));
    return;
  }

  const lines = fs.readFileSync(HEALTH_LOG, 'utf8').split('\n');

  const todayFoodEntries = lines
    .filter(line => line.startsWith(`| ${today}`))
    .filter(line => {
      const parts = line.split('|').map(s => s.trim());
      return parts[4] === 'Food';
    });

  if (todayFoodEntries.length === 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[validate_write] No Food entries found for today (${today}).`
      }
    }));
    return;
  }

  const results = todayFoodEntries
    .map(line => validateFoodEntry(line))
    .filter(Boolean);

  const violations = results.filter(r => r.violations.length > 0);
  const clean = results.filter(r => r.violations.length === 0);

  if (violations.length > 0) {
    const ts = new Date().toISOString();
    for (const v of violations) {
      appendViolation({
        ts,
        date: v.date,
        time: v.time,
        mealType: v.mealType,
        description: v.description,
        violations: v.violations
      });
    }

    const summary = violations.map(v =>
      `  ⚠️  ${v.time} ${v.mealType}: ${v.violations.join(', ')}\n     Entry: ${v.description}`
    ).join('\n');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: [
          `[validate_write] P0 VIOLATION — ${violations.length} Food entry(ies) on ${today} FAIL quality gates:`,
          summary,
          `${clean.length} entries pass. Fix violations before claiming success or sending Telegram confirmation.`
        ].join('\n')
      }
    }));
  } else {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[validate_write] ✓ All ${clean.length} Food entries for ${today} pass quality gates (BG, Pred, meal-type prefix, macros).`
      }
    }));
  }
}

main();
