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
  } finally { if (!process.env.KEEP_HARNESS) fs.unlinkSync(path.join(DIST, name)); }
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
        visible: cs(m).display !== 'none' && m.getBoundingClientRect().width > 0,
        heroW: (() => { const h = m.closest('.cfo-summary, .pulse-cash');
          return h ? Math.round(h.getBoundingClientRect().width) : 0; })(),
        // A mark that stops inside the card is a sticker; one that runs off the
        // edge is a crop. The approved treatment is the crop.
        cropped: (() => { const h = m.closest('.cfo-summary, .pulse-cash');
          return h ? m.getBoundingClientRect().right > h.getBoundingClientRect().right - 1 : false; })(),
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

  // Figures must never be the thing that gives way. .pulse-cash-value is
   // nowrap + ellipsis, so a too-greedy watermark column truncates it in silence.
  const figures = [...doc.querySelectorAll('.pulse-cash-value, .cfo-summary-value, .pulse-kpi-value')]
    .map((el) => ({
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 24),
      text: (el.textContent || '').trim().slice(0, 24),
      truncated: el.scrollWidth > el.clientWidth + 1,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    }));

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

  // Watermark vs text: the mark is decoration and must never sit under anything a
  // reader needs. Compare painted rectangles, not intentions.
  const overlaps = [];
  [...doc.querySelectorAll('.cfo-summary-sym, .pulse-cash-mark')].forEach((mk) => {
    const mr = mk.getBoundingClientRect();
    const hero = mk.closest('.cfo-summary, .pulse-cash, .cfo-pagehead');
    if (!hero) return;
    [...hero.querySelectorAll('*')].forEach((el) => {
      if (el === mk || el.children.length) return;
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      const st = cs(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return;
      const tr = el.getBoundingClientRect();
      const ox = Math.min(mr.right, tr.right) - Math.max(mr.left, tr.left);
      const oy = Math.min(mr.bottom, tr.bottom) - Math.max(mr.top, tr.top);
      if (ox > 0 && oy > 0) overlaps.push({
        hero: hero.className.split(' ')[0],
        text: txt.slice(0, 30),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 24),
        by: Math.round(ox) + 'x' + Math.round(oy),
      });
    });
  });

  // Page-level actions are thumb targets on a phone.
  const headActions = [...doc.querySelectorAll('.cfo-pagehead-actions :is(.cfo-btn,.btn,button,a[role="button"])')]
    .map((b) => ({ txt: (b.textContent || '').trim().slice(0, 20),
      h: +b.getBoundingClientRect().height.toFixed(1),
      w: +b.getBoundingClientRect().width.toFixed(1) }));

  // Header composition: is there a real left zone and a real right zone?
  const heads = [...doc.querySelectorAll('.cfo-pagehead')].map((hd) => {
    const r = hd.getBoundingClientRect();
    const txt = hd.querySelector('.cfo-pagehead-text');
    const right = hd.querySelector('.cfo-pagehead-right');
    const mark = hd.querySelector('.cfo-pagehead-mark');
    const box = (el) => el ? (rr => ({ l: Math.round(rr.left - r.left), r: Math.round(rr.right - r.left),
      t: Math.round(rr.top - r.top), b: Math.round(rr.bottom - r.top) }))(el.getBoundingClientRect()) : null;
    return {
      width: Math.round(r.width),
      text: box(txt), right: box(right), mark: box(mark),
      markVisible: mark ? cs(mark).display !== 'none' && mark.getBoundingClientRect().width > 0 : false,
      markReserve: Math.round(parseFloat(cs(hd).paddingRight) || 0),
      sameRow: txt && right ? Math.abs(txt.getBoundingClientRect().top - right.getBoundingClientRect().top) < 40 : null,
      rule: cs(hd).borderBottomWidth,
    };
  });

  // Focus ring, from a real keyboard-style focus rather than a class that mimics
  // one: :focus-visible is what a keyboard user actually gets.
  let focusRing = null;
  const ft = doc.querySelector('.dsp-focus-target') || doc.querySelector('.cfo-btn-primary');
  if (ft) {
    ft.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    ft.focus();
    const fs2 = cs(ft);
    // The ring is seen against the page ground on both sides of its offset gap,
    // so that is what it has to clear.
    const ground = (() => {
      let el = ft.parentElement;
      while (el) { const bg = cs(el).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        el = el.parentElement; }
      return 'rgb(255, 255, 255)';
    })();
    focusRing = {
      matches: ft.matches(':focus-visible'),
      color: fs2.outlineColor,
      width: fs2.outlineWidth,
      style: fs2.outlineStyle,
      offset: fs2.outlineOffset,
      ground,
      contrastVsGround: ratio(fs2.outlineColor, ground),
    };
    ft.blur();
  }

  // How many large brand marks are painted in one content area, and where.
  const painted = (el) => !!el && cs(el).display !== 'none'
    && el.getBoundingClientRect().width > 0 && Number(cs(el).opacity) > 0;
  const brand = {
    heroMarks: [...doc.querySelectorAll('.cfo-pagehead-mark')].filter(painted).length,
    cardMarks: [...doc.querySelectorAll('.cfo-summary-sym, .pulse-cash-mark')].filter(painted).length,
    sidebarWordmarks: [...doc.querySelectorAll('.cfo-sidebar .cfo-brand img')].filter(painted).length,
    mobileBrand: (() => {
      const b = doc.querySelector('.cfo-mobilehead .cfo-mobilebrand');
      if (!painted(b)) return null;
      const r = b.getBoundingClientRect();
      return { src: b.getAttribute('src'), alt: b.getAttribute('alt'),
        w: Math.round(r.width), h: Math.round(r.height),
        natural: b.naturalWidth + 'x' + b.naturalHeight };
    })(),
    mobileBadges: [...doc.querySelectorAll('.cfo-mobilehead .cfo-badge')].filter(painted).length,
    burger: (() => { const b = doc.querySelector('.cfo-burger');
      if (!b) return null; const r = b.getBoundingClientRect();
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), label: b.getAttribute('aria-label') }; })(),
  };

  // Any technical identifier that leaked into the rendered page.
  const idLeaks = [...doc.querySelectorAll('.cfo-pagehead, .cfo-summary, .pulse-cash')]
    .flatMap((el) => (el.textContent || '').match(/\\b[A-Z]{3,}-[A-Z0-9]{3,}-?[0-9]{3,}\\b/g) || []);

  // The settings footer utility. Scoped by region: the sidebar copy still exists in
  // the DOM on a phone (display:none), so an unscoped query measures the wrong one
  // and reports a 0px row in the drawer.
  const describeSettings = (root) => {
    if (!root) return null;
    const setBtn = root.querySelector('.cfo-side-settings');
    if (!painted(setBtn)) return null;
    const nav = root.querySelector('.cfo-nav');
    const foot = root.querySelector('.cfo-side-foot');
    return {
      tag: setBtn.tagName.toLowerCase(),
      label: setBtn.getAttribute('aria-label'),
      title: (setBtn.querySelector('.cfo-side-settings-title') || {}).textContent,
      sub: (setBtn.querySelector('.cfo-side-settings-sub') || {}).textContent,
      h: +setBtn.getBoundingClientRect().height.toFixed(1),
      nested: setBtn.querySelectorAll('button, a, [role="button"], [tabindex]').length,
      hasIcon: !!setBtn.querySelector('.cfo-side-settings-icon svg'),
      hasChev: !!setBtn.querySelector('.cfo-side-settings-chev svg'),
      // The footer must sit outside the scrollport, not inside it.
      insideNav: !!nav && nav.contains(setBtn),
      navScrolls: !!nav && ['auto', 'scroll'].includes(cs(nav).overflowY),
      // and must not be drawn over the last nav item
      overlapsNav: (() => {
        if (!nav || !foot) return null;
        const n = nav.getBoundingClientRect(), f = foot.getBoundingClientRect();
        return Math.min(n.bottom, f.bottom) - Math.max(n.top, f.top) > 1;
      })(),
    };
  };
  const settings = describeSettings(doc.querySelector('.cfo-sidebar'));
  const drawerSettings = describeSettings(doc.querySelector('.cfo-drawer'));
  const topbarSettings = describeSettings(doc.querySelector('.cfo-mobilehead'));

  const navItems = [...doc.querySelectorAll('.cfo-nav .cfo-navitem')]
    .map((b) => (b.textContent || '').trim());

  // Marks per hero, not per document: the catalogue page renders several headers,
  // and "one mark" is a rule about one content area.
  const headMarks = [...doc.querySelectorAll('.cfo-pagehead')]
    .map((hd) => [...hd.querySelectorAll('.cfo-pagehead-mark')].filter(painted).length);

  // The real application frame, when the preview is rendering in-shell.
  const shell = doc.querySelector('.cfo-shell') ? {
    sidebars: doc.querySelectorAll('.cfo-sidebar').length,
    navItems: doc.querySelectorAll('.cfo-sidebar a, .cfo-sidebar button').length,
    brandImgs: doc.querySelectorAll('.cfo-brand img').length,
    brandBoxH: (() => { const b = doc.querySelector('.cfo-brand');
      return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
    mobileHead: doc.querySelectorAll('.cfo-mobilehead').length,
    mobileHeadH: (() => { const h = doc.querySelector('.cfo-mobilehead');
      return h ? Math.round(h.getBoundingClientRect().height) : 0; })(),
    sidebarVisible: (() => { const a = doc.querySelector('.cfo-sidebar');
      return !!a && cs(a).display !== 'none' && a.getBoundingClientRect().width > 0; })(),
    contentWidth: (() => { const m = doc.querySelector('.cfo-main, .cfo-content, .cfo-shell > *:not(.cfo-sidebar):not(.cfo-mobilehead)');
      return m ? Math.round(m.getBoundingClientRect().width) : null; })(),
  } : null;

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
    overlaps: overlaps.slice(0, 12), overlapCount: overlaps.length,
    headActions, heads, focusRing, shell, figures, brand, idLeaks, navItems,
    settings, drawerSettings, topbarSettings, headMarks,
    fonts: { status: doc.fonts.status, size: doc.fonts.size,
      archivo: doc.fonts.check('400 40px "Archivo Black"'),
      mono: doc.fonts.check('700 20px "JetBrains Mono Variable"') },
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
// Every probe waits for document.fonts.ready before measuring. Geometry taken
// mid-swap is geometry of the fallback face, and a text rectangle measured in the
// wrong font is the wrong rectangle.
const probeFor = (route, w, h) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="f" src="${route}" style="width:${w}px;height:${h}px;border:0"></iframe>
<script>${PROBE_FN}
setTimeout(async () => { ${guard(`const win = document.getElementById('f').contentWindow;
  await win.document.fonts.ready;
  const F = facts(win, win.document); ${emit}`)} }, 3000);
</script></body>`;

const directProbe = probeFor('/design-preview', 1440, 900);
const mobileProbe = probeFor('/design-preview', 390, 844);
const shellDesktopProbe = probeFor('/design-preview?shell=pulse', 1440, 900);
const shellMobileProbe = probeFor('/design-preview?shell=accounts', 390, 844);
// The drawer, opened by clicking the real burger rather than forcing state.
const drawerProbe = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="f" src="/design-preview?shell=pulse" style="width:390px;height:844px;border:0"></iframe>
<script>${PROBE_FN}
setTimeout(async () => { ${guard(`const win = document.getElementById('f').contentWindow;
  await win.document.fonts.ready;
  // NB: the name is not b — the emit snippet below declares one, and two consts of
  // the same name in one block is a parse error that surfaces only as "no facts".
  const burger = win.document.querySelector('.cfo-burger');
  if (burger) { burger.click(); await new Promise((r) => setTimeout(r, 400)); }
  const F = facts(win, win.document); ${emit}`)} }, 3000);
</script></body>`;

console.log('\nrendered preview — collecting facts from a real browser');
const D = await collect(directProbe);
const M = await collect(mobileProbe);
const SD = await collect(shellDesktopProbe);
const SM = await collect(shellMobileProbe);
const DRAWER = await collect(drawerProbe);
console.log(`  .. desktop viewport ${D.innerWidth}px, mobile viewport ${M.innerWidth}px, `
  + `in-shell ${SD.innerWidth}px / ${SM.innerWidth}px`);

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
  // every badge stretched edge to edge. Widths must differ with their text.
  assert.ok(M.badgeWidths.length > 1,
    `expected the catalogue to render context badges to test, found ${M.badgeWidths.length}`);
  for (const w of M.badgeWidths) {
    assert.ok(w < M.clientWidth - 24,
      `a badge is ${w}px wide in a ${M.clientWidth}px viewport — it is stretching`);
  }
  assert.ok(new Set(M.badgeWidths).size > 1,
    'every badge is exactly the same width, which means they are being stretched to fit');
});

