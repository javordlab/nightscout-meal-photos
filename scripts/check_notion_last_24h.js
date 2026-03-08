const https = require('https');
const NOTION_KEY = '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';
const DATABASE_ID = '31685ec7-0668-813e-8b9e-c5b4d5d70fa5';

async function queryNotion() {
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

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

queryNotion().then(res => {
    if (res.results) {
        res.results.forEach(page => {
            const props = page.properties;
            const entry = props.Entry.title[0]?.plain_text || "Untitled";
            const date = props.Date.date?.start || "No Date";
            console.log(`[${date}] ${entry}`);
        });
    } else {
        console.log("No results or error:", res);
    }
}).catch(console.error);
