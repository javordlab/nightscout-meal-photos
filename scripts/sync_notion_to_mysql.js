const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const path = require('path');

// Helper to expand home directory
function expandHomeDir(p) {
    if (p.startsWith('~')) {
        return path.join(process.env.HOME, p.slice(1));
    }
    return p;
}

// --- Configuration ---
const NOTION_KEY = fs.readFileSync(expandHomeDir('~/.config/notion/api_key'), 'utf8').trim();
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const MYSQL_BIN = "/opt/homebrew/opt/mysql@8.4/bin/mysql";

async function notionRequest(method, endpoint, body = null) {
  const url = `https://api.notion.com/v1${endpoint}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(url, options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve(d); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function mysqlEscape(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function runQuery(sql) {
    const command = `${MYSQL_BIN} -u root health_monitor -e "${sql.replace(/"/g, '\\"')}"`;
    try {
        execSync(command);
        return true;
    } catch (e) {
        console.error("MySQL Query failed:", e.message);
        return false;
    }
}

async function main() {
    console.log("Starting Notion -> MySQL Async Sync...");
    let hasMore = true;
    let cursor = undefined;
    let totalSynced = 0;

    while (hasMore) {
        const res = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
            start_cursor: cursor,
            page_size: 100
        });

        if (!res.results) {
            console.error("Failed to query Notion:", res);
            break;
        }

        for (const page of res.results) {
            const p = page.properties;
            
            // Map meal type to enum values or null
            let mealType = p["Meal Type"]?.select?.name || null;
            if (mealType === "-" || mealType === "None") mealType = null;
            
            const data = {
                notion_id: page.id,
                entry_title: p.Entry?.title[0]?.plain_text || 'Untitled',
                event_date: p.Date?.date?.start ? p.Date.date.start.replace('T', ' ').substring(0, 19) : null,
                user_name: p.User?.select?.name || 'Maria Dennis',
                category: p.Category?.select?.name || 'Food',
                meal_type: mealType,
                carbs_est: p["Carbs (est)"]?.number || null,
                calories_est: p["Calories (est)"]?.number || null,
                photo_url: p.Photo?.url || null,
                pre_meal_bg: p["Pre-Meal BG"]?.number || null,
                peak_bg_2hr: p["2hr Peak BG"]?.number || null,
                bg_delta: p["BG Delta"]?.number || null,
                peak_time: p["Peak Time"]?.date?.start ? p["Peak Time"].date.start.replace('T', ' ').substring(0, 19) : null,
                time_to_peak_min: p["Time to Peak (min)"]?.number || null,
                predicted_peak_bg: p["Predicted Peak BG"]?.number || null,
                predicted_peak_time: p["Predicted Peak Time"]?.date?.start ? p["Predicted Peak Time"].date.start.replace('T', ' ').substring(0, 19) : null,
                peak_bg_delta: p["Peak BG Delta"]?.number || null,
                peak_time_delta_min: p["Peak Time Delta (min)"]?.number || null
            };

            const sql = `
                INSERT INTO maria_health_log 
                (notion_id, entry_title, event_date, user_name, category, meal_type, carbs_est, calories_est, photo_url, 
                 pre_meal_bg, peak_bg_2hr, bg_delta, peak_time, time_to_peak_min, predicted_peak_bg, predicted_peak_time, 
                 peak_bg_delta, peak_time_delta_min)
                VALUES 
                (${mysqlEscape(data.notion_id)}, ${mysqlEscape(data.entry_title)}, ${mysqlEscape(data.event_date)}, 
                 ${mysqlEscape(data.user_name)}, ${mysqlEscape(data.category)}, ${mysqlEscape(data.meal_type)}, 
                 ${data.carbs_est || 'NULL'}, ${data.calories_est || 'NULL'}, ${mysqlEscape(data.photo_url)},
                 ${data.pre_meal_bg || 'NULL'}, ${data.peak_bg_2hr || 'NULL'}, ${data.bg_delta || 'NULL'},
                 ${mysqlEscape(data.peak_time)}, ${data.time_to_peak_min || 'NULL'}, ${data.predicted_peak_bg || 'NULL'},
                 ${mysqlEscape(data.predicted_peak_time)}, ${data.peak_bg_delta || 'NULL'}, ${data.peak_time_delta_min || 'NULL'})
                ON DUPLICATE KEY UPDATE 
                entry_title = VALUES(entry_title),
                event_date = VALUES(event_date),
                meal_type = VALUES(meal_type),
                carbs_est = VALUES(carbs_est),
                calories_est = VALUES(calories_est),
                photo_url = VALUES(photo_url),
                pre_meal_bg = VALUES(pre_meal_bg),
                peak_bg_2hr = VALUES(peak_bg_2hr),
                bg_delta = VALUES(bg_delta),
                peak_time = VALUES(peak_time),
                time_to_peak_min = VALUES(time_to_peak_min),
                predicted_peak_bg = VALUES(predicted_peak_bg),
                predicted_peak_time = VALUES(predicted_peak_time),
                peak_bg_delta = VALUES(peak_bg_delta),
                peak_time_delta_min = VALUES(peak_time_delta_min);
            `;

            runQuery(sql);
            totalSynced++;
        }

        hasMore = res.has_more;
        cursor = res.next_cursor;
        console.log(`Synced ${totalSynced} records...`);
    }

    console.log(`Sync Complete. Total: ${totalSynced}`);
}

// Add expandHomeDir to path
path.expandHomeDir = expandHomeDir;

main().catch(err => {
    console.error(err);
    process.exit(1);
});
