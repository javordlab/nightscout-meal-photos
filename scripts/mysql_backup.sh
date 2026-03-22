#!/bin/bash

# Configuration
DB_NAME="health_monitor"
BACKUP_DIR="/Users/javier/.openclaw/workspace/backups/mysql"
MYSQLDUMP="/opt/homebrew/opt/mysql@8.4/bin/mysqldump"
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u) # 1-7 (Monday-Sunday)
DAY_OF_MONTH=$(date +%d)

# Create Directories
mkdir -p "$BACKUP_DIR/daily"
mkdir -p "$BACKUP_DIR/weekly"
mkdir -p "$BACKUP_DIR/monthly"

# 1. Create Daily Backup
FILE="$BACKUP_DIR/daily/$DATE.sql.gz"
$MYSQLDUMP -u root "$DB_NAME" | gzip > "$FILE"

# 2. Weekly Backup (Every Monday)
if [ "$DAY_OF_WEEK" -eq 1 ]; then
    cp "$FILE" "$BACKUP_DIR/weekly/$(date +%Y-w%V).sql.gz"
fi

# 3. Monthly Backup (1st of the month)
if [ "$DAY_OF_MONTH" -eq "01" ]; then
    cp "$FILE" "$BACKUP_DIR/monthly/$(date +%Y-%m).sql.gz"
fi

# 4. Retention Pruning
# Keep daily for 7 days
find "$BACKUP_DIR/daily" -name "*.sql.gz" -mtime +7 -delete

# Keep weekly for 31 days
find "$BACKUP_DIR/weekly" -name "*.sql.gz" -mtime +31 -delete

# (Monthly backups are kept indefinitely by this script)

# 5. Update Dashboard
/opt/homebrew/bin/node /Users/javier/.openclaw/workspace/scripts/generate_backup_dashboard_data.js
cd /Users/javier/.openclaw/workspace/nightscout-meal-photos
/usr/bin/git add data/backups.json
/usr/bin/git commit -m "chore: automated backup dashboard update"
/usr/bin/git push origin main

echo "MySQL Backup Completed: $FILE"