/* ── the brand rule ────────────────────────────────────────────────────────── */
console.log('\nbrand — one mark per content area');

t('each page hero carries exactly one decorative mark on desktop', () => {
  assert.ok(D.headMarks.length > 0, 'no page hero rendered');
  for (const n of D.headMarks) {
    assert.strictEqual(n, 1, `a page hero painted ${n} marks; the rule is one per hero`);
  }
  // And in the product, one page is one hero, so one mark on screen.
  assert.strictEqual(SD.brand.heroMarks, 1,
    `${SD.brand.heroMarks} marks painted in the app shell; the rule is one`);
});

t('the dark financial cards carry no mark at all', () => {
  // Total Cash / Total Balance used to draw a second large mark directly under the
  // page hero's. Two in one content area is one too many, and the card's width
  // belongs to the figure.
  for (const [name, f] of [['isolated', D], ['mobile', M], ['shell', SD], ['shell mobile', SM]]) {
    assert.strictEqual(f.brand.cardMarks, 0,
      `${f.brand.cardMarks} watermark(s) still painted in a financial card (${name})`);
  }
});

t('the desktop sidebar shows the complete wordmark', () => {
  assert.strictEqual(SD.brand.sidebarWordmarks, 1,
    `${SD.brand.sidebarWordmarks} sidebar wordmarks painted`);
  assert.ok(SD.shell.brandBoxH >= 40,
    `the wordmark box is ${SD.shell.brandBoxH}px tall — it has collapsed`);
});

