'use strict';
/**
 * cron_receipt.js — write a "did my purpose succeed?" receipt for heartbeat_wrap.js.
 *
 * Any script run under heartbeat_wrap.js has the CRON_RECEIPT_FILE env var set to
 * a JSON path. Calling writeReceipt() dumps structured outcome there so the watchdog
 * can show it on the dashboard. Scripts that are not running under the wrapper (e.g.
 * manual dev runs) silently no-op — no env var, no file written.
 *
 * Contract (each field optional but recommended):
 *   status:  "ok" | "partial" | "warn" | "error" | "noop"
 *   summary: human-readable one-liner (≤500 chars)
 *   metrics: arbitrary object of counters/timings
 *
 * Example:
 *   const { writeReceipt } = require('./cron_receipt');
 *   writeReceipt({
 *     status: errors === 0 ? 'ok' : (errors < processed ? 'partial' : 'error'),
 *     summary: `Synced ${ns} NS, ${notion} Notion, ${errors} errors`,
 *     metrics: { processed, ns, notion, errors }
 *   });
 */

const fs = require('fs');

function writeReceipt(payload) {
  const receiptPath = process.env.CRON_RECEIPT_FILE;
  if (!receiptPath) return false; // not wrapped — silent noop (manual runs)
  try {
    const body = {
      status: payload && payload.status ? payload.status : 'ok',
      summary: payload && payload.summary != null ? String(payload.summary) : null,
      metrics: payload && payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : null
    };
    fs.writeFileSync(receiptPath, JSON.stringify(body));
    return true;
  } catch (e) {
    console.error('[cron_receipt] failed to write receipt:', e.message);
    return false;
  }
}

module.exports = { writeReceipt };
