const https = require('https');

const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';
const GROUP_ID = '-5262020908';
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

function getGroupMessages() {
  // For group chat, we can't use getChatHistory directly via HTTP
  // But we can check recent updates and filter by chat_id
  return getUpdates();
}

getGroupMessages().then(json => {
  if (!json.ok) {
    console.log('Error:', json);
    return;
  }
  
  // Filter messages from group -5262020908 and from Maria (8738167445)
  const messages = json.result
    .filter(update => {
      const msg = update.message || update.channel_post || update.edited_message;
      if (!msg) return false;
      const chatId = msg.chat?.id;
      const fromId = msg.from?.id;
      return chatId == GROUP_ID || (chatId?.toString() === GROUP_ID);
    })
    .map(update => {
      const msg = update.message || update.channel_post || update.edited_message;
      return {
        update_id: update.update_id,
        message_id: msg.message_id,
        date: msg.date,
        from: msg.from,
        text: msg.text,
        caption: msg.caption,
        photo: msg.photo,
        document: msg.document
      };
    });
  
  console.log(JSON.stringify({
    count: messages.length,
    last_update_id: json.result.length > 0 ? json.result[json.result.length - 1].update_id : null,
    messages: messages
  }, null, 2));
}).catch(console.error);
