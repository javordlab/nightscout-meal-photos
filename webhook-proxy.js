const http = require('http');

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
      
      console.log(`Forwarding to Telegram: ${sleepMsg}`);
      
      // 1. Forward directly to Telegram so you see it in the group
      const tgReq = http.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (tgRes) => {
        let tgBody = '';
        tgRes.on('data', c => tgBody += c);
        tgRes.on('end', () => {
            console.log('Telegram response:', tgBody);
        });
      });
      
      tgReq.write(JSON.stringify({
        chat_id: CHAT_ID,
        text: `[iPhone Shortcut Sync]\n${sleepMsg}`
      }));
      tgReq.end();

      // 2. Also try to forward to Gateway for internal processing
      const gatewayReq = http.request({
        hostname: '127.0.0.1',
        port: GATEWAY_PORT,
        path: client_req.url,
        method: client_req.method,
        headers: {
            ...client_req.headers,
            'host': `localhost:${GATEWAY_PORT}`,
            'x-forwarded-for': client_req.socket.remoteAddress
        }
      }, (gwRes) => {
        client_res.writeHead(gwRes.statusCode, gwRes.headers);
        gwRes.pipe(client_res, { end: true });
      });

      gatewayReq.on('error', (e) => {
        console.error('Gateway Error:', e.message);
        client_res.writeHead(200); // Return 200 anyway since we did the TG sync
        client_res.end('Synced to Telegram only');
      });

      gatewayReq.write(body);
      gatewayReq.end();

    } catch (e) {
      console.error('Parse Error:', e.message);
      client_res.writeHead(400);
      client_res.end('Invalid JSON');
    }
  });
});

console.log(`OpenClaw VPN Proxy (TG-PASS) starting on port ${PROXY_PORT}...`);
server.listen(PROXY_PORT, '0.0.0.0');
