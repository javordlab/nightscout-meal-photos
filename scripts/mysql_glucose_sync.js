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
                    resolve([]);
                }
            });
        }).on("error", reject);
    });
}

function runQuery(sql) {
    const command = `${MYSQL_BIN} -u root health_monitor -e "${sql.replace(/"/g, '\\"')}"`;
    try {
        const output = execSync(command).toString();
        // MySQL admin reports affected rows in stderr, but INSERT IGNORE behavior 
        // is best tracked by checking our own counts if needed.
        return true;
    } catch (e) {
        console.error("Query failed:", e.message);
        return false;
    }
}

function escapeSql(str) {
    if (str === null || str === undefined) return 'NULL';
    return `'${String(str).replace(/'/g, "''")}'`;
}

async function main() {
    console.log("Starting Adaptive Glucose Sync...");
    let totalSynced = 0;
    let lastDateInBatch = null;
    const batchSize = 100;
    
    // We loop until a batch returns fewer results than requested,
    // or until all results in a batch are already in our database (duplicate detection).
    while (true) {
        let url = `${NS_URL}/api/v1/entries/sgv.json?count=${batchSize}`;
        if (lastDateInBatch) {
            // Find records older than the last one we saw to paginate back if needed
            url += `&find[date][$lt]=${lastDateInBatch}`;
        }
        
        console.log(`Fetching batch of ${batchSize}...`);
        const entries = await nsRequest(url);

        if (!Array.isArray(entries) || entries.length === 0) {
            console.log("No more new entries found on server.");
            break;
        }

        let values = [];
        let newestMills = 0;
        let oldestMills = Infinity;

        for (const e of entries) {
            const mills = e.mills || e.date;
            if (!mills) continue;
            const time = e.dateString ? e.dateString.replace('T', ' ').substring(0, 19) : new Date(mills).toISOString().replace('T', ' ').substring(0, 19);
            const sgv = e.sgv || 0;
            values.push(`(${escapeSql(e._id)}, ${sgv}, ${escapeSql(e.direction)}, ${escapeSql(e.device)}, ${escapeSql(time)}, ${mills})`);
            
            if (mills > newestMills) newestMills = mills;
            if (mills < oldestMills) oldestMills = mills;
        }

        if (values.length > 0) {
            const sql = `INSERT IGNORE INTO glucose_measurements (ns_id, sgv, direction, device, event_time, mills) VALUES ${values.join(',')};`;
            runQuery(sql);
            
            // In MySQL, we can't easily see "affected rows" from a CLI 'INSERT IGNORE' 
            // without extra queries, so we use the batch logic:
            // If we got a full batch, there MIGHT be more data behind it.
            // We set lastDateInBatch to the oldest record in this batch to pull the next page.
            if (entries.length === batchSize) {
                lastDateInBatch = oldestMills;
                totalSynced += entries.length;
                console.log(`Full batch received (${entries.length}). Checking for older records...`);
            } else {
                totalSynced += entries.length;
                console.log(`Partial batch received (${entries.length}). Sync complete.`);
                break;
            }
        } else {
            break;
        }
        
        // Safety break to prevent runaway syncs
        if (totalSynced > 10000) {
            console.log("Safety limit reached (10k records). Finishing current run.");
            break;
        }
    }

    console.log(`Sync Process Finished. Total records processed: ${totalSynced}`);
}

main().catch(console.error);