t('the mobile bar shows a recognisable CFO AI lockup, not a bare symbol', () => {
  const b = SM.brand.mobileBrand;
  assert.ok(b, 'no brand lockup painted in the mobile header');
  assert.match(b.src, /logo_/, `mobile header uses ${b.src}; a bare symbol is not identifiable`);
  assert.match(b.alt || '', /CFO AI/i, `mobile brand alt is "${b.alt}"`);
  // Crisp and uncropped: rendered inside the asset's natural box, not stretched.
  const [nw, nh] = b.natural.split('x').map(Number);
  assert.ok(nw > 0 && nh > 0, 'the mobile brand asset did not load');
  const ratioNatural = nw / nh, ratioDrawn = b.w / b.h;
  assert.ok(Math.abs(ratioNatural - ratioDrawn) / ratioNatural < 0.02,
    `the lockup is distorted: drawn ${b.w}x${b.h}, natural ${b.natural}`);
});

t('the mobile bar has no role badge and one 44px control', () => {
  assert.strictEqual(SM.brand.mobileBadges, 0,
    `${SM.brand.mobileBadges} badge(s) still in the mobile top bar`);
  assert.ok(SM.brand.burger, 'no menu button in the mobile bar');
  assert.ok(SM.brand.burger.h >= 44 && SM.brand.burger.w >= 44,
    `the menu button is ${SM.brand.burger.w}x${SM.brand.burger.h}; a thumb needs 44x44`);
  assert.ok((SM.brand.burger.label || '').length > 0, 'the menu button has no accessible name');
});

