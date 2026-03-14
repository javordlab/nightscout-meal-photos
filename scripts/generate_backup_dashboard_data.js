const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKUP_ROOT = "/Users/javier/.openclaw/workspace/backups/mysql";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/backups.json";
const SESSIONS_PATH = "/Users/javier/.openclaw/agents/health-guard/sessions/sessions.json";

function getFiles(dir, retentionType) {
    const fullPath = path.join(BACKUP_ROOT, dir);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath)
        .filter(f => f.endsWith('.gz'))
        .map(f => {
            const filePath = path.join(fullPath, f);
            const stats = fs.statSync(filePath);
            return {
                filename: f,
                type: retentionType,
                size: (stats.size / 1024).toFixed(2) + " KB",
                created: stats.mtime.toISOString(),
                path: dir + "/" + f
            };
        });
}

const SHIPMENT_PATH = "/Users/javier/.openclaw/workspace/memory/shipment_status.json";
function getShipments() {
    if (!fs.existsSync(SHIPMENT_PATH)) return [];
    try {
        const raw = fs.readFileSync(SHIPMENT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Object.keys(parsed).map(tn => ({
            trackingNumber: tn,
            carrier: parsed[tn].carrier,
            status: parsed[tn].status,
            expectedDelivery: parsed[tn].expected_delivery,
            lastEvent: parsed[tn].last_event,
            lastUpdate: parsed[tn].last_update
        }));
    } catch (e) { return []; }
}

function getUsage() {
    const usage = [
        { platform: 'Gemini Antigravity', bucket: '250K', percent: 60, oauthUsed: 0 },
        { platform: 'Gemini CLI', bucket: '250K', percent: 100, oauthUsed: 0 },
        { platform: 'OpenAI Codex', bucket: '2M', percent: 99, oauthUsed: 0 },
        { platform: 'OpenAI GPT 5.3', bucket: '2M', percent: 99, oauthUsed: 0 }
    ];

    let totalOAuthTokens = 0;
    try {
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
        Object.values(sessions).forEach(s => {
            // Include both input and output tokens for OAuth sessions
            totalOAuthTokens += ((s.inputTokens || 0) + (s.outputTokens || 0));
        });
    } catch (e) {}

    return usage.map(u => {
        const bucketSize = u.bucket === '2M' ? 2000000 : 250000;
        const remaining = Math.round(bucketSize * (u.percent / 100));
        const managedUsed = bucketSize - remaining;
        
        return {
            platform: u.platform,
            bucketType: u.bucket,
            managedUsed: managedUsed,
            managedRemaining: remaining,
            oauthUsed: u.platform === 'Gemini Antigravity' ? totalOAuthTokens : 0, // Most usage is currently Antigravity
            percentRemaining: u.percent
        };
    });
}

function main() {
    console.log("Generating Dashboard Data...");
    const data = {
        lastUpdated: new Date().toISOString(),
        shipments: getShipments(),
        tokenUsage: getUsage(),
        backups: [
            ...getFiles('daily', 'Daily (7 days)'),
            ...getFiles('weekly', 'Weekly (1 month)'),
            ...getFiles('monthly', 'Monthly (Forever)')
        ].sort((a, b) => new Date(b.created) - new Date(a.created))
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    console.log(`Saved dashboard data to ${OUTPUT_PATH}`);
}
main();
