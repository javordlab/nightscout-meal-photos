const https = require('https');
const fs = require('fs');

const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';
const GROUP_ID = '-5262020908';
const MARIA_ID = '8738167445';
const LAST_CHECK_FILE = '/Users/javier/.openclaw/workspace/last_telegram_check.json';

function getUpdates() {
  let url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk;
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
    console.log(JSON.stringify({ error: json }, null, 2));
    process.exit(1);
  }

  // Get ALL messages from group -5262020908 and from Maria (8738167445)
  const allMessages = json.result
    .filter(update => {
      const msg = update.message || update.channel_post || update.edited_message;
      if (!msg) return false;
      const chatId = msg.chat?.id?.toString();
      const fromId = msg.from?.id?.toString();
      return chatId === GROUP_ID && fromId === MARIA_ID;
    })
    .map(update => {
      const msg = update.message || update.channel_post || update.edited_message;
      return {
        update_id: update.update_id,
        message_id: msg.message_id,
        date: msg.date,
        date_iso: new Date(msg.date * 1000).toISOString(),
        is_new: msg.date > lastCheck,
        text: msg.text || msg.caption || '(no text)',
        from: msg.from?.first_name + ' ' + msg.from?.last_name,
        photo: msg.photo ? true : false
      };
    });

  // Filter only new messages
  const newMessages = allMessages.filter(m => m.is_new);

  console.log(JSON.stringify({
    last_check_unix: lastCheck,
    last_check_iso: lastCheck > 0 ? new Date(lastCheck * 1000).toISOString() : null,
    current_time: new Date().toISOString(),
    total_maria_messages: allMessages.length,
    new_messages_count: newMessages.length,
    new_messages: newMessages,
    recent_all: allMessages.slice(-5)
  }, null, 2));
}

main().catch(console.error);