t('no technical identifier is rendered in the page hero or the cards', () => {
  for (const [name, f] of [['isolated', D], ['mobile', M], ['shell', SD], ['shell mobile', SM]]) {
    assert.deepStrictEqual(f.idLeaks, [],
      `${name}: technical identifier(s) visible: ${f.idLeaks.join(', ')}`);
  }
});

t('the page-hero mark sits inside the band, clear of every zone', () => {
  const marked = D.heads.filter((h) => h.markVisible);
  assert.ok(marked.length > 0, 'no page-hero mark painted on desktop');
  for (const h of marked) {
    assert.ok(h.mark.r <= h.width,
      `the mark runs to ${h.mark.r} in a ${h.width}px band — it is clipped by the edge`);
    assert.ok(h.text.r <= h.mark.l + 1,
      `the text zone reaches ${h.text.r} but the mark starts at ${h.mark.l}`);
    if (h.right) assert.ok(h.right.r <= h.mark.l + 1,
      `the control zone reaches ${h.right.r} but the mark starts at ${h.mark.l}`);
  }
});

t('mobile drops the page-hero mark', () => {
  for (const h of M.heads) {
    assert.strictEqual(h.markVisible, false, 'the page-hero mark is still painted at 390px');
  }
});

// Decoration must not share pixels with a figure, a label, a caption or a badge.
const overlapReport = (f) => f.overlaps
  .map((o) => `${o.hero} "${o.text}" (.${o.cls}) overlapping ${o.by}px`)
  .join('; ');

