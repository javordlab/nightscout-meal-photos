const fs = require('fs');
const https = require('https');

const NOTION_KEY = "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";
const DATABASE_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const LOG_PATH = "/Users/javier/.openclaw/workspace/health_log.md";

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

async function run() {
  console.log('Fetching Notion entries for prediction sync...');
  const response = await postJson(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: 'Category', select: { equals: 'Food' } },
        { property: 'Date', date: { on_or_after: '2026-03-15' } }
      ]
    }
  });

  let logContent = fs.readFileSync(LOG_PATH, 'utf8');
  let updated = false;

  for (const page of response.results) {
    const props = page.properties;
    const title = props.Entry.title[0]?.plain_text;
    const dateStr = props.Date.date.start.split('T')[0];
    const timeStr = props.Date.date.start.split('T')[1].substring(0, 5);
    const predBg = props['Predicted Peak BG']?.number;
    const predTime = props['Predicted Peak Time']?.date?.start;

    if (predBg && predTime) {
      const pTime = new Date(predTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
      const predTag = `(Pred: ${predBg} mg/dL @ ${pTime})`;
      
      // Find the line in health_log.md
      // Regex: | date | time ... | title ... |
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lineRegex = new RegExp(`(\\| ${dateStr} \\| ${timeStr} [^|]+\\| [^|]+\\| [^|]+\\| )([^|]*${escapedTitle}[^|]*)(\\|)`, 'g');
      
      if (lineRegex.test(logContent)) {
          const match = logContent.match(lineRegex)[0];
          if (!match.includes('Pred:')) {
              console.log(`Adding prediction to: ${title}`);
              logContent = logContent.replace(lineRegex, `$1$2 ${predTag} $3`);
              updated = true;
          }
      }
    }
  }

  if (updated) {
    fs.writeFileSync(LOG_PATH, logContent);
    console.log('health_log.md updated with predictions.');
  } else {
    console.log('No updates needed for health_log.md.');
  }
}
run();
