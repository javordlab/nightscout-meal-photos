const fs = require('fs');
const https = require('https');

const NOTION_KEY = "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";
const NOTION_DB_ID = "31685ec7-0668-813e-8b9e-c5b4d5d70fa5";
const OUTPUT_PATH = "/Users/javier/.openclaw/workspace/nightscout-meal-photos/data/notion_meals.json";

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

async function main() {
  console.log("Querying Notion for gallery data...");
  let meals = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const res = await notionRequest("POST", `/databases/${NOTION_DB_ID}/query`, {
      filter: {
        and: [
          { property: "Category", select: { equals: "Food" } },
          { property: "Photo", url: { is_not_empty: true } }
        ]
      },
      sorts: [{ property: "Date", direction: "descending" }],
      start_cursor: cursor
    });

    if (!res.results) {
      console.error("Failed to query Notion:", res);
      break;
    }

    const pageMeals = res.results.map(page => {
      const p = page.properties;
      return {
        id: page.id,
        title: p.Entry.title[0]?.plain_text || "Untitled",
        type: p["Meal Type"]?.select?.name || "Food",
        date: p.Date.date.start,
        photo: p.Photo.url,
        carbs: p["Carbs (est)"]?.number,
        cals: p["Calories (est)"]?.number,
        delta: p["BG Delta"]?.number,
        peak: p["2hr Peak BG"]?.number
      };
    });

    meals = meals.concat(pageMeals);
    hasMore = res.has_more;
    cursor = res.next_cursor;
    console.log(`Fetched ${meals.length} meals so far...`);
  }

  // Deduplicate by photo URL (not photo + date, as timezone offsets may differ)
  const seen = new Set();
  const duplicates = [];
  
  const filteredMeals = meals.filter(meal => {
    // Deduplicate by photo URL only (same photo = same meal, even if timestamps differ slightly)
    if (seen.has(meal.photo)) {
      duplicates.push({ id: meal.id, title: meal.title, date: meal.date, photo: meal.photo });
      return false;
    }
    seen.add(meal.photo);
    return true;
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(filteredMeals, null, 2));
  console.log(`Successfully wrote ${filteredMeals.length} meals to gallery data.`);
  
  if (duplicates.length > 0) {
    console.log(`\n⚠️  Found ${duplicates.length} duplicate entries in Notion:`);
    duplicates.forEach(d => console.log(`  - ${d.date}: ${d.title.substring(0, 50)}... (ID: ${d.id})`));
    
    // Save duplicates for cleanup
    fs.writeFileSync('/Users/javier/.openclaw/workspace/tmp/notion_duplicates.json', JSON.stringify(duplicates, null, 2));
    console.log(`\nDuplicate IDs saved to tmp/notion_duplicates.json`);
  }
}

main().then(() => {
  const { execSync } = require('child_process');
  try {
    execSync('node /Users/javier/.openclaw/workspace/scripts/health-sync/deploy_gh_pages.js', { stdio: 'inherit' });
  } catch (e) {
    console.error('gh-pages deploy failed:', e.message);
  }
}).catch(console.error);
