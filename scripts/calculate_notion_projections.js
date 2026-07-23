const https = require('https');
const { writeReceipt } = require('./health-sync/cron_receipt');

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
 * PREDICTION MODEL v5 (calibrated 2026-07-23 on 104 clean post-v4 meals,
 * prospective 2026-06-13→07-23; see docs/model_v5_calibration_2026-07-23.md;
 * supersedes v4 of 2026-06-12 n=145)
 *
 * Layer 1 — Carb factors (Metformin-adjusted, monotonically declining):
 *       0-15g: ×2.0   (unchanged)
 *      16-30g: ×1.2   (unchanged, prospective bias +1.4 — spot-on)
 *      31-50g: ×0.9   (unchanged, prospective bias +1.3 — spot-on)
 *        51+g: ×0.8   (was 0.7 — big meals under-predicted +14, implied 0.88)
 *
 * Layer 2 — Meal-type intercepts (additive, empirical):
 *   Breakfast: +20 mg/dL  (dawn phenomenon, was +25 — still over-predicting)
 *   Lunch:       0 mg/dL  (was −5; under-prediction now carried by protein term)
 *   Dinner:      0 mg/dL
 *   Snack:       0 mg/dL
 *   Dessert:   -10 mg/dL
 *
 * Layer 2b — Protein term (NEW in v5): + 0.3 × max(0, protein_g − 20).
 *   Protein-heavy meals (steak, squid, charcuterie, tuna) under-predicted by
 *   +15 on average (n=46 at 20g+); gluconeogenesis from large protein loads.
 *   Tied to the food, not the hour, so it generalizes across Spain/CA schedules.
 *
 * Layer 3 — preBG damping: − 0.35 × (preBG − 115). (unchanged — bands within ±10)
 *
 * Layer 4 — Cumulative meal preBG anchor (data quality fix):
 *   For cumulative meals, use the FIRST item's preBG in the meal session,
 *   not the live BG at time of logging subsequent items (which is mid-digestion).
 *
 * All predictions anchor to preBG. If unknown: fallback 115 mg/dL (Maria's typical
 * — note the damping term vanishes at exactly 115). Cap at 300 mg/dL.
 */
const CARB_FACTORS = [
  { maxCarbs: 15,       factor: 2.0 },
  { maxCarbs: 30,       factor: 1.2 },
  { maxCarbs: 50,       factor: 0.9 },
  { maxCarbs: Infinity, factor: 0.8 },
];

// Additive intercepts per meal type (dawn phenomenon, Metformin timing, etc.)
const MEAL_INTERCEPTS = {
  breakfast: 20,
  lunch:      0,
  dinner:     0,
  snack:      0,
  dessert:  -10,
};

// Protein term (model v5 Layer 2b)
const PROTEIN_COEF = 0.3;
const PROTEIN_THRESHOLD_G = 20;

// preBG damping (model v5 Layer 3)
const PREBG_DAMP_SLOPE = 0.35;
const PREBG_DAMP_CENTER = 115;

/**
 * Empirical time-to-peak defaults by meal type — n-weighted blend of the
 * 2026-06-12 medians and the 2026-07-23 prospective medians (peaks measured
 * from UTC peak_time; the stored time_to_peak_min column carried a TZ bug):
 *   Breakfast: 75 min  (was 87; new median 66 n=19)
 *   Lunch:     70 min  (was 75; new median 61 n=9)
 *   Dinner:    65 min  (was 55; new median 80 n=21 — Spain-period dinners later)
 *   Snack:     55 min  (was 60; new median 49 n=8)
 *   Dessert:  105 min  (was 95; new median 123 n=4)
 *   Default:   70 min  (overall median)
 */
