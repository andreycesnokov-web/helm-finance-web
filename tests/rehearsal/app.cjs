'use strict';
// The candidate backend on the disposable stack + the built client on one origin (127.0.0.1:55470; /api → 55460).
// Usage: node -r ./netguard.cjs app.cjs <on|off> [--forward-ip]   (commercial billing ON/OFF; forward client IP to Auth)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { ROOT, secrets, PORTS } = require('./env.cjs');
const S = secrets();
const billing = (process.argv[2] || 'off') === 'on';
Object.assign(process.env, {
  NODE_ENV: 'production', PORT: String(PORTS.api), SUPABASE_URL: 'http://127.0.0.1:' + PORTS.gateway, SUPABASE_SECRET_KEY: S.service_key,
  JWT_SECRET: S.app_jwt_secret, APP_BASE_URL: 'http://127.0.0.1:' + PORTS.app, CLIENT_URL: 'http://127.0.0.1:' + PORTS.app,
  EMAIL_AUTH_ENABLED: 'true', PASSWORD_AUTH_ENABLED: 'true', COMMERCIAL_BILLING_ENABLED: billing ? 'true' : 'false',
  AUTH_FORWARD_CLIENT_IP: process.argv.includes('--forward-ip') ? 'true' : 'false',
  PAYMENT_CONNECTIONS_ENABLED: 'false', INCOMING_PAYMENTS_ENABLED: 'false', DOCUMENT_OCR_VISION_ENABLED: 'false',
  DOCUMENT_CONTENT_CLASSIFICATION_ENABLED: 'false', BOT_TOKEN: '0000000000:rehearsal-synthetic-not-a-bot', TELEGRAM_WEBHOOK_SECRET: 'rehearsal-unused',
});
for (const k of ['ADMIN_TELEGRAM_IDS', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'OPENAI_API_KEY', 'EMAIL_PROVIDER', 'EMAIL_MAGIC_LINK_LOGIN_ENABLED', 'COMMERCIAL_BILLING_FIXTURES']) delete process.env[k];
process.chdir(ROOT);
require(path.join(ROOT, 'server', 'index.js'));
const DIST = path.join(ROOT, 'client', 'dist');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/mcp') || req.url.startsWith('/.well-known/')) {
    const p = http.request({ host: '127.0.0.1', port: PORTS.api, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  let f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(path.normalize(DIST)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(PORTS.app, '127.0.0.1', () => console.log(`[stand] billing=${billing} http://127.0.0.1:${PORTS.app}`));
