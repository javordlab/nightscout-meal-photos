const { Client } = require('@notionhq/client');

async function sync() {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  const databaseId = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

  const response = await notion.databases.query({
    database_id: databaseId,
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: 50
  });

  const existingEntries = response.results.map(page => {
    const props = page.properties;
    return {
      date: props.Date?.date?.start,
      entry: props.Entry?.title?.[0]?.plain_text,
    };
  });

  console.log(JSON.stringify(existingEntries, null, 2));
}

sync().catch(err => {
  console.error(err);
  process.exit(1);
});
