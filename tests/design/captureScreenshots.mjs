// Regenerate the PR review screenshots from the current source.
//
// Screenshots are the deliverable of a design PR, and stale ones are worse than
// none: they argue for code that no longer exists. This rebuilds the client with
// the preview flag on and re-shoots every image, so the set is always a picture of
// HEAD rather than of whatever was on screen the day someone dragged a window.
//
// Mobile needs care. Chrome clamps a top-level window to 512 CSS px, so
// `--window-size=390` produces a 512px layout cropped to 390px — which looks like
// a broken phone layout and is not one. Real 390px rendering comes from an iframe,
// which gets its own viewport; the image is then cropped back to 390 wide.
//
// Run: node tests/design/captureScreenshots.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'client', 'dist');
const OUT = path.join(ROOT, 'artifacts', 'design-pr80');

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });

if (!CHROME) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(1);
}

console.log('building client with VITE_DESIGN_PREVIEW_ENABLED=true');
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  // Node refuses to spawn a .cmd without a shell on Windows.
  shell: process.platform === 'win32',
  cwd: path.join(ROOT, 'client'), encoding: 'utf8',
  env: { ...process.env, VITE_DESIGN_PREVIEW_ENABLED: 'true' },
});
assert.strictEqual(build.status, 0, 'build failed:\n' + (build.stderr || '').slice(-2000));

fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.resolve(path.join(DIST, url));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// Async, because the server lives in this process: a blocking spawn would leave
// Chrome waiting for a page this process is too busy to serve.
const run = (args) => new Promise((resolve, reject) => {
  const c = spawn(CHROME, args);
  let err = '';
  c.stderr.on('data', (d) => { err += d; });
  const kill = setTimeout(() => { c.kill(); reject(new Error('chrome timed out')); }, 90000);
  c.on('error', reject);
  c.on('close', () => { clearTimeout(kill); resolve(err); });
});

const shoot = (file, url, w, h) => run([
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--window-size=${w},${h}`, '--virtual-time-budget=15000',
  `--screenshot=${file}`, url,
]);

/* ── PNG crop, so a mobile image is really 390 wide ────────────────────────── */
const crop = (inp, outp, cw, ch) => {
  const buf = fs.readFileSync(inp);
  let pos = 8; const chunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    chunks.push({ type: buf.toString('ascii', pos + 4, pos + 8), data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  assert.ok(ihdr[8] === 8 && ihdr[12] === 0 && (ihdr[9] === 2 || ihdr[9] === 6), 'unsupported png');
  const bpp = ihdr[9] === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const px = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (ft === 1) v += a; else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1; else if (ft === 4) v += paeth(a, b, c);
      cur[i] = v & 0xff;
    }
  }
  const nw = Math.min(cw, w), nh = Math.min(ch, h), ns = nw * bpp;
  const out = Buffer.alloc(nh * (ns + 1));
  for (let y = 0; y < nh; y++) px.copy(out, y * (ns + 1) + 1, y * stride, y * stride + ns);
  const crc32 = (b) => { let c = ~0;
    for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, cr]);
  };
  const nih = Buffer.from(ihdr); nih.writeUInt32BE(nw, 0); nih.writeUInt32BE(nh, 4);
  fs.writeFileSync(outp, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', nih), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
};

const DESKTOP = [
  ['01-pulse-desktop-1440x900.png', 'pulse', 1440, 900],
  ['02-accounts-desktop-1440x900.png', 'accounts', 1440, 900],
  ['05-page-hero-watermark-closeup.png', 'watermark', 1440, 620],
  ['06-semantic-colour-states.png', 'semantic', 1440, 900],
  ['07-long-content-wrapping.png', 'wrapping', 1440, 620],
  ['08-buttons-and-focus.png', 'focus', 1440, 520],
];
const MOBILE = [
  ['03-pulse-mobile-390x844.png', 'pulse'],
  ['04-accounts-mobile-390x844.png', 'accounts'],
];

for (const [file, only, w, h] of DESKTOP) {
  await shoot(path.join(OUT, file), `${origin}/design-preview?only=${only}`, w, h);
  console.log('  ' + file);
}

const tmpShot = path.join(DIST, '__shot.png');
for (const [file, only] of MOBILE) {
  // The iframe is the viewport; 512 is the narrowest window Chrome will honour.
  const harness = path.join(DIST, `__m-${only}.html`);
  fs.writeFileSync(harness, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#F4F6F8;overflow:hidden}
iframe{width:390px;height:844px;border:0;display:block}</style>
<body><iframe src="/design-preview?only=${only}"></iframe></body>`);
  await shoot(tmpShot, `${origin}/__m-${only}.html`, 512, 844);
  crop(tmpShot, path.join(OUT, file), 390, 844);
  fs.unlinkSync(harness);
  console.log('  ' + file);
}
fs.existsSync(tmpShot) && fs.unlinkSync(tmpShot);

/* ── every image must be real, and none may be a duplicate ─────────────────── */
const seen = new Map();
let bad = 0;
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort()) {
  const p = path.join(OUT, f);
  const b = fs.readFileSync(p);
  const ihdr = b.subarray(16, 24);
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  // A blank capture compresses to almost nothing; a real page never does.
  const blank = b.length < 8000;
  const dup = seen.get(b.length);
  seen.set(b.length, f);
  const note = blank ? 'BLANK?' : dup ? `DUPLICATE of ${dup}` : 'ok';
  if (blank || dup) bad++;
  console.log(`  ${f}  ${w}x${h}  ${(b.length / 1024).toFixed(0)}KB  ${note}`);
}

server.close();
console.log(bad ? `\n${bad} suspect image(s)` : '\nall screenshots look real and distinct');
process.exit(bad ? 1 : 0);
