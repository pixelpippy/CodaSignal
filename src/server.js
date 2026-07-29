// src/server.js
const http = require('node:http');

function startServer(port, onEvent) {
  const p = port || 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (typeof onEvent === 'function') onEvent(data.event, data);
        } catch {
          // 忽略坏请求，仍回 200，避免守护进程崩溃
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(p, '127.0.0.1', () => resolve(server)));
}

module.exports = { startServer };
