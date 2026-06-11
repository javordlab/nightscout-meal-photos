const https = require('https');
const { execSync } = require('child_process');
const { writeReceipt } = require('./health-sync/cron_receipt');

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

/** Return the current row count of glucose_measurements, or null on failure. */
function countGlucoseRows() {
    try {
        const out = execSync(
            `${MYSQL_BIN} -u root -N -B health_monitor -e "SELECT COUNT(*) FROM glucose_measurements;"`
        ).toString().trim();
        const n = parseInt(out, 10);
        return Number.isFinite(n) ? n : null;
    } catch (e) {
        console.error("Count query failed:", e.message);
        return null;
    }
}

function escapeSql(str) {
    if (str === null || str === undefined) return 'NULL';
    return `'${String(str).replace(/'/g, "''")}'`;
}

async function main() {
    console.log("Starting Adaptive Glucose Sync...");

    // Pre-sync row count — lets us report exactly how many new rows were inserted,
    // which is the real "did this job accomplish its purpose?" signal. INSERT IGNORE
    // silently drops duplicates so we can't rely on "totalFetched" alone.
    const beforeRows = countGlucoseRows();

    const metrics = {
        batches: 0,
        totalFetched: 0,
        rowsInserted: null,         // filled at the end from post-count delta
        rowsBefore: beforeRows,
        rowsAfter: null,
        safetyLimitHit: false,
        ageCutoffReached: false,
        queryErrors: 0,
        dashboardUpdated: false
    };

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
        metrics.batches++;

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
            const ok = runQuery(sql);
            if (!ok) metrics.queryErrors++;

            metrics.totalFetched += entries.length;

            // Check actual rows affected by querying count delta
            // Use a simpler heuristic: if we got a full batch but oldest entry is >48h old,
            // we're deep into historical data that's already synced — stop paginating.
            const ageHours = (Date.now() - oldestMills) / (1000 * 60 * 60);
            if (entries.length === batchSize && ageHours < 48) {
                lastDateInBatch = oldestMills;
                totalSynced += entries.length;
                console.log(`Full batch received (${entries.length}). Checking for older records...`);
            } else {
                totalSynced += entries.length;
                metrics.ageCutoffReached = ageHours >= 48;
                console.log(`Partial batch (${entries.length}) or caught up (age ${Math.round(ageHours)}h). Sync complete.`);
                break;
            }
        } else {
            break;
        }

        // Safety break to prevent runaway syncs
        if (totalSynced > 10000) {
            console.log("Safety limit reached (10k records). Finishing current run.");
            metrics.safetyLimitHit = true;
            break;
        }
    }

    console.log(`Sync Process Finished. Total records processed: ${totalSynced}`);

    // Post-sync count — delta is the real "rows actually inserted" signal.
    const afterRows = countGlucoseRows();
    metrics.rowsAfter = afterRows;
    metrics.rowsInserted = (beforeRows != null && afterRows != null)
        ? Math.max(0, afterRows - beforeRows)
        : null;

    // 4. Update Dashboard
    try {
        console.log("  -> Updating Backup Dashboard...");
        const NODE = '/opt/homebrew/bin/node';
        execSync(`${NODE} /Users/javier/.openclaw/workspace/scripts/generate_backup_dashboard_data.js`);
        execSync(`${NODE} /Users/javier/.openclaw/workspace/scripts/health-sync/deploy_gh_pages.js`, { stdio: 'inherit' });
        metrics.dashboardUpdated = true;
    } catch (e) {
        console.error("Dashboard update failed:", e.message);
        // Don't count dashboard deploy failures as query errors — they don't affect data integrity
        metrics.dashboardDeployFailed = true;
    }

    // --- Outcome receipt for cron dashboard ---
    let status;
    let summary;
    if (metrics.queryErrors > 0) {
        status = 'partial';
        summary = `${metrics.queryErrors} query error(s) — fetched ${metrics.totalFetched}, inserted ${metrics.rowsInserted ?? '?'}`;
    } else if (metrics.rowsInserted === 0) {
        status = 'ok';
        summary = `Caught up — 0 new rows (checked ${metrics.totalFetched} in ${metrics.batches} batch${metrics.batches === 1 ? '' : 'es'})`;
    } else if (metrics.rowsInserted == null) {
        status = 'warn';
        summary = `COUNT query failed — fetched ${metrics.totalFetched}, actual insert count unknown`;
    } else {
        status = 'ok';
        summary = `Inserted ${metrics.rowsInserted} new rows (fetched ${metrics.totalFetched} in ${metrics.batches} batch${metrics.batches === 1 ? '' : 'es'})` +
                  (metrics.ageCutoffReached ? ' — hit 48h age cutoff' : '') +
                  (metrics.safetyLimitHit ? ' — hit safety limit' : '');
    }
    writeReceipt({ status, summary, metrics });
}

main().catch(e => {
    console.error(e);
    writeReceipt({ status: 'error', summary: `MySQL glucose sync crashed: ${e.message || e}`, metrics: null });
    process.exit(1);
});