t('nothing decorative sits under text, anywhere', () => {
  for (const [name, f] of [['desktop', D], ['390px', M], ['shell', SD], ['shell mobile', SM]]) {
    assert.strictEqual(f.overlapCount, 0, `${name}: ${overlapReport(f)}`);
  }
});

t('no financial figure is truncated', () => {
  for (const f of [...D.figures, ...M.figures, ...SD.figures, ...SM.figures]) {
    assert.strictEqual(f.truncated, false,
      `"${f.text}" (.${f.cls}) is clipped: needs ${f.scrollW}px, has ${f.clientW}px`);
  }
});

/* ── workspace settings ────────────────────────────────────────────────────── */
console.log('\nsidebar — workspace settings utility');

t('Settings is no longer a plain navigation item', () => {
  const stray = SD.navItems.filter((l) => /^settings$/i.test(l.trim()));
  assert.deepStrictEqual(stray, [],
    `"Settings" is still in the nav list: ${JSON.stringify(SD.navItems)}`);
});

t('Team stays in the navigation — it manages people, not configuration', () => {
  assert.ok(SD.navItems.some((l) => /team/i.test(l)),
    `Team is missing from the nav: ${JSON.stringify(SD.navItems)}`);
});

t('the footer utility is one control with a clear accessible name', () => {
  const u = SD.settings;
  assert.ok(u, 'no workspace settings utility in the sidebar');
  assert.match(u.title.trim(), /^Workspace settings$/, `primary label is "${u.title}"`);
  assert.ok(u.sub.trim().length > 0, 'the utility has no supporting label');
  assert.match(u.label || '', /Workspace settings/, `accessible name is "${u.label}"`);
  assert.strictEqual(u.nested, 0,
    `${u.nested} nested interactive element(s) — the row must be a single control`);
  assert.ok(u.hasIcon, 'the utility has no leading icon');
  assert.ok(u.hasChev, 'the utility has no trailing chevron');
  assert.ok(u.h >= 44, `the row is ${u.h}px tall; the target must be at least 44px`);
});

t('the supporting label describes the workspace, not a guess', () => {
  // A personal workspace is not a shared team workspace; the subtitle is derived.
  assert.match(SD.settings.sub.trim(), /workspace$/i,
    `supporting label is "${SD.settings.sub}"`);
});

t('the footer sits outside the scrolling navigation and never covers it', () => {
  const u = SD.settings;
  assert.strictEqual(u.insideNav, false,
    'the footer is inside the scrollport, so long navigation scrolls it away');
  assert.strictEqual(u.navScrolls, true,
    'the navigation is not independently scrollable');
  assert.strictEqual(u.overlapsNav, false,
    'the footer overlaps the navigation region');
});

