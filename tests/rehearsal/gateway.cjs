'use strict';
// Kong-equivalent gateway for the disposable stack (127.0.0.1:55450). As in Supabase's kong.yml: an apikey (anon or
// service_role) is required except on the open auth endpoints emailed links hit, and /storage/v1 has no key-auth
// (storage-api checks JWTs and signed-URL tokens itself).
const http = require('http');
const { secrets, PORTS } = require('./env.cjs');
const S = secrets();
const ROUTES = [['/auth/v1', PORTS.auth], ['/rest/v1', PORTS.rest], ['/storage/v1', PORTS.storage]];
const OPEN = ['/auth/v1/verify', '/auth/v1/callback', '/auth/v1/authorize', '/auth/v1/health'];
const KEYS = new Set([S.anon_key, S.service_key]);
http.createServer((req, res) => {
  const route = ROUTES.find(([p]) => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'));
  if (!route) { res.writeHead(404); return res.end('{"message":"no route"}'); }
  const path = req.url.split('?')[0];
  if (!path.startsWith('/storage/v1/') && !OPEN.includes(path) && !KEYS.has(req.headers.apikey)) {
    res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"message":"Invalid API key"}');
  }
  const p = http.request({ host: '127.0.0.1', port: route[1], path: req.url.slice(route[0].length) || '/', method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:' + route[1], 'x-forwarded-for': req.socket.remoteAddress } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p);
}).listen(PORTS.gateway, '127.0.0.1', () => console.log('gateway on http://127.0.0.1:' + PORTS.gateway));
