#!/usr/bin/env node
/**
 * dashboard_server.js — Cron health dashboard API + HTML server.
 *
 * Two ways to use the dashboard:
 *   1. Apache (canonical): http://localhost/healthguard/  — static HTML + proxied /api/*
 *   2. Standalone:         node dashboard_server.js       — self-serves both HTML and API
 *
 * Endpoints:
 *   GET /            — serves dashboard HTML (API_BASE patched to relative '')
 *   GET /api/status  — current cron_watchdog_status.json (auto-runs watchdog if stale >5m)
 *   GET /api/refresh — force-run watchdog, return fresh status
 *
 * Usage: node scripts/health-sync/dashboard_server.js [--port=4242]
 *        PORT=8080 node scripts/health-sync/dashboard_server.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/javier/.openclaw/workspace';
const STATUS_FILE = path.join(WORKSPACE, 'data/cron_watchdog_status.json');
const WATCHDOG = path.join(WORKSPACE, 'scripts/health-sync/cron_health_watchdog.js');
const HTML_FILE = '/opt/homebrew/var/www/healthguard/index.html';

const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = parseInt(process.env.PORT || (portArg ? portArg.split('=')[1] : '4242'), 10);

function runWatchdog() {
  execSync(`node "${WATCHDOG}"`, { timeout: 20000, stdio: 'pipe' });
}

function readStatus() {
  return fs.readFileSync(STATUS_FILE, 'utf8');
}

/** Read static HTML and patch API_BASE for standalone serving (relative paths). */
function readHtml() {
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  return html.replace("const API_BASE = '/healthguard';", "const API_BASE = '';");
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' };

  if (url === '/api/status') {
    try {
      const stat = fs.statSync(STATUS_FILE);
      if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) runWatchdog();
    } catch {
      try { runWatchdog(); } catch { /* watchdog unavailable */ }
    }
    try {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(readStatus());
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'Status not available: ' + e.message }));
    }

  } else if (url === '/api/refresh') {
    try {
      runWatchdog();
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(readStatus());
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: e.message }));
    }

  } else {
    try {
      const html = readHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Dashboard HTML not found: ' + e.message);
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Cron Health Dashboard → http://localhost:${PORT}`);
  console.log(`Apache (canonical)   → http://localhost/healthguard/`);
});
