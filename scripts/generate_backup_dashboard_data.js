const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKUP_ROOT = "/Users/javier/.openclaw/workspace/backups/mysql";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/backups.json";

function getFiles(dir, retentionType) {
    const fullPath = path.join(BACKUP_ROOT, dir);
    if (!fs.existsSync(fullPath)) return [];

    return fs.readdirSync(fullPath)
        .filter(f => f.endsWith('.gz'))
        .map(f => {
            const filePath = path.join(fullPath, f);
            const stats = fs.statSync(filePath);
            
            // Check if tracked by git
            let inGit = false;
            try {
                const gitPath = filePath.replace('/Users/javier/.openclaw/workspace/', '');
                const gitStatus = execSync(`git ls-files ${gitPath}`, { cwd: '/Users/javier/.openclaw/workspace' }).toString();
                inGit = gitStatus.length > 0;
            } catch (e) {}

            return {
                filename: f,
                type: retentionType,
                size: (stats.size / 1024).toFixed(2) + " KB",
                created: stats.mtime.toISOString(),
                local: true,
                git: inGit,
                path: dir + "/" + f
            };
        });
}

const SHIPMENT_PATH = "/Users/javier/.openclaw/workspace/memory/shipment_status.json";

function getShipmentStatus() {
    if (!fs.existsSync(SHIPMENT_PATH)) return null;
    try {
        const raw = fs.readFileSync(SHIPMENT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            trackingNumber: parsed.tracking_number,
            status: parsed.status,
            expectedDelivery: parsed.expected_delivery,
            lastEvent: parsed.last_event,
            lastAccessed: fs.statSync(SHIPMENT_PATH).mtime.toISOString()
        };
    } catch (e) {
        return null;
    }
}

function main() {
    console.log("Generating Backup Dashboard Data...");
    
    const data = {
        lastUpdated: new Date().toISOString(),
        shipment: getShipmentStatus(),
        backups: [
            ...getFiles('daily', 'Daily (7 days)'),
            ...getFiles('weekly', 'Weekly (1 month)'),
            ...getFiles('monthly', 'Monthly (Forever)')
        ].sort((a, b) => new Date(b.created) - new Date(a.created))
    };

    if (!fs.existsSync(path.dirname(OUTPUT_PATH))) {
        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    console.log(`Saved dashboard data to ${OUTPUT_PATH}`);
}

main();
