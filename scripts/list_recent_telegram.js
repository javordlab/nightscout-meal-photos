const https = require('https');

const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';

function getUpdates() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=50`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.error('Failed to parse response:', e);
        console.log('Raw response:', data);
      }
    });
  }).on('error', console.error);
}

getUpdates();
