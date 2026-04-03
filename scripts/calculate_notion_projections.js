const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";

async function postJson(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

async function patchJson(id, props) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ properties: props });
    const options = {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(`https://api.notion.com/v1/pages/${id}`, options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(data);
    req.end();
  });
}

/**
 * PREDICTION MODEL v3 (calibrated 2026-04-02, n=57 meals)
 *
 * Layer 1 — Carb factors (Metformin-adjusted, preBG-anchored):
 *   BG rise per gram drops sharply at higher carb loads due to Metformin + saturation.
 *   Old flat factor 3.5 caused 75% overshoot rate, MAE=31.6 mg/dL.
 *
 *       0-15g: ×2.0   (avg actual rise 25 mg/dL)
 *      16-30g: ×1.3   (avg actual rise 38 mg/dL)
 *      31-50g: ×1.2   (avg actual rise 44 mg/dL)
 *        51+g: ×0.8   (Metformin strongly blunts large loads)
 *
 * Layer 2 — Meal-type intercepts (additive, empirical):
 *   Breakfast: +31 mg/dL  (dawn phenomenon / morning cortisol — drops breakfast MAE from 30.7→8.5)
 *   Lunch:     -12 mg/dL  (midday Metformin fully active)
 *   Dinner:     -2 mg/dL  (negligible)
 *   Snack:      +4 mg/dL
 *   Dessert:   -14 mg/dL  (usually follows a meal, BG partially blunted)
 *
 * Layer 3 — Cumulative meal preBG anchor (data quality fix):
 *   For cumulative meals, use the FIRST item's preBG in the meal session,
 *   not the live BG at time of logging subsequent items (which is mid-digestion).
 *   Session window: same meal type within 2 hours.
 *
 * All predictions anchor to preBG. If unknown: fallback 115 mg/dL (Maria's typical).
 * Cap at 300 mg/dL.
 */
const CARB_FACTORS = [
  { maxCarbs: 15,       factor: 2.0 },
  { maxCarbs: 30,       factor: 1.3 },
  { maxCarbs: 50,       factor: 1.2 },
  { maxCarbs: Infinity, factor: 0.8 },
];

// Additive intercepts per meal type (dawn phenomenon, Metformin timing, etc.)
const MEAL_INTERCEPTS = {
  breakfast: 31,
  lunch:    -12,
  dinner:    -2,
  snack:      4,
  dessert:  -14,
};

/**
 * Empirical time-to-peak defaults by meal type (57-meal analysis medians):
 *   Breakfast: 87 min  (morning, fastest)
 *   Dinner:    76 min  (often post-activity)
 *   Lunch:    113 min
 *   Snack:    126 min  (small bolus, slowest)
 *   Dessert:  102 min
 *   Default:   96 min  (overall median)
 */
const TTP_DEFAULTS_MIN = {
  breakfast: 87,
  lunch: 113,
  dinner: 76,
  snack: 126,
  dessert: 102,
  default: 96,
};

function getMealType(title) {
  const lower = (title || '').toLowerCase();
  for (const type of Object.keys(MEAL_INTERCEPTS)) {
    if (lower.startsWith(type)) return type;
  }
  return null;
}

function getCarbFactor(carbs) {
  for (const { maxCarbs, factor } of CARB_FACTORS) {
    if (carbs <= maxCarbs) return factor;
  }
  return 0.8;
}

function getTTPMinutes(title) {
  const type = getMealType(title);
  return type ? (TTP_DEFAULTS_MIN[type] ?? TTP_DEFAULTS_MIN.default) : TTP_DEFAULTS_MIN.default;
}

/**
 * Given all entries in the window, find the anchor preBG for this entry.
 * For cumulative meals: walk back to find the earliest entry of the same meal type
 * logged within 2 hours of this entry, and use its Pre-Meal BG.
 * For non-cumulative meals: use the entry's own Pre-Meal BG.
 *
 * @param {object} page - Current Notion page
 * @param {object[]} allPages - All pages fetched for the window (sorted ascending by date)
 * @returns {number|null} Anchor preBG
 */
function resolveAnchorPreBg(page, allPages) {
  const props = page.properties;
  const ownPreBg = props['Pre-Meal BG']?.number || null;
  const title = props.Entry.title[0]?.plain_text || '';
  const isCumulative = title.includes('[Cumulative');

  if (!isCumulative) return ownPreBg;

  const type = getMealType(title);
  if (!type) return ownPreBg;

  const thisTime = new Date(props.Date.date.start).getTime();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  // Find all Food entries of the same meal type within 2h before this entry
  const candidates = allPages.filter(p => {
    if (p.id === page.id) return false;
    if (p.archived) return false;
    const pProps = p.properties;
    if (pProps.Category?.select?.name !== 'Food') return false;
    const pTitle = pProps.Entry?.title?.[0]?.plain_text || '';
    if (getMealType(pTitle) !== type) return false;
    const pTime = new Date(pProps.Date?.date?.start).getTime();
    return pTime < thisTime && (thisTime - pTime) <= TWO_HOURS_MS;
  });

  if (!candidates.length) return ownPreBg;

  // Sort ascending and take the earliest one's preBG
  candidates.sort((a, b) =>
    new Date(a.properties.Date.date.start) - new Date(b.properties.Date.date.start)
  );
  const anchor = candidates[0].properties['Pre-Meal BG']?.number;
  if (anchor != null) {
    console.log(`  [CumulativeAnchor] Using preBG=${anchor} from earliest ${type} entry instead of live ${ownPreBg}`);
    return anchor;
  }
  return ownPreBg;
}