t('the same utility is reachable in the mobile drawer', () => {
  assert.ok(DRAWER.drawerSettings, 'the opened drawer has no workspace settings utility');
  assert.match(DRAWER.drawerSettings.title.trim(), /^Workspace settings$/,
    `drawer utility label is "${DRAWER.drawerSettings.title}"`);
  assert.ok(DRAWER.drawerSettings.h >= 44,
    `the drawer row is ${DRAWER.drawerSettings.h}px tall`);
});

t('the utility is not pinned into the compact mobile top bar', () => {
  assert.strictEqual(SM.topbarSettings, null,
    'workspace settings is showing in the mobile top bar; it belongs in the drawer');
  assert.strictEqual(SM.settings, null,
    'the desktop sidebar utility is still painted at 390px');
});

/* ── page-hero composition ─────────────────────────────────────────────────── */
console.log('\npage hero — composition');

t('desktop lays the header out as a left content zone and a right control zone', () => {
  // The control zone used to drop to the left under a long title, leaving the whole
  // right side of the header empty. It holds the right edge now.
  const withControls = D.heads.filter((h) => h.right);
  assert.ok(withControls.length > 0, 'no header with controls to check');
  for (const h of withControls) {
    assert.ok(h.text.l < h.right.l,
      `the text zone starts at ${h.text.l} but controls start at ${h.right.l}`);
    assert.ok(h.right.r >= h.width - h.markReserve - 4,
      `controls end at ${h.right.r} in a ${h.width}px header — they are not holding the right edge`);
  }
});

t('a description is given a readable measure, not the full window', () => {
  for (const h of D.heads) {
    assert.ok(h.text.r - h.text.l <= 900,
      `the text zone is ${h.text.r - h.text.l}px wide; a line that long is hard to read`);
  }
});

t('the header band carries a hairline rule', () => {
  for (const h of D.heads) {
    assert.notStrictEqual(h.rule, '0px', 'the page hero has no bottom rule');
  }
});

t('mobile stacks the header', () => {
  for (const h of M.heads) {
    if (h.right) assert.strictEqual(h.sameRow, false,
      'the control zone is still beside the text at 390px instead of stacked');
  }
});

/* ── mobile control sizing ─────────────────────────────────────────────────── */
console.log('\nmobile — control sizing');

t('page-level actions are at least 44px tall at 390px', () => {
  assert.ok(M.headActions.length > 0, 'no page-level action rendered at 390px');
  for (const b of M.headActions) {
    assert.ok(b.h >= 44, `"${b.txt}" is ${b.h}px tall; a thumb target needs 44px`);
  }
});

t('desktop control sizing is left alone', () => {
  // The comfort rule is scoped to the phone; a pointer does not need 44px, and
  // growing every desktop button would be a redesign nobody asked for.
  assert.ok(D.headActions.length > 0, 'no page-level action rendered at 1440px');
  for (const b of D.headActions) {
    assert.ok(b.h < 44, `"${b.txt}" is ${b.h}px tall on desktop; the mobile rule has leaked`);
  }
});

/* ── fonts ─────────────────────────────────────────────────────────────────── */
console.log('\nfonts');

