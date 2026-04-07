#!/bin/bash
set -u

# Configuration
DATABASES=("health_monitor" "health_ssot")
BACKUP_DIR="/Users/javier/.openclaw/workspace/backups/mysql"
MYSQLDUMP="/opt/homebrew/opt/mysql@8.4/bin/mysqldump"
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u) # 1-7 (Monday-Sunday)
DAY_OF_MONTH=$(date +%d)

# Create Directories
mkdir -p "$BACKUP_DIR/daily"
mkdir -p "$BACKUP_DIR/weekly"
mkdir -p "$BACKUP_DIR/monthly"

# Per-database dump → daily/weekly/monthly. The first DB keeps the legacy
# `<date>.sql.gz` filename so the existing dashboard tooling and audit
# scripts continue to find it; additional DBs use `<db>-<date>.sql.gz`.
for i in "${!DATABASES[@]}"; do
    DB_NAME="${DATABASES[$i]}"
    if [ "$i" -eq 0 ]; then
        BASENAME="$DATE"
    else
        BASENAME="${DB_NAME}-${DATE}"
    fi

    FILE="$BACKUP_DIR/daily/${BASENAME}.sql.gz"
    if ! $MYSQLDUMP -u root "$DB_NAME" | gzip > "$FILE"; then
        echo "ERROR: mysqldump failed for $DB_NAME" >&2
        exit 1
    fi

    if [ "$DAY_OF_WEEK" -eq 1 ]; then
        if [ "$i" -eq 0 ]; then
            cp "$FILE" "$BACKUP_DIR/weekly/$(date +%Y-w%V).sql.gz"
        else
            cp "$FILE" "$BACKUP_DIR/weekly/${DB_NAME}-$(date +%Y-w%V).sql.gz"
        fi
    fi

    if [ "$DAY_OF_MONTH" -eq "01" ]; then
        if [ "$i" -eq 0 ]; then
            cp "$FILE" "$BACKUP_DIR/monthly/$(date +%Y-%m).sql.gz"
        else
            cp "$FILE" "$BACKUP_DIR/monthly/${DB_NAME}-$(date +%Y-%m).sql.gz"
        fi
    fi

    echo "MySQL Backup Completed: $FILE"
done

# Retention Pruning
# Keep daily for 7 days
find "$BACKUP_DIR/daily" -name "*.sql.gz" -mtime +7 -delete

# Keep weekly for 31 days
find "$BACKUP_DIR/weekly" -name "*.sql.gz" -mtime +31 -delete

# (Monthly backups are kept indefinitely by this script)

# Update Dashboard
/opt/homebrew/bin/node /Users/javier/.openclaw/workspace/scripts/generate_backup_dashboard_data.js
cd /Users/javier/.openclaw/workspace/nightscout-meal-photos
/usr/bin/git add data/backups.json
/usr/bin/git commit -m "chore: automated backup dashboard update"
/usr/bin/git push origin main
