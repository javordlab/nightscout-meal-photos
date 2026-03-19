const https = require('https');
const fs = require('fs');

const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';
const GROUP_ID = '-5262020908';
const MARIA_ID = '8738167445';
const LAST_CHECK_FILE = '/Users/javier/.openclaw/workspace/last_telegram_check.json';

function getUpdates(offset) {
  let url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100`;
  if (offset) url += `&offset=${offset}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  // Load last check timestamp
  let lastCheck = 0;
  try {
    const data = fs.readFileSync(LAST_CHECK_FILE, 'utf8');
    const parsed = JSON.parse(data);
    lastCheck = parsed.last_check || 0;
  } catch (e) {
    lastCheck = 0;
  }

  const json = await getUpdates();
  if (!json.ok) {
    console.log(JSON.stringify({ error: json }));
    process.exit(1);
  }

  // Filter messages from group -5262020908 and from Maria (8738167445)
  // Only messages after last check
  const messages = json.result
    .filter(update => {
      const msg = update.message || update.channel_post || update.edited_message;
      if (!msg) return false;
      const chatId = msg.chat?.id?.toString();
      const fromId = msg.from?.id?.toString();
      const msgDate = msg.date;
      return chatId === GROUP_ID && fromId === MARIA_ID && msgDate > lastCheck;
    })
    .map(update => {
      const msg = update.message || update.channel_post || update.edited_message;
      return {
        update_id: update.update_id,
        message_id: msg.message_id,
        date: msg.date,
        date_iso: new Date(msg.date * 1000).toISOString(),
        text: msg.text || msg.caption || '(no text)',
        from: msg.from?.first_name + ' ' + msg.from?.last_name,
        photo: msg.photo ? msg.photo[msg.photo.length - 1].file_id : null
      };
    });

  // Save current timestamp as last check
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify({ last_check: now }, null, 2));

  console.log(JSON.stringify({
    count: messages.length,
    last_check: lastCheck,
    now: now,
    messages: messages
  }, null, 2));
}

main().catch(console.error);
