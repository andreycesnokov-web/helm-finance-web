// Regenerate the PR review screenshots from the current source.
//
// Screenshots are the deliverable of a design PR, and stale ones are worse than
// none: they argue for code that no longer exists. This rebuilds the client with
// the preview flag on and re-shoots every image, so the set is always a picture of
// HEAD rather than of whatever was on screen the day someone dragged a window.
//
// Two traps this script exists to close:
//
// 1. Fonts. A capture taken mid-swap records the fallback face, and a heading set
//    in the fallback reads as a design regression that was never in the code.
//    Every shot is font-verified first — document.fonts.ready has resolved, the
//    status is "loaded", and each required family answers document.fonts.check —
//    and the script STOPS rather than writing an image it cannot vouch for.
//
// 2. Viewport. Chrome clamps a top-level window to 512 CSS px, so
//    `--window-size=390` produces a 512px layout cropped to 390 — which looks
//    exactly like a broken phone layout and is not one. Every shot is framed in an
//    iframe of the exact target size and the verification pass asserts the
//    iframe's innerWidth, so a mobile image can never silently become a crop.
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

// Which face each kind of content is supposed to render in. The check is done
// against what the page ACTUALLY renders — sample an element, read its computed
// family/weight/size, and ask document.fonts whether that exact face is loaded.
// A fixed global list would fail honestly-font-free sections and, worse, would
// still pass a page whose heading had quietly fallen back to a system face.
// `expect` is a pattern string, not a RegExp: these travel into the page as JSON,
// and JSON.stringify flattens a RegExp to {}.
const FONT_SAMPLES = [
  { sel: 'h1, .dsp-title', expect: 'Archivo Black', role: 'display' },
  // .cfo-summary-value is only the container — the figure inside it carries .fin,
  // so sampling the container reads the display face and reports a false miss.
  { sel: '.fin, .pulse-cash-value, .pulse-kpi-value', expect: 'JetBrains Mono', role: 'figures' },
  { sel: '.cfo-pagehead-desc, .cfo-summary-label, .pulse-kpi-label', expect: 'Manrope', role: 'text' },
];

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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json' };
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
  let out = '', err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  const kill = setTimeout(() => { c.kill(); reject(new Error('chrome timed out')); }, 90000);
  c.on('error', reject);
  c.on('close', () => { clearTimeout(kill); resolve({ out, err }); });
});

