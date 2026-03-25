#!/usr/bin/env node
const fs = require('fs');
const https = require('https');

const LOG_PATH = '/Users/javier/.openclaw/workspace/health_log.md';
const NS_URL = 'https://p01--sefi--s66fclg7g2lm.code.run';
const NS_SECRET = 'b3170e23f45df7738434cd8be9cd79d86a6d0f01';
const NOTION_KEY = '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';
const NOTION_DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const daysArg = Number(process.argv[2] || 2);
const lookbackDays = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 2;

function reqJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function toLocalMinute(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: TZ });
  const time = d.toLocaleTimeString('en-US', {
    timeZone: TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${date} ${time}`;
}

function normalizeText(s = '') {
  return s
    .replace(/\[📷\]\([^)]*\)/g, '')
    .replace(/~\d+\s*g\s*carbs/gi, '')
    .replace(/~\d+\s*kcal/gi, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseLocalRows() {
  const text = fs.readFileSync(LOG_PATH, 'utf8');
  const rows = [];
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  for (const line of text.split('\n')) {
    if (!line.startsWith('| 202')) continue;
    const p = line.split('|').map((x) => x.trim());
    if (p.length < 9) continue;
    const [date, time, user, category, mealType, entry, carbsRaw, calsRaw] = p.slice(1, 9);
    const localIso = `${date}T${time}:00`;
    const d = new Date(localIso);
    if (isNaN(d.getTime())) continue;
    if (d < cutoff) continue;

    rows.push({
      date,
      time,
      dateTimeKey: `${date} ${time}`,
      user,
      category,
      mealType,
      entry,
      normEntry: normalizeText(entry),
      carbs: Number.isNaN(Number(carbsRaw)) ? null : Number(carbsRaw),
      cals: Number.isNaN(Number(calsRaw)) ? null : Number(calsRaw)
    });
  }
  return rows;
}

async function fetchNotion() {
  const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  let cursor = undefined;
  const out = [];

  while (true) {
    const body = {
      page_size: 100,
      filter: { property: 'Date', date: { on_or_after: start } }
    };
    if (cursor) body.start_cursor = cursor;

    const data = await reqJson(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    }, body);

    for (const r of data.results || []) {
      const title = r.properties?.Entry?.title?.[0]?.plain_text || '';
      const dt = r.properties?.Date?.date?.start;
      if (!dt) continue;
      out.push({
        id: r.id,
        dateTimeKey: toLocalMinute(dt),
        category: r.properties?.Category?.select?.name || '-',
        entry: title,
        normEntry: normalizeText(title),
        carbs: r.properties?.['Carbs (est)']?.number ?? null,
        cals: r.properties?.['Calories (est)']?.number ?? null
      });
    }

    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return out;
}

async function fetchNightscout() {
  const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const url = `${NS_URL}/api/v1/treatments.json?find[created_at][$gte]=${encodeURIComponent(start)}&count=1000`;
  const rows = await reqJson(url, {
    method: 'GET',
    headers: { 'api-secret': NS_SECRET, Accept: 'application/json' }
  });

  return (Array.isArray(rows) ? rows : []).map((r) => {
    const notes = r.notes || '';
    const kcalMatch = notes.match(/~\s*(\d+)\s*kcal/i);
    return {
      id: r._id,
      dateTimeKey: toLocalMinute(r.created_at),
      eventType: r.eventType || null,
      category: r.eventType === 'Meal Bolus' ? 'Food' : r.eventType === 'Exercise' ? 'Activity' : 'Medication',
      entry: notes,
      normEntry: normalizeText(notes),
      carbs: typeof r.carbs === 'number' ? r.carbs : null,
      cals: kcalMatch ? Number(kcalMatch[1]) : null
    };
  });
}

function findMatch(local, arr) {
  const exact = arr.find((x) => x.dateTimeKey === local.dateTimeKey && x.category === local.category && (x.normEntry.includes(local.normEntry.slice(0, 24)) || local.normEntry.includes(x.normEntry.slice(0, 24))));
  if (exact) return exact;
  return arr.find((x) => x.dateTimeKey === local.dateTimeKey && x.category === local.category);
}

(async () => {
  const local = parseLocalRows();
  const notion = await fetchNotion();
  const ns = await fetchNightscout();

  const issues = [];

  for (const l of local) {
    const n = findMatch(l, notion);
    const t = findMatch(l, ns);

    if (!n) issues.push(`[MISSING NOTION] ${l.dateTimeKey} ${l.category} :: ${l.entry}`);
    if (!t) issues.push(`[MISSING NIGHTSCOUT] ${l.dateTimeKey} ${l.category} :: ${l.entry}`);

    if (l.category === 'Food') {
      if (n && l.carbs !== null && n.carbs !== null && Number(l.carbs) !== Number(n.carbs)) {
        issues.push(`[CARB MISMATCH][NOTION] ${l.dateTimeKey} local=${l.carbs} notion=${n.carbs} :: ${l.entry}`);
      }
      if (n && l.cals !== null && n.cals !== null && Number(l.cals) !== Number(n.cals)) {
        issues.push(`[CAL MISMATCH][NOTION] ${l.dateTimeKey} local=${l.cals} notion=${n.cals} :: ${l.entry}`);
      }
      if (t && l.carbs !== null && t.carbs !== null && Number(l.carbs) !== Number(t.carbs)) {
        issues.push(`[CARB MISMATCH][NS] ${l.dateTimeKey} local=${l.carbs} nightscout=${t.carbs} :: ${l.entry}`);
      }
      if (t && l.cals !== null && t.cals !== null && Number(l.cals) !== Number(t.cals)) {
        issues.push(`[CAL MISMATCH][NS] ${l.dateTimeKey} local=${l.cals} nightscout=${t.cals} :: ${l.entry}`);
      }
      if (t && t.eventType !== 'Meal Bolus') {
        issues.push(`[EVENTTYPE ERROR][NS] ${l.dateTimeKey} expected=Meal Bolus actual=${t.eventType}`);
      }
    }

    if (l.category === 'Activity' && t && t.eventType !== 'Exercise') {
      issues.push(`[EVENTTYPE ERROR][NS] ${l.dateTimeKey} expected=Exercise actual=${t.eventType}`);
    }

    if (l.category === 'Medication' && t && t.eventType !== 'Note') {
      issues.push(`[EVENTTYPE ERROR][NS] ${l.dateTimeKey} expected=Note actual=${t.eventType}`);
    }
  }

  if (issues.length) {
    console.log(`FAIL: ${issues.length} consistency issue(s) found over last ${lookbackDays} day(s).`);
    for (const i of issues) console.log(i);
    process.exit(2);
  }

  console.log(`PASS: Consistency check passed for last ${lookbackDays} day(s).`);
})();