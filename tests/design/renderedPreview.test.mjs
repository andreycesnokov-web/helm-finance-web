// What the design foundation actually renders — asserted against a real browser.
//
// The structural checks live in designPreview.test.mjs. This file exists because
// most of PR #80's claims are claims about pixels: that a heading is an <h1>, that
// a button clears WCAG AA, that nothing overflows a 390px phone, that "+ Rp 0" is
// not green. None of that is decidable from source text, and every one of these
// assertions replaced a defect that source-reading had missed.
//
// It drives headless Chrome directly — no new dependency, no test framework. The
// page reports facts; the assertions live here.
//
// One trap is worth knowing about: Chrome clamps its layout viewport to 512 CSS px,
// so `--window-size=390` yields a 512px layout cropped to 390px in the image. That
// looks exactly like a broken mobile layout and is not one. Real 390px rendering
// comes from an iframe, which gets its own viewport, and the test asserts
// innerWidth === 390 so it can never silently drift back to the cropped kind.
//
// Run: node tests/design/renderedPreview.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'client', 'dist');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

/* ── chrome ────────────────────────────────────────────────────────────────── */
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = chromeCandidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });

if (!CHROME) {
  console.log('\nSKIPPED — no Chrome found. Set CHROME_PATH to run the rendered checks.');
  console.log('This suite did NOT run; do not read its silence as a pass.\n');
  process.exit(0);
}

/* ── the build under test ──────────────────────────────────────────────────── */
// The preview only exists in a build made with the flag on, so the test makes one
// rather than trusting whatever happens to be in dist.
const built = fs.existsSync(DIST) && fs.readdirSync(path.join(DIST, 'assets'))
  .some((f) => f.startsWith('DesignPreview-') && f.endsWith('.js'));
if (!built) {
  console.log('  .. building client with VITE_DESIGN_PREVIEW_ENABLED=true');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    // Node refuses to spawn a .cmd without a shell on Windows.
    shell: process.platform === 'win32',
    cwd: path.join(ROOT, 'client'), encoding: 'utf8',
    env: { ...process.env, VITE_DESIGN_PREVIEW_ENABLED: 'true' },
  });
  assert.strictEqual(r.status, 0, 'client build failed:\n' + (r.stderr || '').slice(-2000));
}

/* ── a static server with SPA fallback ─────────────────────────────────────── */
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
const PORT = server.address().port;
const origin = `http://127.0.0.1:${PORT}`;

/* ── run a probe in the page and get its facts back ────────────────────────── */
// --dump-dom escapes text, so the page hands back base64 between two markers.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-'));
// Async on purpose: the static server lives in this process, so a blocking
// spawnSync would stop the event loop and Chrome would wait forever for a reply
// that this process is too busy to send.
const collect = async (harnessHtml, ms = 12000) => {
  const name = `__probe-${Math.random().toString(36).slice(2)}.html`;
  fs.writeFileSync(path.join(DIST, name), harnessHtml);
  try {
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        `--virtual-time-budget=${ms}`, '--dump-dom', `${origin}/${name}`,
      ]);
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      const kill = setTimeout(() => { child.kill(); reject(new Error('chrome timed out')); }, 60000);
      child.on('error', reject);
      child.on('close', () => { clearTimeout(kill); resolve({ stdout: out, stderr: err }); });
    });
    const m = stdout.match(/<div>__FACTS__([A-Za-z0-9+/=]+)__END__<\/div>/);
    assert.ok(m, 'probe produced no facts. chrome stderr: ' + stderr.slice(-600));
    const facts = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    assert.ok(!facts.probeError, 'the probe threw inside the page: ' + facts.probeError);
    return facts;
  } finally { fs.unlinkSync(path.join(DIST, name)); }
};

