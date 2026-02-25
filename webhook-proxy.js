const http = require('http');

const PROXY_PORT = 18790;
const GATEWAY_PORT = 18789;

const server = http.createServer((client_req, client_res) => {
  let body = '';
  client_req.on('data', chunk => { body += chunk; });
  client_req.on('end', () => {
    console.log(`[${new Date().toISOString()}] ${client_req.method} ${client_req.url}`);
    console.log(`Headers: ${JSON.stringify(client_req.headers, null, 2)}`);
    console.log(`Body: ${body}`);

    const options = {
      hostname: '127.0.0.1',
      port: GATEWAY_PORT,
      path: client_req.url,
      method: client_req.method,
      headers: {
          ...client_req.headers,
          'host': `localhost:${GATEWAY_PORT}`,
          'x-forwarded-for': client_req.socket.remoteAddress
      }
    };

    const proxy = http.request(options, (res) => {
      console.log(`Response from Gateway: ${res.statusCode}`);
      client_res.writeHead(res.statusCode, res.headers);
      res.pipe(client_res, { end: true });
    });

    proxy.on('error', (err) => {
      console.error('Proxy Error:', err.message);
      client_res.writeHead(502);
      client_res.end('Gateway Unreachable');
    });

    proxy.write(body);
    proxy.end();
  });
});

console.log(`OpenClaw VPN Proxy (VERBOSE) starting on port ${PROXY_PORT}...`);
console.log(`Forwarding to localhost:${GATEWAY_PORT}`);
server.listen(PROXY_PORT, '0.0.0.0');