/* ── the harness every shot is framed in ───────────────────────────────────── */
// The iframe *is* the viewport, which is the only way to get a true 390px layout.
// `focus` drives a real keyboard focus so :focus-visible engages for the capture.
const harnessFor = (route, w, h, focus, click) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#F4F6F8;overflow:hidden}
iframe{width:${w}px;height:${h}px;border:0;display:block}</style>
<body><iframe id="f" src="${route}"></iframe>
<script>
const SAMPLES = ${JSON.stringify(FONT_SAMPLES)};
const fr = document.getElementById('f');
setTimeout(async () => {
  const report = (o) => document.body.insertAdjacentHTML('beforeend',
    '<div>__FONTS__' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))) + '__END__</div>');
  try {
    const cw = fr.contentWindow, d = cw.document;
    await d.fonts.ready;
    ${click ? `
    // Drive the real control rather than forcing state: the drawer in the picture
    // is the drawer a thumb opens.
    const opener = d.querySelector(${JSON.stringify(click)});
    if (opener) { opener.click(); await new Promise((r) => setTimeout(r, 400)); }` : ''}
    ${focus ? `
    // A real keyboard focus, not a class that imitates one: :focus-visible only
    // engages for keyboard-ish interaction, so the ring in the image is the ring
    // a keyboard user actually sees.
    const target = d.querySelector(${JSON.stringify(focus)});
    if (target) {
      target.dispatchEvent(new cw.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      target.focus();
    }` : ''}
    // For every kind of content this page actually renders, prove the face it is
    // painted with is loaded — not merely requested, and not a fallback.
    const faces = [];
    const missing = [];
    for (const smp of SAMPLES) {
      const el = d.querySelector(smp.sel);
      if (!el) continue;
      const cst = cw.getComputedStyle(el);
      const family = cst.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const spec = cst.fontWeight + ' ' + cst.fontSize + ' "' + family + '"';
      const ok = d.fonts.check(spec);
      faces.push({ role: smp.role, family: family, weight: cst.fontWeight, loaded: ok });
      if (!ok) missing.push(smp.role + ' -> ' + spec + ' not loaded');
      if (!new RegExp(smp.expect).test(family)) {
        missing.push(smp.role + ' -> rendering in ' + family + ', expected ' + smp.expect);
      }
    }
    const h1 = d.querySelector('h1');
    const st = h1 ? cw.getComputedStyle(h1) : null;
    ${focus ? `const t2 = d.querySelector(${JSON.stringify(focus)});` : ''}
    report({
      status: d.fonts.status,
      loaded: d.fonts.size,
      missing: missing,
      faces: faces,
      innerWidth: cw.innerWidth,
      h1Family: st ? st.fontFamily.split(',')[0].replace(/"/g, '') : null,
      h1Weight: st ? st.fontWeight : null,
      focusVisible: ${focus ? `!!(t2 && t2.matches(':focus-visible'))` : 'null'},
      clicked: ${click ? `!!d.querySelector(${JSON.stringify(click)})` : 'null'},
      focusOutline: ${focus ? `t2 ? cw.getComputedStyle(t2).outlineColor + ' ' + cw.getComputedStyle(t2).outlineWidth : null` : 'null'},
    });
  } catch (e) { report({ error: e.message }); }
}, 2500);
</script></body>`;

// Verify first, then photograph the identical page. No image is written for a
// page whose fonts and viewport could not be vouched for.
const verifyAndShoot = async (file, route, w, h, opts = {}) => {
  const { crop, focus, window: win, click, region } = opts;
  const name = `__cap-${Math.random().toString(36).slice(2)}.html`;
  fs.writeFileSync(path.join(DIST, name), harnessFor(route, w, h, focus, click));
  const url = `${origin}/${name}`;
  const winW = win ? win[0] : w, winH = win ? win[1] : h;
  const args = (extra) => ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', `--window-size=${winW},${winH}`, '--virtual-time-budget=20000', ...extra, url];
  try {
    const { out } = await run(args(['--dump-dom']));
    const m = out.match(/__FONTS__([A-Za-z0-9+/=]+)__END__/);
    assert.ok(m, `${file}: the page never reported font state`);
    const r = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    assert.ok(!r.error, `${file}: probe failed — ${r.error}`);
    assert.strictEqual(r.status, 'loaded', `${file}: document.fonts.status is "${r.status}", not "loaded"`);
    assert.deepStrictEqual(r.missing, [], `${file}: ${(r.missing || []).join(' | ')}`);
    assert.ok(r.faces.length > 0, `${file}: no sampled element to verify a font against`);
    assert.strictEqual(r.innerWidth, w, `${file}: viewport is ${r.innerWidth}px, expected ${w}px`);
    if (r.h1Family) assert.match(r.h1Family, /Archivo Black/, `${file}: h1 renders in ${r.h1Family}`);
    if (focus) assert.strictEqual(r.focusVisible, true, `${file}: ${focus} does not match :focus-visible`);
    if (click) assert.strictEqual(r.clicked, true, `${file}: ${click} was not found to click`);

    const needsCrop = crop || region;
    const raw = needsCrop ? path.join(DIST, '__shot.png') : path.join(OUT, file);
    await run(args([`--screenshot=${raw}`]));
    if (needsCrop) {
      const [rx, ry, rw, rh] = region || [0, 0, w, h];
      cropPng(raw, path.join(OUT, file), rw, rh, rx, ry);
      fs.unlinkSync(raw);
    }
    console.log(`  ${file}  viewport=${r.innerWidth}px `
      + r.faces.map((f) => `${f.role}:${f.family.split(' ')[0]}/${f.weight}`).join(' ')
      + (focus ? ` focus-visible ring=${r.focusOutline}` : ''));
  } finally { fs.unlinkSync(path.join(DIST, name)); }
};

/* ── PNG crop, so a mobile image is really 390 wide ────────────────────────── */
function cropPng(inp, outp, cw, ch, ox = 0, oy = 0) {
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
  const x0 = Math.max(0, Math.min(ox, w - 1)), y0 = Math.max(0, Math.min(oy, h - 1));
  const nw = Math.min(cw, w - x0), nh = Math.min(ch, h - y0), ns = nw * bpp;
  const out = Buffer.alloc(nh * (ns + 1));
  for (let y = 0; y < nh; y++) {
    const src = (y + y0) * stride + x0 * bpp;
    px.copy(out, y * (ns + 1) + 1, src, src + ns);
  }
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
}

/* ── the set ───────────────────────────────────────────────────────────────── */
const P = '/design-preview';
const PHONE = { crop: true, window: [512, 844] };

// Review order: the real application shell first, because that is what ships.
// Regions are in device pixels of the captured window and were read off the live
// DOM, not guessed — re-measure them if a surface's geometry changes.
const SHOTS = [
  ['01-pulse-app-shell-desktop-1440x900.png', `${P}?shell=pulse`, 1440, 900, {}],
  ['02-accounts-app-shell-desktop-1440x900.png', `${P}?shell=accounts`, 1440, 900, {}],
  ['03-pulse-app-shell-mobile-390x844.png', `${P}?shell=pulse`, 390, 844, PHONE],
  ['04-accounts-app-shell-mobile-390x844.png', `${P}?shell=accounts`, 390, 844, PHONE],
  // The two flagship cards at close range: one symbol each, cropped by the card
  // edge, with the reserved column between it and anything readable.
  ['05-pulse-total-cash-watermark-closeup.png', `${P}?shell=pulse`, 1440, 900,
    { region: [306, 142, 478, 275] }],
  ['06-accounts-total-balance-watermark-closeup.png', `${P}?shell=accounts`, 1440, 900,
    { region: [306, 124, 1116, 172] }],
  // The hero band and the card beneath it in one frame — the point is the
  // relationship between the two marks, so they have to be photographed together.
  ['07-page-hero-watermark-and-alignment.png', `${P}?shell=accounts`, 1440, 900,
    { region: [280, 0, 1160, 300] }],
  // Top of the real phone layout: the compact lockup and the burger.
  ['08-mobile-header-compact-lockup.png', `${P}?shell=pulse`, 390, 844,
    { crop: true, window: [512, 844], region: [0, 0, 390, 92] }],
  // The real drawer, opened by clicking the real burger.
  ['09-mobile-drawer-workspace-settings.png', `${P}?shell=pulse`, 390, 844,
    { crop: true, window: [512, 844], click: '.cfo-burger' }],
  ['10-long-title-and-description-wrapping.png', `${P}?only=wrapping`, 1440, 660, {}],
  ['11-semantic-colour-states.png', `${P}?only=semantic`, 1440, 900, {}],
  ['12-buttons-and-keyboard-focus.png', `${P}?only=focus`, 1440, 560, { focus: '.dsp-focus-target' }],
  // Tablet: the sidebar is gone, the hero mark is gone with it, and the flagship
  // card is full width. The in-between width is where layouts usually break.
  ['13-tablet-responsive-768.png', `${P}?shell=pulse`, 768, 1000, {}],
  // Bottom-left of the desktop shell: the settings footer in place under the nav.
  ['14-sidebar-workspace-settings-closeup.png', `${P}?shell=pulse`, 1440, 900,
    { region: [0, 560, 420, 340] }],
];

// Anything in the directory that this list no longer produces is a picture of code
// that no longer exists. Delete it before shooting, so the review folder is always
// exactly one set and a reviewer never compares against a stale frame.
const KEEP = new Set(SHOTS.map(([f]) => f));
for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith('.png'))) {
  if (!KEEP.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log(`  removed stale ${f}`); }
}

for (const [file, route, w, h, opts] of SHOTS) await verifyAndShoot(file, route, w, h, opts);

/* ── every image must be real, and none may be a duplicate ─────────────────── */
const seen = new Map();
let bad = 0;
console.log('');
for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith('.png')).sort()) {
  const b = fs.readFileSync(path.join(OUT, f));
  const ihdr = b.subarray(16, 24);
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  // Scaled to the frame, not a flat byte count: a full 1440x900 page that
  // compresses under ~13KB is blank, but a 390x92 crop of a mostly-white header
  // bar legitimately weighs 4KB, and a flat 8KB floor called that a failure.
  const blank = b.length < Math.max(1200, w * h * 0.01);
  const dup = seen.get(b.length);
  seen.set(b.length, f);
  if (blank || dup) bad++;
  console.log(`  ${f}  ${w}x${h}  ${(b.length / 1024).toFixed(0)}KB  ${blank ? 'BLANK?' : dup ? `DUPLICATE of ${dup}` : 'ok'}`);
}

server.close();
console.log(bad ? `\n${bad} suspect image(s)` : '\nall screenshots font-verified, real and distinct');
process.exit(bad ? 1 : 0);
