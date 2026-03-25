#!/usr/bin/env node
'use strict';

/**
 * generate_backup_dashboard_data.js
 *
 * Queries MySQL for glucose + notion sync counts, reads backup files from
 * the configured backup directory, and writes data/backups.json to the
 * nightscout-meal-photos repo so the backup-status.html dashboard stays
 * up to date.
 *
 * Expected environment variables (or defaults):
 *   MYSQL_HOST         – default: 127.0.0.1
 *   MYSQL_PORT         – default: 3306
 *   MYSQL_USER         – default: root
 *   MYSQL_PASSWORD     – required
 *   MYSQL_DATABASE     – default: nightscout
 *   GLUCOSE_TABLE      – default: entries       (columns: date, sgv)
 *   NOTION_TABLE       – default: notion_meals
 *   BACKUP_DIR         – path that contains daily/ and weekly/ subdirs
 *   REPO_DIR           – path to the nightscout-meal-photos repo root
 *   TOKEN_USAGE_FILE   – optional JSON file with token usage overrides
 */

const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

// ── Config ─────────────────────────────────────────────────────────────────
const DB_HOST     = process.env.MYSQL_HOST     || '127.0.0.1';
const DB_PORT     = parseInt(process.env.MYSQL_PORT || '3306', 10);
const DB_USER     = process.env.MYSQL_USER     || 'root';
const DB_PASS     = process.env.MYSQL_PASSWORD || '';
const DB_NAME     = process.env.MYSQL_DATABASE || 'nightscout';
const GLUCOSE_TBL = process.env.GLUCOSE_TABLE  || 'entries';
const NOTION_TBL  = process.env.NOTION_TABLE   || 'notion_meals';

// Default REPO_DIR: two levels up from this script (scripts/ → repo root)
const REPO_DIR    = process.env.REPO_DIR
  || path.resolve(__dirname, '..');

// Default BACKUP_DIR: sibling "backups" directory next to this script
const BACKUP_DIR  = process.env.BACKUP_DIR
  || path.resolve(__dirname, '..', 'backups');

const TOKEN_FILE  = process.env.TOKEN_USAGE_FILE
  || path.join(REPO_DIR, 'data', 'token_usage.json');

const OUTPUT_FILE = path.join(REPO_DIR, 'data', 'backups.json');

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Read backup files from BACKUP_DIR/{daily,weekly}/ and return a sorted list.
 */
function readBackupFiles() {
  const results = [];
  for (const subdir of ['daily', 'weekly']) {
    const dir = path.join(BACKUP_DIR, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      if (!filename.endsWith('.sql.gz') && !filename.endsWith('.sql')) continue;
      const fullPath = path.join(dir, filename);
      const stat     = fs.statSync(fullPath);
      results.push({
        filename,
        type:    subdir.charAt(0).toUpperCase() + subdir.slice(1),
        size:    formatBytes(stat.size),
        created: stat.mtime.toISOString(),
        path:    `${subdir}/${filename}`,
      });
    }
  }
  // Most-recent first
  results.sort((a, b) => new Date(b.created) - new Date(a.created));
  return results;
}

/**
 * Read optional token usage override file; return [] if absent.
 */
function readTokenUsage() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Warning: could not read token usage file:', e.message);
  }
  return [];
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const conn = await mysql.createConnection({
    host:     DB_HOST,
    port:     DB_PORT,
    user:     DB_USER,
    password: DB_PASS,
    database: DB_NAME,
  });

  try {
    // 1. Total record counts
    const [[{ glucoseCount }]] = await conn.query(
      `SELECT COUNT(*) AS glucoseCount FROM \`${GLUCOSE_TBL}\``
    );
    const [[{ notionCount }]] = await conn.query(
      `SELECT COUNT(*) AS notionCount FROM \`${NOTION_TBL}\``
    );

    // 2. Glucose trend: all readings, ordered by time
    //    Nightscout `entries` table stores epoch ms in `date`, mg/dL in `sgv`
    const [trendRows] = await conn.query(
      `SELECT date, sgv
         FROM \`${GLUCOSE_TBL}\`
        WHERE sgv IS NOT NULL AND sgv > 0
        ORDER BY date ASC`
    );

    const glucoseTrend = trendRows.map(r => ({
      t: new Date(Number(r.date)).toISOString(),
      v: Number(r.sgv),
    }));

    // 3. Daily sync history: cumulative row counts per calendar day (UTC)
    //    We group by date and compute a running total client-side so the
    //    chart shows the total at end-of-day rather than daily delta.
    const [glucoseByDay] = await conn.query(
      `SELECT DATE(FROM_UNIXTIME(date / 1000)) AS day, COUNT(*) AS cnt
         FROM \`${GLUCOSE_TBL}\`
        GROUP BY day
        ORDER BY day ASC`
    );

    const [notionByDay] = await conn.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS cnt
         FROM \`${NOTION_TBL}\`
        GROUP BY day
        ORDER BY day ASC`
    );

    // Build a merged day list
    const daysSet = new Set([
      ...glucoseByDay.map(r => toDateStr(new Date(r.day))),
      ...notionByDay.map(r => toDateStr(new Date(r.day))),
    ]);
    const allDays = [...daysSet].sort();

    const gMap = Object.fromEntries(
      glucoseByDay.map(r => [toDateStr(new Date(r.day)), Number(r.cnt)])
    );
    const nMap = Object.fromEntries(
      notionByDay.map(r => [toDateStr(new Date(r.day)), Number(r.cnt)])
    );

    let gCum = 0;
    let nCum = 0;
    const syncHistory = allDays.map(day => {
      gCum += gMap[day] || 0;
      nCum += nMap[day] || 0;
      return { date: day, glucose: gCum, notion: nCum };
    });

    // 4. Backup files
    const backups = readBackupFiles();

    // 5. Token usage (from file or empty)
    const tokenUsage = readTokenUsage();

    // 6. Assemble and write output
    const output = {
      lastUpdated: new Date().toISOString(),
      tokenUsage,
      database: {
        glucose: Number(glucoseCount),
        notion:  Number(notionCount),
      },
      syncHistory,
      glucoseTrend,
      backups,
    };

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`✓ Wrote ${OUTPUT_FILE}`);
    console.log(`  glucose: ${glucoseCount}, notion: ${notionCount}, trend points: ${glucoseTrend.length}, backups: ${backups.length}`);

  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('generate_backup_dashboard_data failed:', err.message);
  process.exit(1);
});