// Parse prediction from health_log.md title text embedded in Notion entry.
// Returns { bg, peakIso } if found, otherwise null.
// fullDateIso: full ISO string from Notion (e.g. "2026-03-22T12:00:00-07:00") to preserve offset.
function parsePredFromText(text, fullDateIso) {
  const match = text.match(/\(Pred:\s*([^@)]+?)\s*@\s*([^)]+)\)/i);
  if (!match) return null;

  const bgNums = match[1].match(/\d+/g);
  if (!bgNums) return null;
  const bg = Math.min(parseInt(bgNums[bgNums.length - 1]), 300);

  let peakIso = null;
  if (fullDateIso) {
    const datePart = fullDateIso.substring(0, 10);
    const offset = fullDateIso.match(/[+-]\d{2}:\d{2}$/)?.[0] || (() => { const m = -new Date().getTimezoneOffset(); const s = m >= 0 ? '+' : '-'; return `${s}${String(Math.floor(Math.abs(m)/60)).padStart(2,'0')}:${String(Math.abs(m)%60).padStart(2,'0')}`; })();
    const timeMatches = [...match[2].matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)/gi)];
    if (timeMatches.length > 0) {
      const mins = timeMatches.map(t => {
        const [h, m] = t[1].split(':').map(Number);
        return (h % 12 + (t[2].toUpperCase() === 'PM' ? 12 : 0)) * 60 + m;
      });
      const avg = Math.round(mins.reduce((a, b) => a + b) / mins.length);
      peakIso = `${datePart}T${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}:00${offset}`;
    }
  }

  return { bg, peakIso };
}

async function run() {
  console.log('Starting Projections Audit (model v3: intercepts + cumulative anchor)...');

  // Retroactive window: last 7 days in local (host) timezone context
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const onOrAfter = sevenDaysAgo.toISOString().slice(0, 10);

  // Pre-fetch ALL Food entries in the window (needed for cumulative anchor lookup)
  let allPages = [];
  let cursor;
  do {
    const res = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      filter: {
        and: [
          { property: 'Category', select: { equals: 'Food' } },
          { property: 'Date', date: { on_or_after: onOrAfter } }
        ]
      },
      sorts: [{ property: 'Date', direction: 'ascending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    if (!res.results) { console.error('Failed to fetch data:', res); return; }
    allPages = allPages.concat(res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  console.log(`Fetched ${allPages.length} Food entries for window starting ${onOrAfter}`);

  for (const page of allPages) {
    const props = page.properties;
    const carbs = props['Carbs (est)']?.number;
    const currentPred = props['Predicted Peak BG']?.number;
    const title = props.Entry.title[0]?.plain_text;
    const date = props.Date.date.start;

    if (currentPred == null) {
      const carbsForCalc = Number.isFinite(carbs) ? carbs : 0;
      const mealTime = new Date(date);

      // Priority 1: agent-provided prediction embedded in entry title ("Pred: X-Y mg/dL @ HH:MM")
      const pred = parsePredFromText(title || '', date);

      let predictedBg, peakTimeIso, source;

      if (pred) {
        // Agent provided a real-time prediction — trust it, just ensure peak time is set.
        predictedBg = pred.bg;
        peakTimeIso = pred.peakIso || new Date(mealTime.getTime() + getTTPMinutes(title) * 60 * 1000).toISOString();
        source = 'from title (agent)';
      } else {
        // ── Fallback formula (model v3) ──
        //
        // Layer 1: carb factor (Metformin-adjusted, preBG-anchored)
        // Layer 2: meal-type intercept (dawn phenomenon, Metformin timing)
        // Layer 3: preBG dampener (ceiling resistance when already elevated)
        // Layer 4: cumulative meal preBG anchor (use first-meal preBG, not mid-digestion BG)
        const type = getMealType(title);
        const intercept = MEAL_INTERCEPTS[type] ?? 0;

        // Layer 4: resolve anchor preBG (cumulative meals look back to first item)
        const rawPreBg = resolveAnchorPreBg(page, allPages);
        const preBg = rawPreBg ?? 115; // 115 = Maria's typical pre-meal fallback

        const factor = getCarbFactor(carbsForCalc);

        predictedBg = Math.min(
          Math.round(preBg + carbsForCalc * factor + intercept),
          300
        );

        const ttpMin = getTTPMinutes(title);
        peakTimeIso = new Date(mealTime.getTime() + ttpMin * 60 * 1000).toISOString();
        source = `formula v3 (preBG=${preBg} + ${carbsForCalc}g×${factor} + intercept=${intercept}, ttp=${ttpMin}min)`;
      }

      console.log(`Projection for '${title?.substring(0, 60)}': ${predictedBg} mg/dL [${source}]`);

      await patchJson(page.id, {
        'Predicted Peak BG': { number: predictedBg },
        'Predicted Peak Time': { date: { start: peakTimeIso } }
      });
    }
  }
  console.log('Projections Audit Complete.');
}
run();
