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
 * Empirical carb-to-rise factors derived from 3-week prediction vs actual analysis
 * (2026-03-12 to 2026-04-02, n=57 meals with matched outcomes).
 *
 * Key findings:
 *   - Maria is on Metformin, which flattens post-prandial response on larger meals.
 *   - BG rise per gram drops sharply at higher carb loads.
 *   - Using a flat factor of 3.5 overestimates by ~24 mg/dL (75% overshoot rate).
 *   - Best-fit MAE by carb range:
 *       0-15g: factor 2.0  (avg actual rise 25 mg/dL)
 *      16-30g: factor 1.3  (avg actual rise 38 mg/dL)
 *      31-50g: factor 1.2  (avg actual rise 44 mg/dL)
 *        51+g: factor 0.8  (Metformin strongly blunts large loads)
 *
 * All predictions MUST anchor to preBG, never flat 120.
 * If preBG unknown, fall back to 115 (Maria typical pre-meal average).
 */
const CARB_FACTORS = [
  { maxCarbs: 15,       factor: 2.0 },
  { maxCarbs: 30,       factor: 1.3 },
  { maxCarbs: 50,       factor: 1.2 },
  { maxCarbs: Infinity, factor: 0.8 },
];

/**
 * Empirical time-to-peak defaults by meal type (57-meal analysis medians):
 *   Breakfast: 87 min  (morning insulin sensitivity, fastest)
 *   Dinner:    76 min  (often post-activity, faster absorption)
 *   Lunch:    113 min
 *   Snack:    126 min  (small bolus, slowest peak)
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

function getCarbFactor(carbs) {
  for (const { maxCarbs, factor } of CARB_FACTORS) {
    if (carbs <= maxCarbs) return factor;
  }
  return 0.8;
}

function getTTPMinutes(title) {
  const lower = (title || '').toLowerCase();
  for (const [type, mins] of Object.entries(TTP_DEFAULTS_MIN)) {
    if (type !== 'default' && lower.startsWith(type)) return mins;
  }
  return TTP_DEFAULTS_MIN.default;
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
  console.log('Starting Projections Audit...');

  // Retroactive window: last 7 days in local (host) timezone context
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const onOrAfter = sevenDaysAgo.toISOString().slice(0, 10);

  const response = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: 'Category', select: { equals: 'Food' } },
        { property: 'Date', date: { on_or_after: onOrAfter } }
      ]
    }
  });

  if (!response.results) {
    console.error('Failed to fetch data:', response);
    return;
  }

  for (const page of response.results) {
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
        predictedBg = pred.bg;
        peakTimeIso = pred.peakIso || new Date(mealTime.getTime() + getTTPMinutes(title) * 60 * 1000).toISOString();
        source = 'from title (agent)';
      } else {
        // Fallback: preBG-anchored with empirical Metformin-adjusted carb factors.
        // Never use flat 120 as baseline — anchor to actual preBG.
        const preBg = props['Pre-Meal BG']?.number || 115;
        const factor = getCarbFactor(carbsForCalc);
        predictedBg = Math.min(Math.round(preBg + carbsForCalc * factor), 300);
        const ttpMin = getTTPMinutes(title);
        peakTimeIso = new Date(mealTime.getTime() + ttpMin * 60 * 1000).toISOString();
        source = `formula (preBG=${preBg} + ${carbsForCalc}g x${factor}, ttp=${ttpMin}min)`;
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
