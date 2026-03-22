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

// Parse prediction from health_log.md title text embedded in Notion entry.
// Returns { bg, peakIso } if found, otherwise null.
function parsePredFromText(text, dateStr) {
  const match = text.match(/\(Pred:\s*([^@)]+?)\s*@\s*([^)]+)\)/i);
  if (!match) return null;

  const bgNums = match[1].match(/\d+/g);
  if (!bgNums) return null;
  const bg = Math.min(parseInt(bgNums[bgNums.length - 1]), 300);

  let peakIso = null;
  if (dateStr) {
    const timeMatches = [...match[2].matchAll(/(\d{1,2}:\d{2})\s*(AM|PM)/gi)];
    if (timeMatches.length > 0) {
      const mins = timeMatches.map(t => {
        const [h, m] = t[1].split(':').map(Number);
        return (h % 12 + (t[2].toUpperCase() === 'PM' ? 12 : 0)) * 60 + m;
      });
      const avg = Math.round(mins.reduce((a, b) => a + b) / mins.length);
      peakIso = `${dateStr}T${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}:00`;
    }
  }

  return { bg, peakIso };
}

async function run() {
  console.log('Starting Projections Audit...');

  // Retroactive window: last 7 days in America/Los_Angeles business context
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

      // Use agent's context-aware prediction from title if present,
      // fall back to formula 120 + carbs*3.5 capped at 300.
      const pred = parsePredFromText(title || '', date?.substring(0, 10));
      const predictedBg = pred ? pred.bg : Math.min(Math.round(120 + (carbsForCalc * 3.5)), 300);
      const peakTime = pred?.peakIso
        ? new Date(pred.peakIso)
        : new Date(mealTime.getTime() + 105 * 60 * 1000);

      const source = pred ? 'from title' : `formula (${carbsForCalc}g carbs)`;
      console.log(`Projection for '${title?.substring(0, 60)}': ${predictedBg} mg/dL [${source}]`);

      await patchJson(page.id, {
        'Predicted Peak BG': { number: predictedBg },
        'Predicted Peak Time': { date: { start: peakTime.toISOString() } }
      });
    }
  }
  console.log('Projections Audit Complete.');
}
run();
