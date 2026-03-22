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

function getDatabaseStats() {
    const stats = { glucose: 0, notion: 0, syncHistory: [] };
    try {
        stats.glucose = parseInt(execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT COUNT(*) FROM glucose_measurements;"`).toString().trim());
        stats.notion = parseInt(execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT COUNT(*) FROM maria_health_log;"`).toString().trim());

        // RECONSTRUCT CUMULATIVE HISTORY
        const glucoseHistory = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT DATE(event_time) as d, COUNT(*) FROM glucose_measurements GROUP BY d ORDER BY d ASC;"`).toString().trim().split('\n');
        const notionHistory = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT DATE(event_date) as d, COUNT(*) FROM maria_health_log GROUP BY d ORDER BY d ASC;"`).toString().trim().split('\n');

        const gMap = {}; let gCum = 0;
        glucoseHistory.forEach(l => { const [d, c] = l.split('\t'); gCum += parseInt(c); gMap[d] = gCum; });
        const nMap = {}; let nCum = 0;
        notionHistory.forEach(l => { const [d, c] = l.split('\t'); nCum += parseInt(c); nMap[d] = nCum; });

        const allDates = [...new Set([...Object.keys(gMap), ...Object.keys(nMap)])].sort();
        const start = new Date(allDates[0]);
        const end = new Date();
        const dateSet = new Set();
        let curr = new Date(start.getTime());
        curr.setHours(12,0,0,0);
        while (curr <= end) { dateSet.add(curr.toISOString().split('T')[0]); curr.setDate(curr.getDate()+1); }
        
        const continuousDates = Array.from(dateSet).sort();
        let lastG = 0, lastN = 0;
        stats.syncHistory = continuousDates.map(d => {
            if (gMap[d]) lastG = gMap[d];
            if (nMap[d]) lastN = nMap[d];
            return { date: d, glucose: lastG, notion: lastN };
        }).slice(-30);
    } catch (e) { console.error(e); }
    return stats;
}

function getGlucoseTrend() {
    try {
        const raw = execSync(`${MYSQL_BIN} -u root health_monitor -N -e "SELECT event_time, sgv FROM glucose_measurements WHERE event_time >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY event_time ASC;"`).toString().trim();
        return raw.split('\n').map(line => {
            const [time, sgv] = line.split('\t');
            return { t: new Date(time + "Z").toISOString(), v: parseInt(sgv) };
        });
    } catch (e) { return []; }
}

function getUsage() {
    const usageByModel = {};
    const SCRAPE_FILE = "/Users/javier/.openclaw/workspace/data/usage_scrape.json";
    let scraped = {};
    try {
        if (fs.existsSync(SCRAPE_FILE)) {
            scraped = JSON.parse(fs.readFileSync(SCRAPE_FILE, 'utf8'));
        }
    } catch(e) {}

    try {
        if (fs.existsSync(SESSIONS_PATH)) {
            const sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
            for (const key in sessions) {
                const s = sessions[key];
                const label = `${s.modelProvider || 'unknown'}/${s.model || 'unknown'}`;
                const tokens = (s.totalTokens || 0) + (s.inputTokens || 0) + (s.outputTokens || 0);
                usageByModel[label] = (usageByModel[label] || 0) + tokens;
            }
        }
    } catch (e) {}
    
    const platforms = [
        { id: 'ollama/kimi-k2.5:cloud', name: 'Kimi (Ollama)', bucket: 'Free', link: 'https://ollama.com' },
        { id: 'google-antigravity/gemini-3-flash', name: 'Gemini Antigravity', bucket: scraped.google || 'Pay-as-you-go', link: 'https://aistudio.google.com/app/plan' },
        { id: 'openai-codex/gpt-5.3-codex', name: 'OpenAI Codex', bucket: scraped.openai || 'Pay-as-you-go', link: 'https://platform.openai.com/usage' }
    ];

    return platforms.map(p => ({
        platform: p.name, bucketType: p.bucket, realTokens: usageByModel[p.id] || 0, link: p.link
    }));
}

function main() {
    const dbStats = getDatabaseStats();
    const data = {
        lastUpdated: new Date().toISOString(),
        tokenUsage: getUsage(),
        database: { glucose: dbStats.glucose, notion: dbStats.notion },
        syncHistory: dbStats.syncHistory,
        glucoseTrend: getGlucoseTrend(),
        backups: [...getFiles('daily', 'Daily'), ...getFiles('weekly', 'Weekly')].sort((a,b) => new Date(b.created) - new Date(a.created))
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
}
main();
