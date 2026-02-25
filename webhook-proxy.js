const http = require('http');
const https = require('https');

const PROXY_PORT = 18790;
const GATEWAY_PORT = 18789;
const BOT_TOKEN = '8262629923:AAEdW0HWJN1Y-R32ekvghqrg5bnQydMeop0';
const CHAT_ID = -5262020908;

const server = http.createServer((client_req, client_res) => {
  let body = '';
  client_req.on('data', chunk => { body += chunk; });
  client_req.on('end', () => {
    console.log(`[${new Date().toISOString()}] Received ${client_req.method} ${client_req.url}`);
    
    try {
      const data = JSON.parse(body);
      const sleepMsg = data.message || 'New sleep record received via proxy';
      
      console.log(`Forwarding to Telegram (HTTPS): ${sleepMsg}`);
      
      const tgPayload = JSON.stringify({
        chat_id: CHAT_ID,
        text: `[iPhone Shortcut Sync]\n${sleepMsg}`
      });

      const tgReq = https.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(tgPayload)
        }
      }, (tgRes) => {
        let tgBody = '';
        tgRes.on('data', c => tgBody += c);
        tgRes.on('end', () => {
            console.log('Telegram response:', tgBody);
            // Return 200 to the iPhone Shortcut regardless of gateway status
            client_res.writeHead(200, { 'Content-Type': 'application/json' });
            client_res.end(JSON.stringify({ status: "success", delivered: "telegram" }));
        });
      });
      
      tgReq.on('error', (e) => {
        console.error('Telegram Request Error:', e.message);
        client_res.writeHead(500);
        client_res.end('Telegram Delivery Failed');
      });

      tgReq.write(tgPayload);
      tgReq.end();

    } catch (e) {
      console.error('Parse Error:', e.message);
      client_res.writeHead(400);
      client_res.end('Invalid JSON');
    }
  });
});

console.log(`OpenClaw VPN Proxy (FINAL FIX) starting on port ${PROXY_PORT}...`);
server.listen(PROXY_PORT, '0.0.0.0');