// Shared probe body. `doc`/`win` are the document under test, so the same code
// serves both the direct desktop load and the 390px iframe.
const PROBE_FN = `function facts(win, doc) {
  const de = doc.documentElement;
  const cs = (el) => win.getComputedStyle(el);
  const lum = (c) => { const p = c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v => {
    v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
    return +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)); };

  const sections = {};
  doc.querySelectorAll('.dsp-section').forEach((s) => {
    const marks = s.querySelectorAll('.cfo-summary-sym, .pulse-cash-mark');
    sections[s.id] = {
      h1: s.querySelectorAll('h1').length,
      heroes: s.querySelectorAll('.cfo-summary, .pulse-cash').length,
      marks: marks.length,
      markAttrs: [...marks].map((m) => ({
        ariaHidden: m.getAttribute('aria-hidden'), alt: m.getAttribute('alt'),
        w: Math.round(m.getBoundingClientRect().width),
        opacity: cs(m).opacity, inHero: !!m.closest('.cfo-summary, .pulse-cash'),
      })),
    };
  });

  const overflow = [];
  doc.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > de.clientWidth + 1) overflow.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 48),
      right: Math.round(r.right),
    });
  });

  const btn = doc.querySelector('.cfo-btn-primary');
  const primary = btn ? { bg: cs(btn).backgroundColor, fg: cs(btn).color,
    ratio: ratio(cs(btn).backgroundColor, cs(btn).color) } : null;

  const kpiOf = (sectionId) => {
    const sec = doc.getElementById(sectionId);
    if (!sec) return null;
    const out = {};
    sec.querySelectorAll('.pulse-kpi').forEach((k) => {
      const label = (k.querySelector('.pulse-kpi-label') || {}).textContent || '';
      const v = k.querySelector('.pulse-kpi-value');
      if (v) out[label.trim().toLowerCase()] = { color: cs(v).color,
        text: v.textContent.trim(), font: cs(v).fontFamily.split(',')[0].replace(/"/g, ''),
        numeric: cs(v).fontVariantNumeric };
    });
    return out;
  };

  const ctx = doc.querySelector('.cfo-pagehead-context');
  const badges = ctx ? [...ctx.querySelectorAll('.cfo-badge')].map((b) =>
    Math.round(b.getBoundingClientRect().width)) : [];

  // Text is only clipped if the box actually hides it. A wrapped heading routinely
  // reports scrollHeight a pixel over clientHeight through rounding while overflow
  // is visible and every word is on screen.
  const wrapSec = doc.getElementById('wrapping');
  const clipped = [];
  if (wrapSec) wrapSec.querySelectorAll('h1, .cfo-pagehead-desc').forEach((el) => {
    const ov = cs(el);
    const hides = (v) => v === 'hidden' || v === 'clip' || v === 'auto' || v === 'scroll';
    if (hides(ov.overflowX) && el.scrollWidth > el.clientWidth + 2)
      clipped.push(el.tagName.toLowerCase() + ' x:' + el.scrollWidth + '>' + el.clientWidth);
    if (hides(ov.overflowY) && el.scrollHeight > el.clientHeight + 2)
      clipped.push(el.tagName.toLowerCase() + ' y:' + el.scrollHeight + '>' + el.clientHeight);
    if (ov.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2)
      clipped.push(el.tagName.toLowerCase() + ' ellipsised');
  });

  const res = win.performance.getEntriesByType('resource');
  const calls = res.filter((e) => e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch')
    .map((e) => e.name);
  const suspicious = res.map((e) => e.name).filter((n) => /supabase|\\/api\\/|amazonaws|googleapis\\.com\\/(?!css)/.test(n));

  return {
    innerWidth: win.innerWidth, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
    h1Total: doc.querySelectorAll('h1').length,
    sections, overflow: overflow.slice(0, 10), overflowCount: overflow.length,
    primary, kpiPositive: kpiOf('pulse'), kpiNegative: kpiOf('semantic'),
    badgeWidths: badges, contextWidth: ctx ? Math.round(ctx.getBoundingClientRect().width) : null,
    pageWidth: Math.round(de.clientWidth), clipped,
    xhr: calls, suspiciousResources: suspicious,
  };
}`;

// A probe that throws must say so. Silence here previously surfaced as the
// useless "page failed to render".
const emit = `const b = btoa(unescape(encodeURIComponent(JSON.stringify(F))));
  document.body.insertAdjacentHTML('beforeend', '<div>__FACTS__' + b + '__END__</div>');`;
const guard = (body) => `try { ${body} } catch (e) {
  const b = btoa(unescape(encodeURIComponent(JSON.stringify({ probeError: e.message + ' @ ' + (e.stack||'').split(String.fromCharCode(10))[1] }))));
  document.body.insertAdjacentHTML('beforeend', '<div>__FACTS__' + b + '__END__</div>');
}`;

// Desktop: load the preview directly, then report from its own document.
const directProbe = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="f" src="/design-preview" style="width:1440px;height:900px;border:0"></iframe>
<script>${PROBE_FN}
setTimeout(() => { ${guard(`const w = document.getElementById('f').contentWindow;
  const F = facts(w, w.document); ${emit}`)} }, 3500);
