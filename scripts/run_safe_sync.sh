#!/bin/bash
# run_safe_sync.sh - Run full sync pipeline with CI/CD protections

set -e

WORKSPACE="/Users/javier/.openclaw/workspace"
cd "$WORKSPACE"

echo "🛡️ Starting Protected Sync Pipeline..."

# 1. Run Integrity Checks and Tests
echo "🧪 Running validation tests..."
if ! npm test; then
    echo "❌ Tests failed. Aborting sync to protect data."
    exit 1
fi

# 2. Normalize Log
echo "📝 Normalizing health log..."
node scripts/health-sync/normalize_health_log.js

# 3. Perform Sync (Only New Entries)
echo "🔄 Syncing to Notion and Nightscout..."
# We use --only-new and --since to keep runs fast and safe
node scripts/health-sync/unified_sync.js --only-new --since=$(date -v-2d +%Y-%m-%d)

# 4. Update Gallery
echo "🖼️ Updating meal gallery..."
node scripts/generate_notion_gallery.js

echo "✅ Safe sync completed successfully."
