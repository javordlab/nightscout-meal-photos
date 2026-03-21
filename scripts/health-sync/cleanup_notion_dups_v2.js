const { Client } = require("@notionhq/client");

const notion = new Client({
  auth: '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',
});

const DB_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function cleanup() {
  console.log('🧹 Fetching entries for cleanup using official SDK...');
  const res = await notion.databases.query({
    database_id: DB_ID,
    page_size: 100,
    filter: {
      property: 'Date',
      date: {
        on_or_after: '2026-03-19',
      },
    },
  });

  const entries = res.results;
  console.log(`Found ${entries.length} potential entries.`);

  const seen = new Map();
  const toArchive = [];

  for (const page of entries) {
    const title = page.properties?.Entry?.title?.[0]?.plain_text || 'Untitled';
    const date = page.properties?.Date?.date?.start;
    const key = `${date}|${title}`;

    if (seen.has(key)) {
      const existing = seen.get(key);
      const existingScore = (existing.properties?.Photo?.url ? 1 : 0) + (existing.properties?.['Carbs (est)']?.number ? 1 : 0);
      const currentScore = (page.properties?.Photo?.url ? 1 : 0) + (page.properties?.['Carbs (est)']?.number ? 1 : 0);

      if (currentScore > existingScore) {
        toArchive.push(existing.id);
        seen.set(key, page);
      } else {
        toArchive.push(page.id);
      }
    } else {
      seen.set(key, page);
    }
  }

  console.log(`Identified ${toArchive.length} duplicates to archive.`);

  for (const id of toArchive) {
    console.log(`Archiving: ${id}`);
    await notion.pages.update({
      page_id: id,
      archived: true,
    });
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('✅ Cleanup finished.');
}

cleanup().catch(console.error);
