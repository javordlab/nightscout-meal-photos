const https = require('https');
const { execSync } = require('child_process');

const NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run";
const NS_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";

async function nsRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'api-secret': NS_SECRET } }, (res) => {
            let d = "";
            res.on("data", c => d += c);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(d || "[]"));
                } catch (e) {
                    console.error("JSON Parse Error:", d.substring(0, 100));
                    resolve([]);
                }
            });
        }).on("error", reject);
    });
}

function runQuery(sql) {
    const command = `${MYSQL_BIN} -u root health_monitor -e "${sql.replace(/"/g, '\\"')}"`;
    try {
        execSync(command);
    } catch (e) {
        console.error("Query failed:", e.message);
    }
}

function escapeSql(str) {
    if (str === null || str === undefined) return 'NULL';
    return `'${String(str).replace(/'/g, "''")}'`;
}

async function main() {
    console.log("Starting Glucose Historical Backfill v2...");
    let totalCount = 0;
    let lastMills = Date.now();
    const batchSize = 1000;

    while (true) {
        const url = `${NS_URL}/api/v1/entries/sgv.json?find[date][$lt]=${lastMills}&count=${batchSize}`;
        console.log(`Fetching batch before ${new Date(lastMills).toISOString()}...`);
        const entries = await nsRequest(url);

        if (!Array.isArray(entries) || entries.length === 0) {
            console.log("No more entries found.");
            break;
        }

        console.log(`  -> Processing ${entries.length} entries...`);
        
        let values = [];
        let batchMinMills = lastMills;

        for (const e of entries) {
            const mills = e.mills || e.date;
            if (!mills) continue;

            const time = e.dateString ? e.dateString.replace('T', ' ').substring(0, 19) : new Date(mills).toISOString().replace('T', ' ').substring(0, 19);
            const sgv = e.sgv || 0;
            
            values.push(`(${escapeSql(e._id)}, ${sgv}, ${escapeSql(e.direction)}, ${escapeSql(e.device)}, ${escapeSql(time)}, ${mills})`);
            batchMinMills = Math.min(batchMinMills, mills);
        }

        if (values.length > 0) {
            const sql = `INSERT IGNORE INTO glucose_measurements (ns_id, sgv, direction, device, event_time, mills) VALUES ${values.join(',')};`;
            runQuery(sql);
        }
        
        if (batchMinMills >= lastMills) {
            console.log("Pagination stuck, breaking.");
            break;
        }

        lastMills = batchMinMills;
        totalCount += entries.length;
        console.log(`  -> Total Synced: ${totalCount}`);

        if (totalCount > 150000) break; 
    }

    console.log("Historical Glucose Backfill Complete.");
}

main().catch(console.error);