t('the page renders in the real faces, not fallbacks', () => {
  assert.strictEqual(D.fonts.status, 'loaded', `document.fonts.status is ${D.fonts.status}`);
  assert.ok(D.fonts.archivo, 'the display face (Archivo Black) is not loaded');
  assert.ok(D.fonts.mono, 'the figure face (JetBrains Mono) is not loaded');
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

/* ── focus ─────────────────────────────────────────────────────────────────── */
console.log('\nfocus');

t('a keyboard focus produces a real :focus-visible ring', () => {
  assert.ok(D.focusRing, 'no focusable control found');
  assert.strictEqual(D.focusRing.matches, true,
    'the control does not match :focus-visible after a keyboard-style focus');
  assert.notStrictEqual(D.focusRing.style, 'none', 'the focus ring has no outline style');
  assert.ok(parseFloat(D.focusRing.width) >= 2,
    `the focus ring is ${D.focusRing.width}; it needs at least 2px to be seen`);
});

t('the focus ring clears 3:1 against the surface it is seen on', () => {
  // WCAG 1.4.11: a non-text indicator needs 3:1. The raw brand accent measured
  // 2.76:1 on the page ground, so the ring uses that blue's accessible ink.
  assert.ok(D.focusRing.contrastVsGround >= 3,
    `the ring is ${D.focusRing.contrastVsGround}:1 against ${D.focusRing.ground} — below 3:1`);
  assert.ok(parseFloat(D.focusRing.offset) >= 2,
    `the ring offset is ${D.focusRing.offset}; it needs space or it reads as a border`);
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

/* ── the real application shell ────────────────────────────────────────────── */
console.log('\napplication shell');

t('the preview renders inside the real WorkspaceShell, not a drawing of it', () => {
  // WorkspaceShell is presentational — useState and nothing else — so it can be
  // driven by synthetic props. If this ever stops finding the real frame, the
  // shell screenshots stop being evidence.
  assert.ok(SD.shell, 'no .cfo-shell found — the in-shell view is not rendering the frame');
  assert.strictEqual(SD.shell.sidebars, 1, `expected 1 sidebar, found ${SD.shell.sidebars}`);
  assert.ok(SD.shell.sidebarVisible, 'the desktop sidebar is not painted');
  assert.ok(SD.shell.brandImgs > 0, 'the shell is not rendering the official logo');
  // The sidebar is a column flex box at height:100vh, so once the nav is longer
  // than the viewport its children shrink. This one is a fixed clipping window
  // and collapsed to 0, letting the workspace switcher draw over the wordmark.
  assert.ok(SD.shell.brandBoxH >= 40,
    `the sidebar wordmark box is ${SD.shell.brandBoxH}px tall — it has collapsed`);
  assert.ok(SD.shell.navItems >= 15,
    `the sidebar has ${SD.shell.navItems} nav items; the real BUSINESS_NAV has far more`);
});

t('the in-shell page keeps exactly one <h1>', () => {
  assert.strictEqual(SD.h1Total, 1, `in-shell desktop has ${SD.h1Total} h1`);
  assert.strictEqual(SM.h1Total, 1, `in-shell mobile has ${SM.h1Total} h1`);
});

t('the in-shell mobile view is a true 390px viewport with no overflow', () => {
  assert.strictEqual(SM.innerWidth, 390, `in-shell mobile viewport is ${SM.innerWidth}px`);
  assert.ok(SM.scrollWidth <= SM.clientWidth,
    `in-shell mobile scrollWidth ${SM.scrollWidth} > clientWidth ${SM.clientWidth}`);
  assert.strictEqual(SM.overflowCount, 0,
    `${SM.overflowCount} element(s) overflow in the mobile shell: ` + JSON.stringify(SM.overflow));
});

t('the mobile shell shows its own header rather than the desktop sidebar', () => {
  assert.ok(SM.shell, 'no shell in the mobile view');
  assert.strictEqual(SM.shell.mobileHead, 1, 'the mobile shell header is missing');
  // The shell grid's rows were implicit `auto`, and a grid taller than its content
  // stretches them: on a short page the header absorbed the slack and grew to 274px
  // of empty white before the content started.
  assert.ok(SM.shell.mobileHeadH > 0 && SM.shell.mobileHeadH < 100,
    `the mobile header is ${SM.shell.mobileHeadH}px tall — it is being stretched`);
  assert.strictEqual(SM.shell.sidebarVisible, false,
    'the desktop sidebar is still painted at 390px');
});

t('nothing in the shell views touches the network', () => {
  for (const [name, f] of [['desktop', SD], ['mobile', SM]]) {
    assert.deepStrictEqual(f.xhr, [], `${name} shell issued requests: ` + JSON.stringify(f.xhr));
    assert.deepStrictEqual(f.suspiciousResources, [],
      `${name} shell loaded backend resources: ` + JSON.stringify(f.suspiciousResources));
  }
});

t('the watermark does not sit under text in the shell views either', () => {
  assert.strictEqual(SD.overlapCount, 0,
    `in-shell desktop: ${overlapReport(SD)}`);
  assert.strictEqual(SM.overlapCount, 0,
    `in-shell mobile: ${overlapReport(SM)}`);
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