</script></body>`;

const mobileProbe = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="f" src="/design-preview" style="width:390px;height:844px;border:0"></iframe>
<script>${PROBE_FN}
setTimeout(() => { ${guard(`const w = document.getElementById('f').contentWindow;
  const F = facts(w, w.document); ${emit}`)} }, 3500);
</script></body>`;

console.log('\nrendered preview — collecting facts from a real browser');
const D = await collect(directProbe);
const M = await collect(mobileProbe);
console.log(`  .. desktop viewport ${D.innerWidth}px, mobile viewport ${M.innerWidth}px`);

/* ── headings ──────────────────────────────────────────────────────────────── */
console.log('\nheadings');

t('the Pulse example renders exactly one <h1>', () => {
  assert.strictEqual(D.sections.pulse?.h1, 1, `pulse h1 count = ${D.sections.pulse?.h1}`);
});

t('the Accounts example renders exactly one <h1>', () => {
  assert.strictEqual(D.sections.accounts?.h1, 1, `accounts h1 count = ${D.sections.accounts?.h1}`);
});

t('the catalogue page does not add an <h1> of its own', () => {
  // Each PageHeader owns one. A catalogue heading on top would make three pages'
  // worth of h1 on one document and misreport the page's structure.
  const fromSections = Object.values(D.sections).reduce((n, s) => n + s.h1, 0);
  assert.strictEqual(D.h1Total, fromSections,
    `document has ${D.h1Total} h1 but sections own ${fromSections}`);
});

/* ── the mobile viewport is real ───────────────────────────────────────────── */
console.log('\nmobile — a genuine 390px viewport');

t('the viewport is genuinely 390 CSS pixels', () => {
  // Chrome clamps a top-level window to 512px. If this ever reads 512 the test is
  // measuring a cropped desktop layout and every mobile claim below is void.
  assert.strictEqual(M.innerWidth, 390, `iframe innerWidth = ${M.innerWidth}, expected 390`);
  assert.strictEqual(M.clientWidth, 390, `clientWidth = ${M.clientWidth}, expected 390`);
});

t('nothing scrolls sideways at 390px', () => {
  assert.ok(M.scrollWidth <= M.clientWidth,
    `scrollWidth ${M.scrollWidth} > clientWidth ${M.clientWidth}`);
});

t('no element overflows the viewport at 390px', () => {
  assert.strictEqual(M.overflowCount, 0,
    `${M.overflowCount} overflowing element(s): ` + JSON.stringify(M.overflow));
});

t('context badges hug their content instead of stretching', () => {
  // They shared the actions box, which becomes a full-width grid on mobile, so
  // every badge stretched edge to edge.
  assert.ok(M.badgeWidths.length > 0, 'no context badges found');
  for (const w of M.badgeWidths) {
    assert.ok(w < M.clientWidth - 24,
      `a badge is ${w}px wide in a ${M.clientWidth}px viewport — it is stretching`);
  }
  assert.ok(new Set(M.badgeWidths).size > 1,
    'every badge is the same width, which means they are being stretched to fit');
});

/* ── the watermark ─────────────────────────────────────────────────────────── */
console.log('\nwatermark');

t('each hero carries exactly one mark', () => {
  for (const [id, s] of Object.entries(D.sections)) {
    if (!s.heroes) continue;
    assert.strictEqual(s.marks, s.heroes,
      `section "${id}" has ${s.heroes} hero(es) but ${s.marks} mark(s)`);
  }
});

t('the mark is decorative: empty alt, hidden from assistive technology', () => {
  const all = Object.values(D.sections).flatMap((s) => s.markAttrs);
  assert.ok(all.length > 0, 'no watermark rendered');
  for (const m of all) {
    assert.strictEqual(m.ariaHidden, 'true', 'watermark is not aria-hidden');
    assert.strictEqual(m.alt, '', 'watermark has a non-empty alt');
    assert.ok(m.inHero, 'watermark is not anchored inside a hero');
  }
});

t('the mark is one oversized cropped symbol, not a tiled wallpaper', () => {
  const all = Object.values(D.sections).flatMap((s) => s.markAttrs);
  for (const m of all) {
    assert.ok(m.w >= 120, `mark is only ${m.w}px — too small to read as the approved treatment`);
    assert.ok(Number(m.opacity) <= 0.16, `mark opacity ${m.opacity} is too assertive`);
    assert.ok(Number(m.opacity) >= 0.05, `mark opacity ${m.opacity} would be invisible`);
  }
  const widths = new Set(all.map((m) => m.w));
  assert.strictEqual(widths.size, 1,
    `the two hero implementations draw different marks: ${[...widths].join('px, ')}px`);
});

