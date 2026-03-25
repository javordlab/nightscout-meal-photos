const https = require('https');
const fs = require('fs');

const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET_HASH = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function nsGet(path) {
    return new Promise((resolve, reject) => {
        https.get(`${NS_URL}${path}`, {
            headers: { 'api-secret': NS_SECRET_HASH, 'Accept': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error("JSON Parse Error for data:", data);
                    resolve([]);
                }
            });
        }).on('error', reject);
    });
}

async function nsPut(treatment) {
    return new Promise((resolve, reject) => {
        const cleaned = {
            eventType: treatment.eventType,
            created_at: treatment.created_at,
            carbs: treatment.carbs,
            notes: treatment.notes,
            enteredBy: "Antigravity Sync Guard"
        };
        const data = JSON.stringify(cleaned);
        const options = {
            method: 'POST',
            headers: {
                'api-secret': NS_SECRET_HASH,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(`${NS_URL}/api/v1/treatments`, options, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(resData));
                } catch (e) {
                    console.error("POST Failed, response:", resData);
                    resolve({});
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function nsDelete(id) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'DELETE',
            headers: {
                'api-secret': NS_SECRET_HASH,
                'Accept': 'application/json'
            }
        };
        const req = https.request(`${NS_URL}/api/v1/treatments/${id}`, options, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => resolve(resData));
        });
        req.on('error', reject);
        req.end();
    });
}

async function notionQuery() {
    return new Promise((resolve, reject) => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const data = JSON.stringify({
            filter: {
                property: "Date",
                date: { on_or_after: yesterday }
            }
        });
        const options = {
            hostname: 'api.notion.com',
            path: `/v1/databases/${DATABASE_ID}/query`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_KEY}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };
        const req = https.request(options, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => resolve(JSON.parse(resData)));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function run() {
    console.log("--- Sync Guard Phase 1: Fixing Nightscout null eventTypes ---");
    let treatments = await nsGet('/api/v1/treatments.json?count=100');
    if (!Array.isArray(treatments)) {
        console.log("Treatments response is not an array:", treatments);
        treatments = [];
    }
    
    for (const t of treatments) {
        if (!t.eventType || t.eventType === null) {
            if (t.notes && (t.notes.includes('Breakfast') || t.notes.includes('Lunch') || t.notes.includes('Dinner') || t.notes.includes('Snack') || t.notes.includes('Dessert') || t.notes.includes('Meal') || t.notes.includes('Food'))) {
                console.log(`Fixing treatment ${t._id}: setting eventType to 'Meal Bolus'`);
                t.eventType = 'Meal Bolus';
                await nsPut(t);
                await nsDelete(t._id);
            }
        }
    }

    console.log("\n--- Sync Guard Phase 2: Auditing Last 24h ---");
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rolling24h = yesterday.toISOString();
    
    const logContent = fs.readFileSync('/Users/javier/.openclaw/workspace/health_log.md', 'utf8');
    const lines = logContent.split('\n');
    const localEntries = [];

    for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 10 || parts[1] === 'Date') continue;
        
        const entryDate = parts[1];
        const entryTime = parts[2];
        const _tSgc = entryTime.split(' '); const _oSgc = _tSgc[1] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
        const entryIso = `${entryDate}T${_tSgc[0]}:00${_oSgc}`;
        const entryDt = new Date(entryIso);

        if (entryDt >= yesterday) {
            localEntries.push({
                date: entryDate,
                time: entryTime,
                user: parts[3],
                category: parts[4],
                mealType: parts[5],
                entry: parts[6],
                carbs: parts[7],
                cals: parts[8]
            });
        }
    }

    const nsRecent = await nsGet(`/api/v1/treatments.json?find[created_at][$gte]=${yesterday.toISOString()}`);
    const notionRecent = await notionQuery();
    const notionTitles = notionRecent.results.map(r => r.properties.Entry.title[0]?.plain_text);

    console.log(`Local logs (last 24h, non-activity): ${localEntries.length}`);
    console.log(`Nightscout entries (last 24h): ${Array.isArray(nsRecent) ? nsRecent.length : 'error'}`);
    console.log(`Notion entries (last 24h): ${notionTitles.length}`);

    localEntries.forEach(le => {
        const cleanEntry = le.entry.split('(~')[0].split('[📷]')[0].trim();
        // Skip Breakfast prefix for matching
        const matchEntry = cleanEntry.replace(/^Breakfast: /, '').replace(/^Lunch: /, '').replace(/^Dinner: /, '').replace(/^Snack: /, '').substring(0, 15).toLowerCase();
        
        const nsMatch = Array.isArray(nsRecent) ? nsRecent.find(nt => nt.notes && (nt.notes.toLowerCase().includes(matchEntry) || matchEntry.includes(nt.notes.toLowerCase().substring(0, 15)) || (nt.notes.toLowerCase().includes('lisinopril') && matchEntry.includes('lisinopril')))) : true;
        const notionMatch = notionTitles.find(title => title && (title.toLowerCase().includes(matchEntry) || matchEntry.includes(title.toLowerCase().substring(0, 15)) || (title.toLowerCase().includes('lisinopril') && matchEntry.includes('lisinopril'))));
        
        if (!nsMatch && le.category !== 'Sleep' && le.category !== 'Sensor/Meter') {
            console.log(`[MISSING NS] ${le.date} ${le.time}: ${le.entry}`);
        }
        if (!notionMatch && le.category !== 'Sleep' && le.category !== 'Sensor/Meter') {
            console.log(`[MISSING NOTION] ${le.date} ${le.time}: ${le.entry}`);
        }
    });
}

run().catch(console.error);