const TTP_DEFAULTS_MIN = {
  breakfast: 75,
  lunch: 70,
  dinner: 65,
  snack: 55,
  dessert: 105,
  default: 70,
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
  console.log('Starting Projections Audit (model v5: intercepts + protein term + preBG damping + cumulative anchor)...');

  // Retroactive window: last 7 days in local (host) timezone context.
  // en-CA Intl gives YYYY-MM-DD in the HOST's local calendar — toISOString()
  // would yield the UTC date, which disagrees with Notion's local-offset dates
  // near midnight.
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const onOrAfter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(sevenDaysAgo);

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
    if (!res.results) {
      console.error('Failed to fetch data:', res);
      writeReceipt({
        status: 'error',
        summary: `Projections query failed: ${res.error || res.message || 'no results in Notion response'}`,
        metrics: { window: onOrAfter, queryFailed: true }
      });
      process.exitCode = 1;
      return;
    }
    allPages = allPages.concat(res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  console.log(`Fetched ${allPages.length} Food entries for window starting ${onOrAfter}`);

  let patched = 0;
  let failures = 0;

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
        // ── Fallback formula (model v5) ──
        //
        // Layer 1: carb factor (Metformin-adjusted, preBG-anchored)
        // Layer 2: meal-type intercept (dawn phenomenon, Metformin timing)
        // Layer 2b: protein term (+0.3 × grams above 20 — gluconeogenesis)
        // Layer 3: preBG damping (−0.35 × (preBG − 115))
        // Layer 4: cumulative meal preBG anchor (use first-meal preBG, not mid-digestion BG)
        const type = getMealType(title);
        const intercept = MEAL_INTERCEPTS[type] ?? 0;

        // Layer 4: resolve anchor preBG (cumulative meals look back to first item)
        const rawPreBg = resolveAnchorPreBg(page, allPages);
        const preBg = rawPreBg ?? 115; // 115 = Maria's typical pre-meal fallback

        const factor = getCarbFactor(carbsForCalc);
        // Protein from the title's "(Protein: ~18g" fragment — tilde-tolerant
        // (plain "Protein: 18g" also matches; see ff7f294f8 for the tilde bug).
        const proteinMatch = (title || '').match(/Protein:\s*~?(\d+(?:\.\d+)?)\s*g/i);
        const proteinG = proteinMatch ? Number(proteinMatch[1]) : 0;
        const proteinTerm = PROTEIN_COEF * Math.max(0, proteinG - PROTEIN_THRESHOLD_G);
        const damping = -PREBG_DAMP_SLOPE * (preBg - PREBG_DAMP_CENTER);

        predictedBg = Math.min(
          Math.round(preBg + carbsForCalc * factor + intercept + proteinTerm + damping),
          300
        );

        const ttpMin = getTTPMinutes(title);
        peakTimeIso = new Date(mealTime.getTime() + ttpMin * 60 * 1000).toISOString();
        source = `formula v5 (preBG=${preBg} + ${carbsForCalc}g×${factor} + intercept=${intercept} + prot=${proteinTerm.toFixed(1)} + damp=${damping.toFixed(1)}, ttp=${ttpMin}min)`;
      }

      console.log(`Projection for '${title?.substring(0, 60)}': ${predictedBg} mg/dL [${source}]`);

      const patchRes = await patchJson(page.id, {
        'Predicted Peak BG': { number: predictedBg },
        'Predicted Peak Time': { date: { start: peakTimeIso } }
      });
      if (patchRes.error || patchRes.object === 'error') {
        failures += 1;
        console.error(`  PATCH failed for '${title?.substring(0, 60)}': ${patchRes.error || patchRes.message || 'unknown Notion error'}`);
      } else {
        patched += 1;
      }
    }
  }

  console.log(`Projections Audit Complete. ${patched} patched, ${failures} failed.`);

  // Best-effort Notion mirror: partial failures shouldn't fail the cron run,
  // but a fully-failed run (every PATCH errored) means something is broken.
  let status = 'ok';
  if (failures > 0) {
    status = patched > 0 ? 'partial' : 'error';
  }
  writeReceipt({
    status,
    summary: `Projections: ${patched} patched, ${failures} failed (window ${onOrAfter}, ${allPages.length} entries)`,
    metrics: { window: onOrAfter, entries: allPages.length, patched, failures }
  });
  if (status === 'error') process.exitCode = 1;
}

run().catch((e) => {
  console.error('Projections audit crashed:', e.message);
  writeReceipt({
    status: 'error',
    summary: `Projections audit crashed: ${e.message}`,
    metrics: null
  });
  process.exitCode = 1;
});