/* ── action colour ─────────────────────────────────────────────────────────── */
console.log('\nprimary action colour');

t('the primary button resolves to --action-primary, not the raw brand accent', () => {
  assert.ok(D.primary, 'no primary button rendered');
  assert.notStrictEqual(D.primary.bg, 'rgb(51, 153, 255)',
    'the button is using --brand-electric-blue (#3399FF), which fails AA on white text');
  assert.strictEqual(D.primary.bg, 'rgb(21, 101, 192)',
    `expected --action-primary (#1565C0), got ${D.primary.bg}`);
  assert.strictEqual(D.primary.fg, 'rgb(255, 255, 255)',
    `expected --action-primary-text (#FFFFFF), got ${D.primary.fg}`);
});

t('primary button text clears WCAG AA', () => {
  assert.ok(D.primary.ratio >= 4.5,
    `contrast is ${D.primary.ratio}:1 (${D.primary.bg} on ${D.primary.fg}), AA needs 4.5:1`);
});

/* ── semantic colour ───────────────────────────────────────────────────────── */
console.log('\nsemantic colour');

const SUCCESS = 'rgb(15, 122, 82)';   // --success  #0F7A52
const INK = 'rgb(0, 51, 102)';        // --brand-navy #003366
const DANGER = 'rgb(198, 40, 40)';    // --danger   #C62828
const WARN_INK = 'rgb(139, 90, 8)';   // --warning-ink #8B5A08

t('real revenue is positive, and reads as success', () => {
  const k = D.kpiPositive['operating revenue this month'];
  assert.ok(k, 'revenue KPI not found');
  assert.strictEqual(k.color, SUCCESS, `revenue is ${k.color}, expected success green`);
});

t('operating cash out is ink, not red — spending is not a failure', () => {
  const k = D.kpiPositive['operating cash out this month'];
  assert.strictEqual(k.color, INK, `cash out is ${k.color}, expected ink`);
});

t('zero revenue is NOT green — "+ Rp 0" must not read as good news', () => {
  const k = D.kpiNegative['operating revenue this month'];
  assert.match(k.text, /\b0\b/, `expected a zero-revenue fixture, got "${k.text}"`);
  assert.notStrictEqual(k.color, SUCCESS, 'zero revenue is being coloured as a positive');
  assert.strictEqual(k.color, INK, `zero revenue is ${k.color}, expected ink`);
});

t('a genuinely negative net position is red', () => {
  const k = D.kpiNegative['net position'];
  assert.match(k.text, /-/, `expected a negative fixture, got "${k.text}"`);
  assert.strictEqual(k.color, DANGER, `negative net position is ${k.color}, expected danger red`);
});

t('a short runway warns rather than alarms', () => {
  const k = D.kpiNegative['runway'];
  assert.strictEqual(k.color, WARN_INK, `short runway is ${k.color}, expected warning ink`);
});

t('financial figures are set in the mono face with tabular numerals', () => {
  for (const [label, k] of Object.entries(D.kpiPositive)) {
    assert.match(k.font, /JetBrains Mono/, `"${label}" is set in ${k.font}`);
    assert.match(k.numeric, /tabular-nums/, `"${label}" is not using tabular numerals`);
  }
});

/* ── long content ──────────────────────────────────────────────────────────── */
console.log('\nlong content');

t('a long title and description wrap without clipping', () => {
  assert.deepStrictEqual(D.clipped, [], 'clipped: ' + JSON.stringify(D.clipped));
});

t('nothing overflows horizontally at 1440px either', () => {
  assert.strictEqual(D.overflowCount, 0,
    `${D.overflowCount} overflowing element(s): ` + JSON.stringify(D.overflow));
});

/* ── isolation ─────────────────────────────────────────────────────────────── */
console.log('\nisolation');

t('the preview makes no API or Supabase requests', () => {
  assert.deepStrictEqual(D.xhr, [], 'the page issued requests: ' + JSON.stringify(D.xhr));
  assert.deepStrictEqual(D.suspiciousResources, [],
    'the page loaded backend resources: ' + JSON.stringify(D.suspiciousResources));
});

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
