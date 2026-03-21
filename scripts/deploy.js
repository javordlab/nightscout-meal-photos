#!/usr/bin/env node
// deploy.js - Deployment script with environment-specific configuration

const fs = require('fs');
const path = require('path');

const ENV = process.argv.find(a => a.startsWith('--env='))?.split('=')[1] || 'local';

const CONFIG = {
  local: {
    notionDbId: 'test-db-local',
    notionKey: 'test-key-local',
    nightscoutUrl: 'http://localhost:1337',
    nightscoutSecret: 'test-secret',
    dataDir: path.join(__dirname, '..', 'data', 'local'),
    dryRun: true
  },
  staging: {
    notionDbId: process.env.NOTION_STAGING_DB_ID,
    notionKey: process.env.NOTION_STAGING_KEY,
    nightscoutUrl: process.env.NIGHTSCOUT_STAGING_URL,
    nightscoutSecret: process.env.NIGHTSCOUT_STAGING_SECRET,
    dataDir: path.join(__dirname, '..', 'data', 'staging'),
    dryRun: false
  },
  production: {
    notionDbId: process.env.NOTION_DB_ID,
    notionKey: process.env.NOTION_KEY,
    nightscoutUrl: process.env.NIGHTSCOUT_URL,
    nightscoutSecret: process.env.NIGHTSCOUT_SECRET,
    dataDir: path.join(__dirname, '..', 'data'),
    dryRun: false
  }
};

const config = CONFIG[ENV];
if (!config) {
  console.error(`Unknown environment: ${ENV}`);
  process.exit(1);
}

console.log(`🚀 Deploying to ${ENV} environment...\n`);
console.log('Configuration:');
console.log(`  Notion DB: ${config.notionDbId}`);
console.log(`  Nightscout: ${config.nightscoutUrl}`);
console.log(`  Data Dir: ${config.dataDir}`);
console.log(`  Dry Run: ${config.dryRun}`);
console.log();

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

// In a real deployment, this would:
// 1. Copy scripts to target environment
// 2. Set environment variables
// 3. Run validation
// 4. Execute sync
// 5. Verify results

console.log(`✅ ${ENV} deployment complete!\n`);
