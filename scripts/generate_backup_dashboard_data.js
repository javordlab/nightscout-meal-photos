const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKUP_ROOT = "/Users/javier/.openclaw/workspace/backups/mysql";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/backups.json";
const SESSIONS_PATH = "/Users/javier/.openclaw/agents/health-guard/sessions/sessions.json";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";

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
            totalOAuthTokens += ((s.inputTokens || 0) + (s.outputTokens || 0));
        });
    } catch (e) {}

    return usage.map(u => {
        const bucketSize = u.bucket === '2M' ? 2500000 : 250000;
        const remaining = Math.round(bucketSize * (u.percent / 100));
        const managedUsed = bucketSize - remaining;
        
        return {
            platform: u.platform,
            bucketType: u.bucket,
            managedUsed: managedUsed,
            managedRemaining: remaining,
            oauthUsed: u.platform === 'Gemini Antigravity' ? totalOAuthTokens : 0,
            percentRemaining: u.percent
        };
    });
}

function getDatabaseStats() {
    const stats = {
        glucose: 0,
        notion: 0,
        history: []
    };

    try {
        // Current counts
        stats.glucose = parseInt(execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT COUNT(*) FROM glucose_measurements;"`).toString().trim());
        stats.notion = parseInt(execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT COUNT(*) FROM maria_health_log;"`).toString().trim());

        // Simple growth history (last 30 days by created_at/event_time)
        const glucoseHistory = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT DATE(event_time), COUNT(*) FROM glucose_measurements GROUP BY DATE(event_time) ORDER BY DATE(event_time) DESC LIMIT 30;"`).toString().trim().split('\n');
        const notionHistory = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT DATE(created_at), COUNT(*) FROM maria_health_log GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 30;"`).toString().trim().split('\n');

        stats.history = {
            glucose: glucoseHistory.map(line => {
                const [date, count] = line.split('\t');
                return { date, count: parseInt(count) };
            }),
            notion: notionHistory.map(line => {
                const [date, count] = line.split('\t');
                return { date, count: parseInt(count) };
            })
        };
    } catch (e) {
        console.error("Database stats failed:", e.message);
    }
    return stats;
}

function getGlucoseTrend() {
    try {
        // Fetch last 30 days of data from MySQL for the trend
        // Decimating or averaging might be needed for performance, but for now let's get the raw points
        const raw = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT event_time, sgv FROM glucose_measurements WHERE event_time >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY event_time ASC;"`).toString().trim();
        if (!raw) return [];
        return raw.split('\n').map(line => {
            const [time, sgv] = line.split('\t');
            return { t: new Date(time).toISOString(), v: parseInt(sgv) };
        });
    } catch (e) {
        console.error("Glucose trend failed:", e.message);
        return [];
    }
}

function main() {
    console.log("Generating Dashboard Data...");
    const currentData = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) : {};
    
    const dbStats = getDatabaseStats();
    const trend = getGlucoseTrend();
    
    // Maintain a rolling history of total counts for the growth chart
    let syncHistory = currentData.syncHistory || [];
    const today = new Date().toISOString().split('T')[0];
    
    // Update or add today's entry
    const entryIdx = syncHistory.findIndex(h => h.date === today);
    const newEntry = { date: today, glucose: dbStats.glucose, notion: dbStats.notion };
    if (entryIdx >= 0) {
        syncHistory[entryIdx] = newEntry;
    } else {
        syncHistory.push(newEntry);
    }
    
    // Keep last 30 entries
    if (syncHistory.length > 30) syncHistory = syncHistory.slice(-30);

    const data = {
        lastUpdated: new Date().toISOString(),
        shipments: getShipments(),
        tokenUsage: getUsage(),
        database: dbStats,
        syncHistory: syncHistory,
        glucoseTrend: trend,
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