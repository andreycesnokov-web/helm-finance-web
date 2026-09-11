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
/* How long a browser may take before we call it wedged.
 *
 * This is a WALL-CLOCK guard, not a performance budget: the whole file runs in
 * ~6s on an idle machine, and every number below is dead time that only elapses
 * when something is already broken.
 *
 * It has to be two numbers because the same work takes wildly different wall
 * time depending on how it is invoked. Run directly, this file gets the machine
 * to itself. Run through `node --test`, which executes test FILES in parallel,
 * its five Chrome launches compete with ~30 other files for CPU — the same run
 * was measured at 129s and then 297s on the same machine minutes apart. A single
 * fixed number is therefore either a flake (too low under the runner) or useless
 * (too high when run directly, where a wedged browser should surface in seconds).
 *
 * `NODE_TEST_CONTEXT` is set by node's own test runner in the child process, so
 * the file can tell which situation it is in without being told.
 */
const KILL_MS = process.env.NODE_TEST_CONTEXT ? 600000 : 120000;

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
      // Headroom, because `node --test` runs test FILES in parallel and these
      // launches compete with the rest of the suite for CPU. The real fix for the
      // flake was fewer launches — see probeGroup below, which puts many
      // viewports in one browser and took this file from ~75s to ~4s — but a
      // timeout that only just fits is a flake waiting to come back.
      const kill = setTimeout(() => { child.kill(); reject(new Error('chrome timed out')); }, KILL_MS);
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

  // Only h1/heroes are read from here. The mark description that used to live in
  // this block queried .cfo-summary-sym/.pulse-cash-mark — classes the product no
  // longer has — and nothing asserted on it; brand.flagships below measures the
  // real thing instead.
  const sections = {};
  doc.querySelectorAll('.dsp-section').forEach((s) => {
    sections[s.id] = {
      h1: s.querySelectorAll('h1').length,
      heroes: s.querySelectorAll('.cfo-summary, .pulse-cash').length,
    };
  });

  // Overflow means CONTENT that runs off the page. The flagship watermark's whole
  // treatment is to run off its card's right edge and be clipped there, so its
  // layout box legitimately extends past the viewport while nothing of it is ever
  // drawn outside the card; the strict version of this scan failed on the design
  // it exists to protect.
  //
  // The distinction that matters is WHAT clips it. A component clipping its own
  // decoration is a design decision. The page's global guard clipping a too-wide
  // layout is a bug — and a silent one here, because index.css sets overflow-x:
  // hidden on html, body and #root, so a broken layout never produces a scrollbar
  // to notice, it just amputates content. That also makes the scrollWidth
  // assertion beside every use of this list unfalsifiable on this app, which is
  // exactly why the element scan has to stay strict.
  //
  // So: walk up for a clipping ancestor, but STOP at the root containers. A
  // non-root clipper means a deliberate local crop; reaching the root means only
  // the global guard is hiding it, which is the case worth failing on.
  const isRootish = (el) => el === de || el === doc.body || el.id === 'root';
  const clipBoundary = (el) => {
    for (let a = el.parentElement; a && !isRootish(a); a = a.parentElement) {
      const o = cs(a);
      // 'auto' and 'scroll' clip exactly as 'hidden' does — the content past the
      // edge is reachable by scrolling, not painted outside the box. Treating
      // them as non-clipping reported a deliberately scrollable tab strip as a
      // page that overflows, which is the opposite of what it is.
      const hides = (v) => v === 'hidden' || v === 'clip' || v === 'auto' || v === 'scroll';
      if (hides(o.overflowX) || hides(o.overflowY)) return a.getBoundingClientRect().right;
    }
    return Infinity;
  };
  const overflow = [];
  doc.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > de.clientWidth + 1
        && clipBoundary(el) > de.clientWidth + 1) overflow.push({
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
    // NB: this used to query .cfo-summary-sym/.pulse-cash-mark, classes that no
    // longer exist anywhere in the product, so it counted 0 whatever was on screen
    // and the assertion beside it was passing vacuously.
    cardMarks: [...doc.querySelectorAll('.cfo-flagship-mark')].filter(painted).length,
    // Every surface that opted in, described in full, so a reviewer does not have
    // to take one mark per card, its faintness, its crop or its clear space on
    // trust. cropped > 0 means the card's right edge eats into it, which is the
    // intended treatment; safeGap is the distance from the nearest thing anyone
    // has to read to the near edge of the mark. (No backticks in here: this whole
    // probe is a template literal, and one would end it.)
    flagships: [...doc.querySelectorAll('.cfo-flagship')].map((c) => {
      const r = c.getBoundingClientRect();
      const m = c.querySelector('.cfo-flagship-mark');
      const mr = m ? m.getBoundingClientRect() : null;
      const ms = m ? cs(m) : null;
      const kids = [...c.children].filter((k) => k !== m);
      const contentRight = kids.length
        ? Math.max.apply(null, kids.map((k) => k.getBoundingClientRect().right)) : 0;
      return {
        cls: (typeof c.className === 'string' ? c.className : ''),
        w: Math.round(r.width), h: Math.round(r.height),
        marks: c.querySelectorAll('.cfo-flagship-mark').length,
        painted: painted(m),
        src: m ? (m.getAttribute('src') || '') : null,
        alt: m ? m.getAttribute('alt') : null,
        ariaHidden: m ? m.getAttribute('aria-hidden') : null,
        role: m ? m.getAttribute('role') : null,
        opacity: ms ? Number(ms.opacity) : null,
        zIndex: ms ? ms.zIndex : null,
        repeat: ms ? ms.backgroundRepeat : null,
        bgImage: ms ? ms.backgroundImage : null,
        markW: mr ? Math.round(mr.width) : null,
        markH: mr ? Math.round(mr.height) : null,
        cropped: mr ? Math.round(mr.right - r.right) : null,
        safeGap: mr ? Math.round(mr.left - contentRight) : null,
        sizeToken: cs(c).getPropertyValue('--mark-size').trim(),
        safeToken: cs(c).getPropertyValue('--mark-safe').trim(),
      };
    }),
    // Summary cards that did NOT opt in. These must be completely plain.
    plainSummaries: [...doc.querySelectorAll('.cfo-summary:not(.cfo-flagship)')]
      .filter((c) => painted(c))
      .map((c) => ({ imgs: c.querySelectorAll('img').length,
                     marks: c.querySelectorAll('.cfo-flagship-mark').length })),
    // The other branding layer, measured so the two can be compared directly.
    heroMark: (() => {
      const m = [...doc.querySelectorAll('.cfo-pagehead-mark')].filter(painted)[0];
      if (!m) return null;
      const st = cs(m); const r = m.getBoundingClientRect();
      const band = m.parentElement.getBoundingClientRect();
      return { src: m.getAttribute('src') || '', opacity: Number(st.opacity),
        alt: m.getAttribute('alt'), ariaHidden: m.getAttribute('aria-hidden'),
        repeat: st.backgroundRepeat,
        w: Math.round(r.width), h: Math.round(r.height),
        clearTop: Math.round(r.top - band.top),
        clearBottom: Math.round(band.bottom - r.bottom),
        clearRight: Math.round(band.right - r.right) };
    })(),
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

  // Wallets is the one page in this PR with two states, and the failure mode is
  // that they blend: a zero state under a card still claiming four wallets and a
  // balance. So the probe reports what the card SAYS, not just that it exists.
  const walletsState = (() => {
    const card = doc.querySelector('.cfo-summary.cfo-flagship');
    const state = doc.querySelector('.cfo-state');
    const ctas = state ? state.querySelectorAll('.cfo-state-actions .cfo-btn') : [];
    const cta = ctas[0] || null;
    const val = card ? card.querySelector('.cfo-summary-value') : null;
    const meta = card ? card.querySelector('.cfo-summary-meta') : null;
    const sym = state ? state.querySelector('img') : null;
    const head = state ? state.querySelector('h1,h2,h3,h4') : null;
    const desc = state ? state.querySelector('.cfo-state-p') : null;
    const box = (el) => { if (!el) return null; const q = el.getBoundingClientRect();
      return { x: Math.round(q.x), y: Math.round(q.y),
               w: Math.round(q.width), h: Math.round(q.height) }; };
    const txt = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
    const main = doc.querySelector('.cfo-main-inner') || doc.body;
    return {
      hasCard: !!card,
      label: txt(card ? card.querySelector('.cfo-summary-label') : null),
      value: txt(val),
      valueBox: box(val),
      valueLines: val
        ? Math.round(val.getBoundingClientRect().height / parseFloat(cs(val).lineHeight)) : null,
      valueWhiteSpace: val ? cs(val).whiteSpace : null,
      meta: txt(meta),
      metaBox: box(meta),
      hasEmptyState: !!state,
      stateBox: box(state),
      headingTag: head ? head.tagName.toLowerCase() : null,
      heading: txt(head),
      desc: txt(desc),
      ctaCount: ctas.length,
      cta: txt(cta),
      ctaBox: box(cta),
      symAlt: sym ? sym.getAttribute('alt') : null,
      symAriaHidden: sym ? sym.getAttribute('aria-hidden') : null,
      // A multi-currency card prints one labelled amount per currency and no
      // combined figure. Report the pairs so a test can check exactly that.
      currencies: card
        ? [...card.querySelectorAll('.cfo-summary-cur')].map((el) => ({
            code: txt(el.querySelector('.cfo-summary-cur-code')),
            amount: txt(el.querySelector('.cfo-summary-cur-amt')),
          }))
        : [],
      noTotal: txt(card ? card.querySelector('.cfo-summary-nototal') : null),
      pageText: txt(main).slice(0, 1500),
    };
  })();

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

  // Measured inside the wrapping example, which exists precisely to carry several
  // badges of different lengths. Taking the FIRST context box on the page instead
  // made this depend on the order of the catalogue: adding a section above it
  // whose header carries a single badge silently changed what was being tested.
  const ctxHost = doc.getElementById('wrapping') || doc;
  const ctx = ctxHost.querySelector('.cfo-pagehead-context');
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

  // AI CFO, measured. The page's whole job is a verdict, so what has to be
  // checked is that the verdict is legible and that nothing about it is claimed
  // by colour alone: the score bar's fill and the figure beside it must agree,
  // and every control the page adds has to be reachable by a thumb.
  const aicfo = (() => {
    const page = doc.querySelector('.aicfo-page');
    if (!page) return null;
    const bandOf = (el) => !el ? null
      : el.classList.contains('is-healthy') ? 'healthy'
        : el.classList.contains('is-attention') ? 'attention'
          : el.classList.contains('is-critical') ? 'critical' : 'neutral';
    const num = page.querySelector('.aicfo-score-num');
    return {
      // The score and its band, plus the painted colour, so "green means healthy"
      // is checked against what is on screen rather than against a class name.
      score: num ? { text: num.textContent.trim(), band: bandOf(num), color: cs(num).color } : null,
      // Each factor: the bar's band, its painted fill, its width as a percentage
      // of the track, and the score it sits under.
      factors: [...page.querySelectorAll('.aicfo-factor')].map((li) => {
        const fill = li.querySelector('.aicfo-bar-fill');
        const track = li.querySelector('.aicfo-bar');
        const sc = li.querySelector('.aicfo-factor-score');
        const meter = li.querySelector('[role="meter"]');
        return {
          name: (li.querySelector('.aicfo-factor-name') || {}).textContent?.trim().slice(0, 24) || '',
          band: bandOf(fill),
          scoreBand: bandOf(sc),
          score: sc ? sc.textContent.trim() : null,
          fill: fill ? cs(fill).backgroundColor : null,
          pct: fill && track && track.getBoundingClientRect().width > 0
            ? Math.round(fill.getBoundingClientRect().width / track.getBoundingClientRect().width * 100)
            : null,
          labelled: !!(meter && meter.getAttribute('aria-label')),
        };
      }),
      // The two judgement cards, and whether either is a filled panel again.
      signals: [...page.querySelectorAll('.aicfo-signal')].map((c) => ({
        band: bandOf(c),
        bg: cs(c).backgroundColor,
        stripe: cs(c).borderInlineStartWidth || cs(c).borderLeftWidth,
      })),
      // Every control this page adds, for the thumb-target rule. Header actions
      // are covered separately by headActions.
      targets: [...page.querySelectorAll('.aicfo-figure.is-link, .aicfo-quick, .aicfo-row-btn, .aicfo-send, .aicfo-suggest-chip')]
        .map((b) => ({
          cls: (typeof b.className === 'string' ? b.className : '').split(' ')[0],
          h: +b.getBoundingClientRect().height.toFixed(1),
          w: +b.getBoundingClientRect().width.toFixed(1),
        })),
      // Money on this page must name its currency; days and scores must not.
      metrics: [...page.querySelectorAll('.cfo-summary-row > div')].map((d) => ({
        k: (d.querySelector('.cfo-summary-k') || {}).textContent?.trim() || '',
        v: (d.querySelector('.cfo-summary-v') || {}).textContent?.trim() || '',
      })),
      summaryLabel: (page.querySelector('.cfo-summary-label') || {}).textContent?.trim() || '',
      summaryValue: (page.querySelector('.cfo-summary-value') || {}).textContent?.trim() || '',
      summaryMeta: (page.querySelector('.cfo-summary-meta') || {}).textContent?.trim() || '',
      figures: [...page.querySelectorAll('.aicfo-figure')].map((f) => ({
        k: (f.querySelector('.cfo-stat-k') || {}).textContent?.trim() || '',
        v: (f.querySelector('.cfo-stat-v') || {}).textContent?.trim() || '',
        color: (() => { const el = f.querySelector('.cfo-stat-v'); return el ? cs(el).color : null; })(),
      })),
      // Present only in the no-data state.
      emptyState: (() => {
        const st = page.querySelector('.cfo-state');
        if (!st) return null;
        const sym = st.querySelector('.cfo-state-sym');
        return {
          title: (st.querySelector('.cfo-state-h') || {}).textContent?.trim() || '',
          symWidth: sym ? Math.round(sym.getBoundingClientRect().width) : 0,
          symSrc: sym ? sym.getAttribute('src') : null,
          actions: st.querySelectorAll('.cfo-state-actions button, .cfo-state-actions a').length,
        };
      })(),
      // The refresh-failure notice, present only in the stale state.
      stale: (() => {
        const n = page.querySelector('.aicfo-stale');
        if (!n) return null;
        const btn = n.querySelector('.cfo-btn');
        return {
          // Doubled backslash: this whole probe is a template literal, so a bare
          // \\s would reach the page as a literal "s" and collapse every s in the
          // notice into a space.
          text: (n.textContent || '').replace(/\\s+/g, ' ').trim(),
          role: n.getAttribute('role'),
          stripe: cs(n).borderInlineStartColor || cs(n).borderLeftColor,
          retry: btn ? { label: (btn.textContent || '').trim(), h: +btn.getBoundingClientRect().height.toFixed(1) } : null,
        };
      })(),
      // The real gap between each pair of adjacent top-level sections, measured
      // from painted rectangles rather than read off a stylesheet. .hf-page is a
      // plain block and .cfo-card carries no margin, so these were 0 until the
      // page got a single flex gap — and a box-shadow made that look like
      // spacing in a screenshot. (No backticks in here: the whole probe is a
      // template literal, and one would end it.)
      gaps: (() => {
        const kids = [...page.children].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && cs(el).display !== 'none';
        });
        const out = [];
        for (let i = 1; i < kids.length; i++) {
          const a = kids[i - 1].getBoundingClientRect();
          const b = kids[i].getBoundingClientRect();
          out.push({
            from: (typeof kids[i - 1].className === 'string' ? kids[i - 1].className : '').split(' ')[0] || kids[i - 1].tagName.toLowerCase(),
            to: (typeof kids[i].className === 'string' ? kids[i].className : '').split(' ')[0] || kids[i].tagName.toLowerCase(),
            px: Math.round(b.top - a.bottom),
          });
        }
        return out;
      })(),
      hasScoreBlock: !!num,
      cardMarks: [...page.querySelectorAll('.cfo-flagship-mark')].filter(painted).length,
      flagships: page.querySelectorAll('.cfo-flagship').length,
      // Nothing on this page may paint a gradient or a graph-paper grid again.
      gradients: [...page.querySelectorAll('*')].filter((el) => {
        const bg = cs(el).backgroundImage;
        return bg && bg !== 'none';
      }).map((el) => (typeof el.className === 'string' ? el.className : '').slice(0, 32)),
    };
  })();

  // Wallets & Accounts, measured. The list is the part of this page that had
  // never been photographed or asserted on at all — every previous check saw a
  // header and one summary card.
  const accounts = (() => {
    const page = doc.querySelector('.acct-page');
    if (!page) return null;
    const kids = [...page.children].filter((el) => el.getBoundingClientRect().height > 0);
    const gaps = [];
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      gaps.push({
        from: (typeof kids[i - 1].className === 'string' ? kids[i - 1].className : '').split(' ')[0],
        to: (typeof kids[i].className === 'string' ? kids[i].className : '').split(' ')[0],
        px: Math.round(b.top - a.bottom),
      });
    }
    return {
      gaps,
      rows: [...doc.querySelectorAll('.acct-row')].map((li) => {
        const bal = li.querySelector('.acct-row-balance');
        const sub = li.querySelector('.acct-row-sub');
        const open = li.querySelector('.acct-row-open');
        return {
          name: (li.querySelector('.acct-row-name') || {}).textContent?.trim() || '',
          balance: bal ? bal.textContent.trim() : null,
          balanceColor: bal ? cs(bal).color : null,
          missing: bal ? bal.classList.contains('is-missing') : false,
          negative: bal ? bal.classList.contains('is-neg') : false,
          sub: sub ? sub.textContent.trim() : null,
          chips: [...li.querySelectorAll('.acct-chip')].map((c) => c.textContent.trim()),
          meter: !!li.querySelector('.acct-row-meter'),
          openIsButton: !!open && open.tagName === 'BUTTON',
          openH: open ? +open.getBoundingClientRect().height.toFixed(1) : 0,
          actions: [...li.querySelectorAll('.acct-iconbtn')].map((b) => ({
            label: b.getAttribute('aria-label'),
            h: +b.getBoundingClientRect().height.toFixed(1),
          })),
          nameTruncated: (() => {
            const n = li.querySelector('.acct-row-name');
            return n ? n.scrollWidth > n.clientWidth + 1 : false;
          })(),
        };
      }),
      addMore: (() => {
        const b = doc.querySelector('.acct-addmore');
        if (!b) return null;
        const sym = b.querySelector('.acct-addmore-sym');
        const btn = b.querySelector('.cfo-btn');
        return {
          title: (b.querySelector('.acct-addmore-title') || {}).textContent?.trim() || '',
          sub: (b.querySelector('.acct-addmore-sub') || {}).textContent?.trim() || '',
          symSrc: sym ? sym.getAttribute('src') : null,
          symW: sym ? Math.round(sym.getBoundingClientRect().width) : 0,
          btnLabel: btn ? btn.textContent.trim() : null,
          btnH: btn ? +btn.getBoundingClientRect().height.toFixed(1) : 0,
          h: Math.round(b.getBoundingClientRect().height),
        };
      })(),
      zeroState: (() => {
        const st = doc.querySelector('.cfo-state');
        if (!st) return null;
        const sym = st.querySelector('.cfo-state-sym');
        return {
          title: (st.querySelector('.cfo-state-h') || {}).textContent?.trim() || '',
          symW: sym ? Math.round(sym.getBoundingClientRect().width) : 0,
          h: Math.round(st.getBoundingClientRect().height),
        };
      })(),
      filterEmpty: (() => {
        const fe = doc.querySelector('.acct-filter-empty');
        if (!fe) return null;
        return {
          title: (fe.querySelector('.acct-filter-empty-title') || {}).textContent?.trim() || '',
          sub: (fe.querySelector('.acct-filter-empty-sub') || {}).textContent?.trim() || '',
          // Doubled backslash: the probe is a template literal, so a bare \\s
          // reaches the page as a literal "s".
          text: (fe.textContent || '').replace(/\\s+/g, ' ').trim(),
        };
      })(),
      summaryMeta: (doc.querySelector('.cfo-summary-meta') || {}).textContent?.trim() || '',
      dashedAddRow: doc.querySelectorAll('[style*="dashed"]').length,
      // The Business/Personal scope filter, which /business/accounts no longer
      // has: the API already restricts the list to the active company.
      scopeTabs: doc.querySelectorAll('.acct-page [role="tablist"]').length,
      flagships: doc.querySelectorAll('.acct-page .cfo-flagship').length,
    };
  })();

  // AI Accountant. The claims worth a browser are all about what a reader sees
  // in the amount column, whether the one navy card is branded, and whether the
  // five tabs survive a phone. None of those are decidable from source text.
  const accountant = (() => {
    const page = doc.querySelector('.acct-wb');
    if (!page) return null;
    const txt = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
    const kids = [...page.children].filter((el) => el.getBoundingClientRect().height > 0);
    const gaps = [];
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      gaps.push(Math.round(b.top - a.bottom));
    }
    const card = page.querySelector('.acct-reserve .cfo-summary');
    const mark = card ? card.querySelector('.cfo-flagship-mark') : null;
    const meter = page.querySelector('.acct-meter-fill');
    const rows = [...page.querySelectorAll('.acct-list, .cfo-list')]
      .slice(0, 1)
      .flatMap((ul) => [...ul.querySelectorAll('.cfo-list-item')])
      .map((li) => {
        const amt = li.querySelector('.cfo-list-amt');
        const chip = li.querySelector('.acct-ob-state');
        return {
          label: txt(li.querySelector('.cfo-list-label')),
          sub: txt(li.querySelector('.cfo-list-sub')),
          amount: txt(amt),
          isChip: !!chip,
          chipFont: chip ? cs(chip).fontFamily.split(',')[0].replace(/"/g, '') : null,
          amtFont: amt ? cs(amt).fontFamily.split(',')[0].replace(/"/g, '') : null,
        };
      });
    const tabsWrap = page.querySelector('.acct-wb-tabs');
    const strip = tabsWrap ? tabsWrap.querySelector('.cfo-tabs') : null;
    const tabs = strip ? [...strip.querySelectorAll('.cfo-tab')] : [];
    const caveat = page.querySelector('.acct-caveat');
    return {
      sectionGaps: gaps,
      pageGap: cs(page).rowGap || cs(page).gap,
      reserve: {
        present: !!card,
        flagship: card ? card.classList.contains('cfo-flagship') : null,
        label: txt(card ? card.querySelector('.cfo-summary-label') : null),
        value: txt(card ? card.querySelector('.cfo-summary-value') : null),
        meta: txt(card ? card.querySelector('.cfo-summary-meta') : null),
        markPainted: mark ? (cs(mark).display !== 'none' && mark.getBoundingClientRect().width > 0) : false,
        markSrc: mark ? mark.getAttribute('src') : null,
        markAlt: mark ? mark.getAttribute('alt') : null,
        markAria: mark ? mark.getAttribute('aria-hidden') : null,
        safeToken: card ? cs(card).getPropertyValue('--mark-safe').trim() : null,
        safePad: card ? cs(card).paddingRight : null,
      },
      completeness: meter ? {
        width: cs(meter).width,
        bg: cs(meter).backgroundColor,
        caveat: txt(caveat),
        caveatColor: caveat ? cs(caveat).color : null,
        caveatBg: caveat ? cs(caveat).backgroundColor : null,
      } : null,
      obligations: rows,
      chipCount: page.querySelectorAll('.acct-ob-state').length,
      tabs: tabs.map((b) => txt(b)),
      tabsScrollable: strip ? strip.scrollWidth > strip.clientWidth + 1 : null,
      tabsMask: tabsWrap ? cs(tabsWrap).maskImage || cs(tabsWrap).webkitMaskImage : null,
      plainCols: (() => { const g = page.querySelector('.acct-plain-grid');
        return g ? cs(g).gridTemplateColumns.split(' ').length : null; })(),
      bandCols: (() => { const g = page.querySelector('.acct-wb-band');
        return g ? cs(g).gridTemplateColumns.split(' ').length : null; })(),
      calendarKinds: [...page.querySelectorAll('.acct-cal-day[class*="k-"]')].map((d) => ({
        day: txt(d), color: cs(d).color, bg: cs(d).backgroundColor,
        kind: (d.className.match(/k-([a-z]+)/) || [])[1] || null,
      })),
      hexInStyle: false,
    };
  })();

  const res = win.performance.getEntriesByType('resource');
  const calls = res.filter((e) => e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch')
    .map((e) => e.name);
  const suspicious = res.map((e) => e.name).filter((n) => /supabase|\\/api\\/|amazonaws|googleapis\\.com\\/(?!css)/.test(n));

  return {
    innerWidth: win.innerWidth, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
    h1Total: doc.querySelectorAll('h1').length,
    sections, overflow: overflow.slice(0, 10), overflowCount: overflow.length,
    overlaps: overlaps.slice(0, 12), overlapCount: overlaps.length,
    headActions, heads, focusRing, shell, figures, brand, idLeaks, navItems, walletsState, aicfo, accounts, accountant,
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

/**
 * Several viewports in ONE browser launch.
 *
 * Each viewport still gets its own iframe, so each still has a real, independent
 * layout viewport — that is what makes 390px and 320px genuine rather than a
 * cropped desktop. What is shared is the Chrome process. Fourteen separate
 * launches made this file take four minutes and, under `node --test` running test
 * files in parallel, made one unlucky probe time out and fail the suite at random.
 * A flaky test is worse than a slow one: it teaches people to re-run and shrug.
 */
const probeGroup = (specs) => `<!doctype html><meta charset="utf-8"><body style="margin:0">
${specs.map((sp, i) => `<iframe id="f${i}" src="${sp.route}" `
  + `style="width:${sp.w}px;height:${sp.h}px;border:0"></iframe>`).join('\n')}
<script>${PROBE_FN}
const SPECS = ${JSON.stringify(specs.map((sp) => sp.key))};
setTimeout(async () => { ${guard(`const F = {};
  for (let i = 0; i < SPECS.length; i++) {
    const win = document.getElementById('f' + i).contentWindow;
    await win.document.fonts.ready;
    F[SPECS[i]] = facts(win, win.document);
  } ${emit}`)} }, 3500);
</script></body>`;

const collectGroup = async (specs, ms = 30000) => {
  const all = await collect(probeGroup(specs), ms);
  for (const sp of specs) {
    assert.ok(all[sp.key], `probe "${sp.key}" produced no facts`);
    assert.ok(!all[sp.key].probeError, `probe "${sp.key}" threw: ${all[sp.key].probeError}`);
  }
  return all;
};

const directProbe = probeFor('/design-preview', 1440, 900);
const mobileProbe = probeFor('/design-preview', 390, 844);
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
// The catalogue and the drawer keep their own launches: the drawer one clicks a
// real control before measuring, and the catalogue pages are the heaviest.
const D = await collect(directProbe);
const M = await collect(mobileProbe);
const DRAWER = await collect(drawerProbe);

// Everything else is a shell view at some width, so it all shares two browsers.
const P = '/design-preview';
const SHELLS = await collectGroup([
  { key: 'SD', route: `${P}?shell=pulse`, w: 1440, h: 900 },
  { key: 'SM', route: `${P}?shell=accounts`, w: 390, h: 844 },
  { key: 'WP', route: `${P}?shell=accounts`, w: 1440, h: 900 },
  { key: 'WE', route: `${P}?shell=accounts-empty`, w: 1440, h: 900 },
  { key: 'WEM', route: `${P}?shell=accounts-empty`, w: 390, h: 844 },
  { key: 'WP320', route: `${P}?shell=accounts`, w: 320, h: 720 },
  { key: 'WE320', route: `${P}?shell=accounts-empty`, w: 320, h: 720 },
  // Tablet. The sidebar is gone here and the flagship card is full width, so it
  // breaks differently from both the desktop and the phone.
  { key: 'WP768', route: `${P}?shell=accounts`, w: 768, h: 1000 },
  { key: 'PULSE768', route: `${P}?shell=pulse`, w: 768, h: 1000 },
]);
// The currency cases: a dollar workspace, a workspace holding both, and a wallet
// whose currency was never set.
const CURRENCIES = await collectGroup([
  { key: 'WUSD', route: `${P}?shell=accounts-usd`, w: 1440, h: 900 },
  { key: 'WMIX', route: `${P}?shell=accounts-mixed`, w: 1440, h: 900 },
  { key: 'WMIXM', route: `${P}?shell=accounts-mixed`, w: 390, h: 844 },
  { key: 'WNOC', route: `${P}?shell=accounts-nocur`, w: 1440, h: 900 },
  { key: 'W4', route: `${P}?shell=accounts-four`, w: 1440, h: 900 },
  { key: 'W4M', route: `${P}?shell=accounts-four`, w: 390, h: 844 },
  /* AI CFO, in the app frame: the populated page at desktop and at a genuine
     390px, the risk state — where every semantic band is on screen at once —
     and the no-data state, which is the one that has to withhold a verdict.

     Deliberately folded into THIS group rather than given one of its own. Each
     collectGroup is one browser launch, and `node --test` runs test files in
     parallel, so a fourth launch competing for the same CPU pushed this file
     past collect()'s 120s kill — it passed alone and failed in the suite. Fewer
     launches is the strategy this file already documents; a group holds many
     viewports in one browser precisely so a new page costs an iframe, not a
     process. */
  { key: 'CD', route: `${P}?shell=ai-cfo`, w: 1440, h: 900 },
  { key: 'CM', route: `${P}?shell=ai-cfo`, w: 390, h: 844 },
  { key: 'CR', route: `${P}?shell=ai-cfo-risk`, w: 1440, h: 900 },
  { key: 'CRM', route: `${P}?shell=ai-cfo-risk`, w: 390, h: 844 },
  { key: 'CE', route: `${P}?shell=ai-cfo-empty`, w: 1440, h: 900 },
  { key: 'CS', route: `${P}?shell=ai-cfo-stale`, w: 1440, h: 900 },
], 45000);
const { SD, SM, WP, WE, WEM, WP320, WE320, WP768, PULSE768 } = SHELLS;
const { WUSD, WMIX, WMIXM, WNOC, W4, W4M } = CURRENCIES;
const { CD, CM, CR, CRM, CE, CS } = CURRENCIES;
/* Wallets & Accounts. Its own group, and the reason is coverage rather than
   taste: this page's list had never been rendered in a test at all. */
const ACCOUNTS = await collectGroup([
  { key: 'AD', route: `${P}?shell=accounts`, w: 1440, h: 900 },
  { key: 'AM', route: `${P}?shell=accounts`, w: 390, h: 844 },
  { key: 'AS', route: `${P}?shell=accounts-stress`, w: 1440, h: 900 },
  { key: 'A320', route: `${P}?shell=accounts-stress`, w: 320, h: 900 },
  { key: 'AE', route: `${P}?shell=accounts-empty`, w: 1440, h: 900 },
], 45000);
const { AD, AM, AS, A320, AE } = ACCOUNTS;
/* AI Accountant. Folded into ONE further launch rather than several, for the
   reason this file already documents: each collectGroup is a browser, node --test
   runs files in parallel, and a launch too many pushes the suite past the kill
   timeout. A viewport costs an iframe here, not a process.

   The three obligation fixtures are the point: the state production is in (no
   amount anywhere), one real amount, and a CONFIRMED zero. Those three are the
   only way to prove the em dash is absence and the zero is a zero. */
const ACCOUNTANT = await collectGroup([
  { key: 'NAD', route: `${P}?shell=accountant`, w: 1440, h: 900 },
  { key: 'NAM', route: `${P}?shell=accountant`, w: 390, h: 844 },
  { key: 'NA320', route: `${P}?shell=accountant`, w: 320, h: 900 },
  { key: 'NCALC', route: `${P}?shell=accountant-calc`, w: 1440, h: 900 },
  { key: 'NZERO', route: `${P}?shell=accountant-zero`, w: 1440, h: 900 },
  { key: 'NCAL', route: `${P}?shell=accountant-calendar`, w: 1440, h: 900 },
  { key: 'NCALM', route: `${P}?shell=accountant-calendar`, w: 390, h: 844 },
  { key: 'NDRAFT', route: `${P}?shell=accountant-draft`, w: 1440, h: 900 },
], 45000);
const { NAD, NAM, NA320, NCALC, NZERO, NCAL, NCALM, NDRAFT } = ACCOUNTANT;
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

t('a page hero shows one mark when it has room, and yields it to the controls otherwise', () => {
  // The decorative page-hero mark is exactly that — decorative. A header with no
  // control zone reserves its column and shows one mark; a header carrying badges,
  // context or actions holds its natural right edge and drops the mark rather than
  // sit a symbol behind a button. So the count is one per bare hero, zero per
  // action hero — never two, and never one competing with a control.
  assert.ok(D.heads.length > 0, 'no page hero rendered');
  assert.strictEqual(D.heads.length, D.headMarks.length, 'heads/headMarks out of step');
  D.heads.forEach((h, i) => {
    const n = D.headMarks[i];
    if (h.right) {
      assert.strictEqual(n, 0,
        `an action header painted ${n} hero mark(s); a header with controls must drop the mark`);
    } else {
      assert.strictEqual(n, 1,
        `a bare header painted ${n} hero marks; a header with room gets exactly one`);
    }
  });
  // At least one of each kind is on the catalogue, or the rule is only half-tested.
  assert.ok(D.heads.some((h) => h.right), 'no action header in the catalogue to test the yield');
  assert.ok(D.heads.some((h) => !h.right), 'no bare header in the catalogue to test the mark');
  // The product's main page (Pulse) is a bare hero, so exactly one mark on screen.
  assert.strictEqual(SD.brand.heroMarks, 1,
    `${SD.brand.heroMarks} marks painted in the app shell; a bare hero shows exactly one`);
});

/* ── the flagship watermark ─────────────────────────────────────────────────
   The product carries two branding layers on purpose, and they are deliberately
   unequal: an ambient mark in the page hero, and a stronger cropped one on the
   single navy card that carries the page's headline money figure. Everything
   below pins that down, because "one faint logo" is the kind of claim that
   quietly becomes two logos, or a tiled background, or a symbol under the number.

   The assertion that stood here queried .cfo-summary-sym and .pulse-cash-mark,
   classes that no longer exist anywhere in the product, so it counted zero
   whatever was on screen and passed vacuously. */

t('each flagship financial card carries exactly one brand mark', () => {
  for (const [name, f] of [['isolated', D], ['mobile', M], ['shell', SD], ['shell mobile', SM]]) {
    assert.ok(f.brand.flagships.length > 0, `${name}: no flagship card on the page at all`);
    for (const c of f.brand.flagships) {
      assert.strictEqual(c.marks, 1,
        `${name}: ${c.cls} paints ${c.marks} marks; a flagship card gets exactly one`);
      assert.strictEqual(c.painted, true, `${name}: ${c.cls} has a mark that never renders`);
    }
    assert.strictEqual(f.brand.cardMarks, f.brand.flagships.length,
      `${name}: ${f.brand.cardMarks} marks across ${f.brand.flagships.length} flagship cards`);
  }
});

t('the watermark is opt-in: an ordinary summary card has none', () => {
  // The previous implementation defaulted the symbol ON for every SummaryCard, so
  // every page using one got branding it never asked for. The design preview
  // renders a plain card beside a flagship one precisely so this is checkable
  // rather than asserted in a comment.
  for (const [name, f] of [['isolated', D], ['mobile', M]]) {
    assert.ok(f.brand.plainSummaries.length > 0,
      `${name}: no un-opted-in SummaryCard on the page, so opt-in is untested`);
    for (const c of f.brand.plainSummaries) {
      assert.strictEqual(c.marks, 0, `${name}: a plain SummaryCard is painting a brand mark`);
      assert.strictEqual(c.imgs, 0, `${name}: a plain SummaryCard is painting an image`);
    }
  }
});

t('Pulse and Accounts get the watermark from the same shared implementation', () => {
  // Pulse's total cash is a hand-built .pulse-cash card and Accounts' total
  // balance is the shared SummaryCard, so "the same" cannot mean the same element
  // — it means both wear .cfo-flagship and take every number from it. These two
  // navy heroes have diverged once already: one drew the symbol, the other drew a
  // graph-paper grid.
  const pulse = D.brand.flagships.find((c) => c.cls.includes('pulse-cash'));
  const acct = D.brand.flagships.find((c) => c.cls.includes('cfo-summary'));
  assert.ok(pulse, 'no .pulse-cash flagship card rendered');
  assert.ok(acct, 'no .cfo-summary flagship card rendered');
  for (const c of [pulse, acct]) {
    assert.match(c.cls, /cfo-flagship/, `${c.cls} does not wear the shared class`);
  }
  assert.strictEqual(pulse.src, acct.src,
    `Pulse draws ${pulse.src} and Accounts draws ${acct.src}`);
  assert.strictEqual(pulse.opacity, acct.opacity,
    `Pulse is at ${pulse.opacity} and Accounts at ${acct.opacity}`);
  assert.strictEqual(pulse.sizeToken, acct.sizeToken,
    `--mark-size is ${pulse.sizeToken} on Pulse and ${acct.sizeToken} on Accounts`);
  assert.strictEqual(pulse.safeToken, acct.safeToken,
    `--mark-safe is ${pulse.safeToken} on Pulse and ${acct.safeToken} on Accounts`);
});

t('the flagship mark is decorative and absent from the accessibility tree', () => {
  for (const [name, f] of [['isolated', D], ['mobile', M], ['shell', SD], ['shell mobile', SM]]) {
    for (const c of f.brand.flagships) {
      assert.strictEqual(c.alt, '', `${name}: ${c.cls} mark has alt="${c.alt}", not an empty alt`);
      assert.strictEqual(c.ariaHidden, 'true', `${name}: ${c.cls} mark is not aria-hidden`);
    }
  }
});

t('the flagship mark is one symbol, never a repeating pattern', () => {
  for (const [name, f] of [['isolated', D], ['mobile', M], ['shell', SD], ['shell mobile', SM]]) {
    for (const c of f.brand.flagships) {
      assert.strictEqual(c.bgImage, 'none',
        `${name}: ${c.cls} mark is painted as a background image (${c.bgImage}) — that is how tiling gets in`);
      assert.match(c.src, /^\/brand\//,
        `${name}: ${c.cls} mark is ${c.src}, not an official asset from /brand`);
      assert.match(c.src, /symbol_/,
        `${name}: the card mark should be the standalone symbol, not ${c.src}`);
    }
  }
});

t('the flagship mark is cropped by the card edge and clear of every figure', () => {
  for (const [name, f] of [['isolated', D], ['shell', SD]]) {
    for (const c of f.brand.flagships) {
      assert.ok(c.cropped > 0,
        `${name}: ${c.cls} mark stops ${-c.cropped}px inside the card — a sticker, not a watermark`);
      assert.ok(c.safeGap > 0,
        `${name}: ${c.cls} leaves ${c.safeGap}px between the content and the mark; text would sit on it`);
      // Cropped on the right only. A card shorter than the mark used to clip it
      // top and bottom as well, which stopped it reading as a symbol at all.
      assert.ok(c.markH <= c.h,
        `${name}: ${c.cls} mark is ${c.markH}px tall in a ${c.h}px card — it is clipped vertically`);
      assert.strictEqual(c.zIndex, '-1',
        `${name}: ${c.cls} mark is at z-index ${c.zIndex}; only a negative index puts it structurally behind the text`);
    }
  }
});

t('on a phone the mark is smaller, fainter, and still clear of the figure', () => {
  for (const [name, f] of [['mobile', M], ['shell mobile', SM]]) {
    for (const c of f.brand.flagships) {
      assert.ok(c.markW >= 60 && c.markW <= 110,
        `${name}: ${c.cls} mark is ${c.markW}px on a phone; the intended range is 70-100`);
      assert.ok(c.opacity <= 0.06,
        `${name}: ${c.cls} mark is at ${c.opacity} on a phone, louder than the 4-6% intended`);
      assert.ok(c.safeGap > 0,
        `${name}: ${c.cls} leaves ${c.safeGap}px of text-safe area on a phone`);
    }
  }
  const deskOp = D.brand.flagships[0].opacity, mobOp = M.brand.flagships[0].opacity;
  assert.ok(mobOp < deskOp, `the phone mark (${mobOp}) is not quieter than the desktop one (${deskOp})`);
  assert.ok(M.brand.flagships[0].markW < D.brand.flagships[0].markW,
    'the phone mark is not smaller than the desktop one');
});

t('the two branding layers are independent, and the hero is the weaker one', () => {
  const hero = D.brand.heroMark, card = D.brand.flagships[0];
  assert.ok(hero, 'no page-hero mark on the desktop page');
  assert.ok(card, 'no flagship card mark on the desktop page');
  // Different assets: navy on the pale band, white on the navy card.
  assert.notStrictEqual(hero.src, card.src,
    `both layers draw ${hero.src}; the navy card needs the white symbol`);
  assert.match(hero.src, /symbol_navy/, `the hero mark is ${hero.src}`);
  assert.match(card.src, /symbol_white/, `the card mark is ${card.src}`);
  // The hero is ambient; the card is the brand moment. Navy on a pale ground
  // carries further than white on navy, so equal opacity is not equal presence.
  assert.ok(hero.opacity < card.opacity,
    `the hero mark (${hero.opacity}) is not fainter than the card mark (${card.opacity})`);
  assert.ok(hero.opacity <= 0.04,
    `the hero mark is at ${hero.opacity}; the page-level mark is meant to sit at 3-4%`);
  // Independent: the phone drops the hero mark and keeps the card's.
  assert.strictEqual(M.brand.heroMark, null, 'the page-hero mark is still painted on a phone');
  assert.ok(M.brand.cardMarks > 0, 'the phone dropped the flagship card mark as well');
});

t('the page-hero mark is never cropped by its own band', () => {
  // The opposite treatment to the card's, and the difference is the point: the
  // hero mark is whole with clear space, the card mark runs off the edge. A
  // header with no eyebrow is only ~133px tall, and a fixed 132px mark filled it
  // edge to edge and read as clipped.
  for (const [name, f] of [['isolated', D], ['shell', SD]]) {
    const h = f.brand.heroMark;
    assert.ok(h, `${name}: no page-hero mark`);
    assert.ok(h.clearTop >= 8, `${name}: only ${h.clearTop}px of clear space above the hero mark`);
    assert.ok(h.clearBottom >= 8, `${name}: only ${h.clearBottom}px of clear space below the hero mark`);
    assert.ok(h.clearRight >= 8, `${name}: only ${h.clearRight}px between the hero mark and the band edge`);
    assert.strictEqual(h.alt, '', `${name}: the hero mark has alt="${h.alt}"`);
    assert.strictEqual(h.ariaHidden, 'true', `${name}: the hero mark is not aria-hidden`);
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

/* ── AI CFO ────────────────────────────────────────────────────────────────
   Measured in the app frame, because this page's claims are claims about
   pixels: that the score is legible without shouting, that green appears only
   where something is genuinely healthy, that a warning does not read as a
   system error, and that a 390px phone shows all of it without a sideways
   scroll. The structural half of these lives in designPreview.test.mjs. */
console.log('\nAI CFO — the migrated page');

const CFO_VIEWS = [['desktop', CD], ['390px', CM], ['risk', CR], ['risk 390px', CRM],
  ['no data', CE], ['stale', CS]];

t('every AI CFO view rendered', () => {
  for (const [name, f] of CFO_VIEWS) {
    assert.ok(f.aicfo, `the ${name} view did not render the AI CFO page`);
  }
});

t('the page has exactly one <h1>, from the shared header', () => {
  for (const [name, f] of CFO_VIEWS) {
    assert.strictEqual(f.h1Total, 1, `${name}: ${f.h1Total} h1 elements, expected 1`);
  }
  // The catalogue sections each own one too.
  for (const id of ['ai-cfo', 'ai-cfo-risk', 'ai-cfo-empty', 'ai-cfo-partial']) {
    assert.strictEqual(D.sections[id]?.h1, 1, `section ${id} h1 count = ${D.sections[id]?.h1}`);
  }
});

t('one flagship card, wearing one shared watermark', () => {
  for (const [name, f] of CFO_VIEWS) {
    assert.strictEqual(f.aicfo.flagships, 1, `${name}: ${f.aicfo.flagships} flagship cards, expected 1`);
    assert.strictEqual(f.aicfo.cardMarks, 1, `${name}: ${f.aicfo.cardMarks} watermarks, expected 1`);
  }
});

t('the watermark is the official symbol and is absent from the accessibility tree', () => {
  // Both facts already hold for Pulse, Accounts and Radar; this asserts AI CFO
  // gets them from the same component rather than a copy.
  const mk = CD.brand.flagships.find((c) => c.src);
  assert.ok(mk, 'no flagship mark measured on the AI CFO page');
  assert.match(mk.src, /symbol_white_transparent\.svg$/,
    `the flagship mark is ${mk.src}, not the official white symbol`);
  assert.strictEqual(mk.alt, '', `the mark carries alt="${mk.alt}" — it is decoration`);
  assert.strictEqual(mk.ariaHidden, 'true', 'the mark is not hidden from assistive technology');
  // Cropped by the card's right edge, and clear of everything anyone reads —
  // the same treatment Pulse, Accounts and Radar get, from the same primitive.
  assert.ok(mk.cropped > 0, `the mark is not cropped by the card edge (${mk.cropped}px)`);
  assert.ok(mk.safeGap >= 0, `the mark sits ${mk.safeGap}px into the content`);
});

t('nothing on the page paints a gradient or a graph-paper grid', () => {
  // The removed .hf-dark-card drew a #0F172A gradient with two
  // repeating-linear-gradients over it. Asserted against COMPUTED style, so it
  // catches the treatment coming back from anywhere, not just from this source.
  for (const [name, f] of CFO_VIEWS) {
    assert.deepStrictEqual(f.aicfo.gradients, [],
      `${name}: background images painted on ${f.aicfo.gradients.join(', ')}`);
  }
});

t('money names its currency; days and the score do not', () => {
  const m = CD.aicfo;
  // The headline figure and its exact companion.
  assert.match(m.summaryValue, /^Rp /, `the headline reads "${m.summaryValue}" with no currency`);
  assert.match(m.summaryMeta, /Rp /, `the exact figure reads "${m.summaryMeta}" with no currency`);
  assert.match(m.summaryLabel, /^Cash · /, `the card label reads "${m.summaryLabel}"`);
  const by = (k) => (m.metrics.find((x) => new RegExp(k, 'i').test(x.k)) || {}).v || '';
  // Runway is a count of days. A currency in front of it would be nonsense.
  assert.match(by('runway'), /^\d+ days$/, `runway reads "${by('runway')}"`);
  assert.ok(!/Rp/.test(by('runway')), `runway reads "${by('runway')}" — days took a currency`);
  // Net per month is money, and carries its sign in front of the currency.
  assert.match(by('net'), /^[+−]Rp /, `net per month reads "${by('net')}"`);
  // The question allowance is a count, not money, and is labelled as an
  // allowance rather than a remaining count that the product cannot measure.
  const q = m.metrics.find((x) => /question/i.test(x.k));
  assert.ok(q, `no AI question metric on the card: ${JSON.stringify(m.metrics)}`);
  // The product does not measure usage — usage.ai_questions_this_month is
  // hardcoded to 0 server-side — so this figure is the PLAN'S LIMIT and has to
  // say so. Anything implying a remainder is a claim nothing can back.
  assert.match(q.k, /limit|month/i,
    `the AI question metric is labelled "${q.k}", which names neither a limit nor a period`);
  assert.ok(!/remaining|\bleft\b/i.test(q.k),
    `the AI question metric says "${q.k}", which claims a remainder`);
  assert.ok(!/Rp/.test(q.v), `the question allowance reads "${q.v}" — a count took a currency`);
  // The four operating figures each name their currency and carry a sign.
  for (const f of m.figures) {
    assert.match(f.v, /^[+−]Rp /, `the ${f.k} figure reads "${f.v}"`);
  }
  // And the score is a score.
  assert.match(m.score.text, /^\d+$/, `the CFO score reads "${m.score.text}"`);
});

t('the CFO Score is present but no longer competes with the headline figure', () => {
  // It was 34px... at weight 900 and 32px directly beneath the hero, which gave
  // the page two headline figures and therefore no subject. The flagship value
  // must stay the largest number on the page.
  const heroFont = CD.figures.find((f) => /cfo-summary-value/.test(f.cls));
  assert.ok(heroFont, 'the flagship value was not measured');
  assert.ok(CD.aicfo.hasScoreBlock, 'the CFO Score block is missing');
  assert.match(CD.aicfo.score.text, /^\d+$/, 'the CFO Score is not a number');
});

t('a factor is coloured by its impact, and the bar agrees with the number', () => {
  // The engine sends impact separately from score. "No payables" is 90/positive
  // and "Runway adequate (30+ days)" is 70/neutral — colouring by score would
  // paint the second green.
  for (const [name, f] of CFO_VIEWS) {
    if (!f.aicfo.factors.length) continue;
    for (const fa of f.aicfo.factors) {
      assert.strictEqual(fa.band, fa.scoreBand,
        `${name}: the ${fa.name} bar is ${fa.band} but its score is ${fa.scoreBand}`);
      assert.ok(fa.labelled, `${name}: the ${fa.name} bar has no accessible label`);
    }
  }
  // The healthy view: the neutral runway factor must NOT be green.
  const runway = CD.aicfo.factors.find((x) => /runway/i.test(x.name));
  assert.ok(runway, 'no runway factor rendered');
  assert.strictEqual(runway.band, 'neutral',
    `a 70/neutral runway factor is painted ${runway.band}`);
});

t('the bar fill is the value, not a decoration', () => {
  // A bar that does not track its number is worse than no bar.
  for (const fa of [...CD.aicfo.factors, ...CR.aicfo.factors]) {
    const n = Number(fa.score);
    assert.ok(Math.abs(fa.pct - n) <= 2,
      `the ${fa.name} bar is ${fa.pct}% wide for a score of ${n}`);
  }
});

t('every band the page can paint is legible, and each is a different colour', () => {
  // The risk view puts a critical score, four negative or warning factors and a
  // critical alert on screen at once. Distinct colours, or the encoding is not
  // an encoding.
  const bands = new Set(CR.aicfo.factors.map((f) => f.band));
  assert.ok(bands.has('critical'), `the risk view has no critical factor: ${[...bands].join(', ')}`);
  assert.ok(bands.has('attention'), `the risk view has no attention factor: ${[...bands].join(', ')}`);
  const fills = new Set(CR.aicfo.factors.map((f) => f.fill));
  assert.ok(fills.size >= 2, `every factor bar is the same colour: ${[...fills].join(', ')}`);
  assert.strictEqual(CR.aicfo.score.band, 'critical',
    `a score of ${CR.aicfo.score.text} is painted ${CR.aicfo.score.band}`);
});

t('green appears only where something is genuinely healthy', () => {
  // The whole rule in one assertion: in a business with a critical score, four
  // negative factors and overdue debt on both sides, nothing may be green.
  const green = CR.aicfo.factors.filter((f) => f.band === 'healthy');
  assert.deepStrictEqual(green.map((f) => f.name), [],
    `a business in difficulty shows ${green.length} green factor(s): ${green.map((f) => f.name).join(', ')}`);
  assert.notStrictEqual(CR.aicfo.score.band, 'healthy', 'a critical score is painted healthy');
});

t('a warning does not read as a system error', () => {
  // The alert and hiring cards were solid tinted panels — a filled amber block
  // for a warning, a filled red one for "Not recommended". They are ordinary
  // cards with a stripe now: the card ground stays the card ground.
  assert.ok(CR.aicfo.signals.length >= 2,
    `expected two judgement cards, found ${CR.aicfo.signals.length}`);
  const cardBg = new Set(CD.aicfo.signals.map((s) => s.bg));
  for (const s of CR.aicfo.signals) {
    assert.ok(cardBg.has(s.bg),
      `a ${s.band} card is filled with ${s.bg} while a healthy one is ${[...cardBg].join(', ')}`);
    // The severity is carried, just not by flooding the card.
    if (s.band !== 'neutral') {
      assert.ok(parseFloat(s.stripe) >= 2,
        `a ${s.band} card has a ${s.stripe} stripe — the severity is not shown at all`);
    }
  }
});

t('the no-data state withholds the verdict instead of showing a score of 72', () => {
  // The engine scores an untouched workspace at 72 out of 100 and calls its
  // payables excellent. The fixture behind this view carries that real 72.
  assert.strictEqual(CE.aicfo.hasScoreBlock, false,
    'the no-data view still presents a CFO Score');
  assert.strictEqual(CE.aicfo.factors.length, 0,
    `the no-data view still shows ${CE.aicfo.factors.length} scored factors`);
  assert.strictEqual(CE.aicfo.figures.length, 0,
    'the no-data view still shows the operating figures as if they were measurements');
  // Cash stays, because zero cash with zero wallets is true rather than absent.
  assert.match(CE.aicfo.summaryValue, /^Rp /,
    `the no-data view dropped the cash card: "${CE.aicfo.summaryValue}"`);
});

t('every top-level section is separated by ONE gap, in every state', () => {
  // The defect this pins: .hf-page is a plain block with padding and no gap, and
  // .cfo-card carries no margin, so the flagship card and the CFO Score below it
  // sat flush — the apparent gap in a screenshot was the card's own box-shadow.
  // Everything else was spaced by whichever margin a block happened to bring, so
  // the rhythm changed with which sections a state rendered.
  const BAND = [16, 20];
  // The shared PageHeader owns the space beneath itself (.cfo-pagehead carries
  // its own padding-bottom + margin-bottom in shell.css, and Pulse, Accounts and
  // Radar all sit on it). That rhythm belongs to the design system, not to this
  // page, so it is asserted separately below rather than flattened to match.
  const between = (f) => f.aicfo.gaps.filter((g) => !g.from.includes('pagehead'));
  for (const [name, f] of CFO_VIEWS) {
    const gaps = between(f);
    assert.ok(gaps.length > 0, `${name}: no sections measured`);
    for (const g of gaps) {
      assert.ok(g.px >= BAND[0] && g.px <= BAND[1],
        `${name}: ${g.from} → ${g.to} is ${g.px}px, outside ${BAND[0]}-${BAND[1]}px`);
    }
    // One gap, not a range of them.
    const distinct = [...new Set(gaps.map((g) => g.px))];
    assert.strictEqual(distinct.length, 1,
      `${name}: sections are separated by ${distinct.join('px, ')}px — the rhythm is not uniform`);
  }
});

t('the page header keeps the shared system spacing, and is not tighter than the sections', () => {
  // A header closer to the page than its sections are to each other would read
  // as part of the first section.
  for (const [name, f] of CFO_VIEWS) {
    const head = f.aicfo.gaps.find((g) => g.from.includes('pagehead'));
    if (!head) continue;
    const section = f.aicfo.gaps.find((g) => !g.from.includes('pagehead'));
    assert.ok(head.px >= section.px,
      `${name}: the header sits ${head.px}px above the page but sections are ${section.px}px apart`);
  }
});

t('the two sequences with no card between them are spaced too', () => {
  // flagship → score, and flagship → empty state → chat. These are the pairs a
  // margin-based approach missed, because neither side owned a margin.
  const pairOf = (f, from, to) => f.aicfo.gaps.find(
    (g) => g.from.includes(from) && g.to.includes(to));

  const scoreGap = pairOf(CD, 'cfo-summary', 'cfo-card');
  assert.ok(scoreGap, `flagship → score not found among ${JSON.stringify(CD.aicfo.gaps)}`);
  assert.ok(scoreGap.px >= 16 && scoreGap.px <= 20,
    `flagship → score is ${scoreGap.px}px`);

  // The no-data state: flagship → empty state → chat.
  const emptyGap = pairOf(CE, 'cfo-summary', 'cfo-state');
  assert.ok(emptyGap, `flagship → empty not found among ${JSON.stringify(CE.aicfo.gaps)}`);
  assert.ok(emptyGap.px >= 16 && emptyGap.px <= 20, `flagship → empty is ${emptyGap.px}px`);
  const chatGap = pairOf(CE, 'cfo-state', 'cfo-card');
  assert.ok(chatGap, `empty → chat not found among ${JSON.stringify(CE.aicfo.gaps)}`);
  assert.ok(chatGap.px >= 16 && chatGap.px <= 20, `empty → chat is ${chatGap.px}px`);
});

t('a failed refresh keeps the figures AND says they are the previous ones', () => {
  // The three things that have to be simultaneously true, because any two
  // without the third is a different bug:
  //   1. the figures are still on screen (not blanked, not redrawn as zeros),
  //   2. the page says they are from the last successful load, and
  //   3. there is a way to try again.
  const st = CS.aicfo.stale;
  assert.ok(st, 'no stale-data notice in the refresh-failure state');
  // 1 — the flagship figure survived the failed refresh untouched.
  assert.strictEqual(CS.aicfo.summaryValue, CD.aicfo.summaryValue,
    `the figures changed when a refresh failed: "${CD.aicfo.summaryValue}" became "${CS.aicfo.summaryValue}"`);
  assert.ok(CS.aicfo.hasScoreBlock, 'a failed refresh threw away the CFO Score');
  assert.strictEqual(CS.aicfo.factors.length, CD.aicfo.factors.length,
    'a failed refresh dropped some of the factors');
  // Emphatically not zeros.
  assert.ok(!/Rp 0$/.test(CS.aicfo.summaryValue),
    'a failed refresh redrew the cash figure as zero');
  // 2 — and it says so, in words, not just by printing an error code.
  assert.match(st.text, /last successful load/i,
    `the notice reads "${st.text}" — it does not say the figures are the previous ones`);
  assert.strictEqual(st.role, 'alert', 'the notice is not announced to assistive technology');
  // 3 — with a retry the reader can actually hit.
  assert.ok(st.retry, 'the stale notice offers no way to try again');
  assert.ok(st.retry.h >= 36, `the retry is ${st.retry.h}px tall`);
});

t('the stale notice is a warning, not an error — nothing is wrong with the figures', () => {
  // Red would say the numbers are bad. They are not; they are old.
  const st = CS.aicfo.stale;
  const critical = CR.aicfo.signals.find((x) => x.band === 'critical');
  assert.ok(critical, 'no critical card measured to compare against');
  assert.notStrictEqual(st.stripe, critical.stripe,
    `the stale notice is painted the same colour as a critical alert (${st.stripe})`);
});

t('the empty state offers a next action, at the symbol\'s normal size', () => {
  const st = CE.aicfo.emptyState;
  assert.ok(st, 'the no-data view has no empty state');
  assert.ok(st.title.length > 0, 'the empty state has no heading');
  assert.ok(st.actions >= 1, 'the empty state offers nothing to do next');
  assert.match(st.symSrc || '', /\/brand\/symbol_[a-z_]+\.svg$/,
    `the empty state symbol is ${st.symSrc}, not an official brand asset`);
  // Not the rejected page-sized-logo pattern: this is the size every other
  // empty state in the product uses.
  assert.ok(st.symWidth > 0 && st.symWidth <= 96,
    `the empty-state symbol is ${st.symWidth}px wide — that is decoration, not a symbol`);
});

console.log('\nAI CFO — 390px');

t('the phone viewport is genuinely 390 CSS pixels', () => {
  for (const [name, f] of [['ai-cfo', CM], ['ai-cfo risk', CRM]]) {
    assert.strictEqual(f.innerWidth, 390, `${name}: innerWidth = ${f.innerWidth}, expected 390`);
  }
});

t('nothing scrolls sideways and nothing overflows at 390px', () => {
  for (const [name, f] of [['ai-cfo', CM], ['ai-cfo risk', CRM]]) {
    assert.ok(f.scrollWidth <= f.clientWidth,
      `${name}: scrollWidth ${f.scrollWidth} > clientWidth ${f.clientWidth}`);
    assert.strictEqual(f.overflowCount, 0,
      `${name}: ${f.overflowCount} overflowing element(s): ${JSON.stringify(f.overflow)}`);
  }
});

t('no figure on the page is clipped, at any width', () => {
  for (const [name, f] of CFO_VIEWS) {
    for (const fig of f.figures) {
      assert.strictEqual(fig.truncated, false,
        `${name}: "${fig.text}" (.${fig.cls}) is clipped: needs ${fig.scrollW}px, has ${fig.clientW}px`);
    }
  }
});

t('the watermark sits behind nothing anyone has to read', () => {
  for (const [name, f] of CFO_VIEWS) {
    assert.strictEqual(f.overlapCount, 0, `${name}: ${overlapReport(f)}`);
  }
});

t('every control the page adds is a 44px thumb target', () => {
  for (const [name, f] of [['390px', CM], ['risk 390px', CRM], ['desktop', CD]]) {
    for (const b of f.aicfo.targets) {
      assert.ok(b.h >= 36, `${name}: a .${b.cls} control is ${b.h}px tall`);
    }
    // The row-level and card-level controls carry the full 44px; the suggestion
    // chips are a wrapped list of short phrases and sit at 36px by design, the
    // same height the product's other chip rows use.
    for (const b of f.aicfo.targets.filter((x) => x.cls !== 'aicfo-suggest-chip')) {
      assert.ok(b.h >= 44, `${name}: a .${b.cls} control is ${b.h}px tall, under the 44px target`);
    }
  }
});

t('Refresh stays reachable and does not push the title around', () => {
  // The product's control height on desktop, a full thumb target on a phone.
  for (const [name, f, min] of [['desktop', CD, 36], ['390px', CM, 44]]) {
    const acts = f.headActions;
    assert.strictEqual(acts.length, 1, `${name}: ${acts.length} header actions, expected just Refresh`);
    assert.match(acts[0].txt, /Refresh/i, `${name}: the header action is "${acts[0].txt}"`);
    assert.ok(acts[0].h >= min, `${name}: Refresh is ${acts[0].h}px tall, under the ${min}px target`);
  }
  // The header keeps its two zones on one row on desktop, so the button cannot
  // displace the heading.
  const head = CD.heads[0];
  assert.ok(head, 'no page hero rendered on the AI CFO page');
  assert.strictEqual(head.sameRow, true, 'Refresh dropped onto its own row on desktop');
});

/* ── Wallets & Accounts ────────────────────────────────────────────────────
   The list is what this page is, and it had never been measured — or
   photographed — because the preview rendered a header and a summary card and
   nothing else. These assert the list itself. */
console.log('\nWallets & Accounts — the list');

const ACCT_VIEWS = [['desktop', AD], ['390px', AM], ['stress', AS], ['320px', A320]];

t('every Accounts view rendered a page', () => {
  for (const [name, f] of ACCT_VIEWS) {
    assert.ok(f.accounts, `the ${name} view did not render the Accounts page`);
  }
});

t('the wallet list is on screen, not just the summary card', () => {
  // The regression this whole split exists to prevent: a screenshot of the
  // summary card being taken for a screenshot of the page.
  assert.strictEqual(AD.accounts.rows.length, 4, `desktop shows ${AD.accounts.rows.length} wallet rows`);
  assert.strictEqual(AS.accounts.rows.length, 6, `the stress view shows ${AS.accounts.rows.length} rows`);
  for (const [name, f] of ACCT_VIEWS) {
    assert.ok(f.accounts.rows.length > 0, `${name}: the wallet list is missing`);
  }
});

t('one gap between sections, 16-20px, in every state', () => {
  // .hf-page is a plain block and .cfo-card has no margin, so the page was
  // spaced by whichever margin each block happened to carry.
  const between = (f) => f.accounts.gaps.filter((g) => !g.from.includes('pagehead'));
  for (const [name, f] of ACCT_VIEWS) {
    const gaps = between(f);
    assert.ok(gaps.length > 0, `${name}: no sections measured`);
    for (const g of gaps) {
      assert.ok(g.px >= 16 && g.px <= 20,
        `${name}: ${g.from} → ${g.to} is ${g.px}px, outside 16-20px`);
    }
  }
});

t('a row keeps name, currency, type, scope, balance and both actions', () => {
  const row = AD.accounts.rows[0];
  assert.ok(row.name.length > 0, 'a row has no name');
  assert.strictEqual(row.chips.length, 3,
    `a row shows ${row.chips.length} chips, expected currency + type + scope: ${row.chips.join(', ')}`);
  assert.ok(/^IDR$/.test(row.chips[0]), `the first chip is "${row.chips[0]}", not a currency`);
  assert.ok(/Business|Personal/.test(row.chips[2]), `the scope chip reads "${row.chips[2]}"`);
  assert.match(row.balance, /^Rp /, `the balance reads "${row.balance}" with no currency`);
  assert.strictEqual(row.actions.length, 2, `a row has ${row.actions.length} actions, expected 2`);
  for (const a of row.actions) {
    assert.ok(a.label && a.label.length > 0, 'a row action has no accessible name');
  }
});

t('a row is reachable from a keyboard, at a thumb-sized target', () => {
  // It was a <div> with onClick and the two action buttons nested inside it —
  // unreachable by keyboard, and invalid nesting besides.
  for (const [name, f] of ACCT_VIEWS) {
    for (const row of f.accounts.rows) {
      assert.ok(row.openIsButton, `${name}: the row "${row.name}" is not a button`);
      assert.ok(row.openH >= 44, `${name}: the row "${row.name}" is ${row.openH}px tall`);
      for (const a of row.actions) {
        assert.ok(a.h >= 36, `${name}: an action on "${row.name}" is ${a.h}px tall`);
      }
    }
  }
});

console.log('\nWallets & Accounts — what a balance may say');

t('an unavailable balance is a dash, never a zero and never red', () => {
  // The rule the currency contract exists for. A wallet whose unit cannot be
  // vouched for prints no amount at all; it must not fall back to Rp 0, which
  // would be a claim about money, nor to red, which would read as a negative.
  const unavailable = AS.accounts.rows.filter((r) => r.missing);
  assert.strictEqual(unavailable.length, 2,
    `expected 2 unprovable balances in the stress view, found ${unavailable.length}`);
  for (const r of unavailable) {
    assert.strictEqual(r.balance, '—', `"${r.name}" prints "${r.balance}"`);
    assert.ok(!/0/.test(r.balance), `"${r.name}" rendered a zero for an unknown balance`);
    assert.ok(!/Rp/.test(r.balance), `"${r.name}" wears a currency it cannot prove`);
    assert.ok(!r.negative, `"${r.name}" is styled as a negative balance`);
    // And it says WHY, rather than leaving a bare dash.
    assert.ok(/unavailable|currency/i.test(r.sub || ''),
      `"${r.name}" gives no reason: "${r.sub}"`);
    // No share meter either: there is no total to take a share of.
    assert.ok(!r.meter, `"${r.name}" draws a share meter for an unmeasurable balance`);
  }
});

t('a real zero balance is shown as a figure, not as absence', () => {
  const zero = AS.accounts.rows.find((r) => /Escrow/.test(r.name));
  assert.ok(zero, 'the zero-balance fixture did not render');
  assert.strictEqual(zero.balance, 'Rp 0', `a zero balance reads "${zero.balance}"`);
  assert.ok(!zero.missing, 'a measured zero is being treated as an unavailable balance');
  assert.ok(!zero.negative, 'a zero balance is coloured as a negative');
});

t('a negative balance is red, and only a negative one is', () => {
  const neg = AS.accounts.rows.find((r) => r.negative);
  assert.ok(neg, 'the negative-balance fixture did not render');
  assert.match(neg.balance, /^Rp -/, `the negative balance reads "${neg.balance}"`);
  const positives = AS.accounts.rows.filter((r) => !r.negative && !r.missing);
  const colors = new Set(positives.map((r) => r.balanceColor));
  assert.ok(!colors.has(neg.balanceColor),
    `a positive balance is painted the same colour as the negative one (${neg.balanceColor})`);
});

t('the summary keeps saying what it left out of the total', () => {
  // Wallets in other currencies are counted and named, never folded into the
  // figure and never hidden.
  assert.match(AS.accounts.summaryMeta, /not totalled yet/i,
    `the stress summary reads "${AS.accounts.summaryMeta}"`);
  assert.match(AS.accounts.summaryMeta, /needs currency/i,
    `the stress summary does not mention the wallet with no currency`);
});

t('a long wallet name wraps rather than being cut off', () => {
  // The name is how a person identifies the account, so it is the last thing
  // that may be truncated — at 320px especially.
  for (const [name, f] of [['stress', AS], ['320px', A320]]) {
    for (const row of f.accounts.rows) {
      assert.ok(!row.nameTruncated, `${name}: "${row.name}" is clipped`);
    }
  }
  const long = A320.accounts.rows.find((r) => r.name.length > 50);
  assert.ok(long, 'the long-name fixture did not render at 320px');
});

console.log('\nWallets & Accounts — adding a wallet');

t('the business page shows one unfiltered list, with no scope tabs', () => {
  // /business/accounts shows the wallets of the SELECTED COMPANY. The tabs only
  // re-filtered rows the API had already restricted to that company, by a scope
  // column that does not establish ownership.
  for (const [name, f] of [...ACCT_VIEWS, ['empty', AE]]) {
    assert.strictEqual(f.accounts.scopeTabs, 0,
      `${name}: ${f.accounts.scopeTabs} scope tab row(s) still rendered`);
  }
  // Every wallet in the fixture is on screen — nothing is filtered out.
  assert.strictEqual(AS.accounts.rows.length, 6,
    `the stress view shows ${AS.accounts.rows.length} of 6 wallets`);
});

t('removing the filter did not hide the Business/Personal flag', () => {
  // The scope is still on every row. A company-owned wallet flagged personal
  // stays visible and stays labelled — the filter went, the data did not.
  for (const row of AD.accounts.rows) {
    const scopeChip = row.chips[row.chips.length - 1];
    assert.ok(/Business|Personal/.test(scopeChip),
      `"${row.name}" lost its scope chip: ${row.chips.join(', ')}`);
  }
});

t('a company wallet flagged personal is marked, not muted', () => {
  // business_id says the row belongs to this company; the flag claims the money
  // does not; migration 017 assigned wallets to businesses without ever looking
  // at scope. The row is listed and totalled as the company's — that is what
  // business_id establishes — and the chip marks the unresolved claim rather
  // than blending into the other chips.
  const personal = AS.accounts.rows.find((r) => /Director card/.test(r.name));
  assert.ok(personal, 'the ambiguous-record fixture did not render');
  assert.ok(personal.chips.some((c) => /Personal/.test(c)),
    `the row is not labelled personal: ${personal.chips.join(', ')}`);
  // It still carries a real balance: nothing is excluded, hidden or reclassified.
  assert.match(personal.balance, /^Rp /,
    `the row prints "${personal.balance}" instead of its balance`);
  assert.ok(!personal.missing, 'the row was treated as an unmeasurable balance');
});

t('the dashed add row is gone, replaced by the branded block', () => {
  // The list used to end with a dashed card pretending to be a wallet.
  for (const [name, f] of ACCT_VIEWS) {
    assert.strictEqual(f.accounts.dashedAddRow, 0,
      `${name}: ${f.accounts.dashedAddRow} dashed placeholder(s) still on the page`);
  }
  const b = AD.accounts.addMore;
  assert.ok(b, 'the add-another block is missing');
  assert.ok(b.title.length > 0, 'the add-another block has no heading');
  assert.ok(b.sub.length > 20, `the explanation is "${b.sub}" — too short to explain anything`);
  assert.ok(b.btnLabel && /add/i.test(b.btnLabel), `the button reads "${b.btnLabel}"`);
});

t('the add block carries the official mark, small', () => {
  const b = AD.accounts.addMore;
  assert.match(b.symSrc || '', /\/brand\/symbol_[a-z_]+\.svg$/,
    `the block's mark is ${b.symSrc}, not an official brand asset`);
  // Deliberately smaller than the zero state's, which is the whole page.
  assert.ok(b.symW > 0 && b.symW <= 40, `the block's mark is ${b.symW}px wide`);
});

t('the add block is more compact than the full zero state', () => {
  // Two different jobs: one closes a list that already has content, the other IS
  // the page. If they were the same size the list would end in a second page.
  const block = AD.accounts.addMore;
  const zero = AE.accounts.zeroState;
  assert.ok(zero, 'the zero state did not render');
  assert.ok(block.h < zero.h,
    `the add block is ${block.h}px and the zero state ${zero.h}px — the block is not more compact`);
  assert.ok(block.symW < zero.symW,
    `the block's mark (${block.symW}px) is not smaller than the zero state's (${zero.symW}px)`);
});

t('the zero state still says what it always said', () => {
  const z = AE.accounts.zeroState;
  assert.match(z.title, /Your wallets will live here/,
    `the zero state heading reads "${z.title}"`);
  // And on an empty workspace there is no add-another block competing with it.
  assert.strictEqual(AE.accounts.addMore, null,
    'the add-another block renders on an empty workspace, alongside the zero state');
  assert.strictEqual(AE.accounts.rows.length, 0, 'the empty workspace rendered wallet rows');
});

t('exactly one card on the page carries the brand watermark', () => {
  for (const [name, f] of [...ACCT_VIEWS, ['empty', AE]]) {
    assert.strictEqual(f.accounts.flagships, 1,
      `${name}: ${f.accounts.flagships} flagship cards, expected 1`);
  }
});

console.log('\nWallets & Accounts — 390px and 320px');

t('nothing overflows or scrolls sideways on a phone', () => {
  for (const [name, f] of [['390px', AM], ['320px', A320]]) {
    assert.ok(f.scrollWidth <= f.clientWidth,
      `${name}: scrollWidth ${f.scrollWidth} > clientWidth ${f.clientWidth}`);
    assert.strictEqual(f.overflowCount, 0,
      `${name}: ${f.overflowCount} overflowing element(s): ${JSON.stringify(f.overflow)}`);
  }
});

t('no balance is clipped, at any width', () => {
  for (const [name, f] of ACCT_VIEWS) {
    for (const fig of f.figures) {
      assert.strictEqual(fig.truncated, false,
        `${name}: "${fig.text}" (.${fig.cls}) is clipped`);
    }
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

t('every width keeps exactly one <h1>', () => {
  for (const [name, f] of [['pulse 1440', SD], ['wallets 1440', WP], ['wallets 768', WP768],
                           ['pulse 768', PULSE768], ['wallets 390', SM], ['wallets 320', WP320],
                           ['empty 1440', WE], ['empty 390', WEM], ['empty 320', WE320],
                           ['mixed 1440', WMIX], ['four 1440', W4]]) {
    assert.strictEqual(f.h1Total, 1, `${name}: ${f.h1Total} h1 elements`);
  }
});

t('the in-shell page keeps exactly one <h1>', () => {
  assert.strictEqual(SD.h1Total, 1, `in-shell desktop has ${SD.h1Total} h1`);
  assert.strictEqual(SM.h1Total, 1, `in-shell mobile has ${SM.h1Total} h1`);
});

/* ── Wallets: two states, and they must never blend ──────────────────────────
   The rejected concept put "Add your first wallet" underneath a card reading
   Rp 152 450 000 and "4 wallets" — a state the product cannot be in. These check
   the rendered page rather than the source, because that is where the two states
   met. */

t('the populated page never invites a first wallet', () => {
  for (const [name, f] of [['desktop', WP], ['mobile', SM], ['320px', WP320]]) {
    const w = f.walletsState;
    assert.strictEqual(w.hasEmptyState, false, name + ': the zero state is rendered with wallets present');
    assert.ok(!/Add your first wallet/i.test(w.pageText || ''),
      name + ': the populated page still offers "Add your first wallet"');
    assert.ok(!/will live here/i.test(w.pageText || ''),
      name + ': the populated page still carries the zero-state title');
  }
});

t('the empty page never claims wallets or a balance', () => {
  for (const [name, f] of [['desktop', WE], ['mobile', WEM], ['320px', WE320]]) {
    const w = f.walletsState;
    assert.strictEqual(w.hasCard, true, name + ': the summary card vanished on an empty workspace');
    assert.strictEqual(w.value, 'Rp 0', name + ': the empty card headline reads ' + w.value);
    assert.strictEqual(w.meta, 'No wallets added yet',
      name + ': the empty card supporting line reads ' + w.meta);
    assert.ok(!/\b4 wallets\b/.test(w.pageText || ''), name + ': the empty page claims 4 wallets');
    assert.ok(!/152/.test(w.pageText || ''), name + ': the empty page shows a populated balance');
    assert.ok(!/\d wallets\b/.test(w.meta || ''),
      name + ': the empty card counts wallets instead of saying there are none');
  }
});

t('the zero state says what the page will hold, and offers one way to start', () => {
  for (const [name, f] of [['desktop', WE], ['mobile', WEM]]) {
    const w = f.walletsState;
    assert.strictEqual(w.hasEmptyState, true, name + ': no zero state on an empty workspace');
    // Under the page's single h1, so the document outline stays intact.
    assert.strictEqual(w.headingTag, 'h2', name + ': the zero-state heading is a ' + w.headingTag);
    assert.strictEqual(w.heading, 'Your wallets will live here', name + ': heading is ' + w.heading);
    assert.match(w.desc || '', /^Add a bank account, cash balance or payment wallet/,
      name + ': description is ' + w.desc);
    assert.strictEqual(w.ctaCount, 1, name + ': ' + w.ctaCount + ' calls to action, not one');
    assert.strictEqual(w.cta, 'Add your first wallet', name + ': the CTA reads ' + w.cta);
    // No preview-only labelling survives into the product.
    assert.ok(!/UX concept|not production/i.test(w.pageText || ''),
      name + ': the preview-only concept label is still on screen');
  }
});

t('the zero state CTA is a real, reachable control on a phone', () => {
  const w = WEM.walletsState;
  assert.ok(w.ctaBox && w.ctaBox.h >= 44,
    'the zero-state CTA is ' + (w.ctaBox && w.ctaBox.h) + 'px tall; a thumb needs 44');
  // And the panel does not turn into a landing page.
  assert.ok(w.stateBox.h < 420,
    'the zero-state panel is ' + w.stateBox.h + 'px tall on a phone — that is a marketing page');
});

t('the zero state symbol is decorative', () => {
  for (const [name, f] of [['desktop', WE], ['mobile', WEM]]) {
    const w = f.walletsState;
    assert.strictEqual(w.symAlt, '', name + ': the zero-state symbol has alt="' + w.symAlt + '"');
    assert.strictEqual(w.symAriaHidden, 'true', name + ': the zero-state symbol is not aria-hidden');
  }
});

t('the headline is the abbreviated figure, with the exact one beneath it', () => {
  const w = WP.walletsState;
  assert.match(w.value, /^Rp 152\.5M$/, 'the headline reads ' + w.value);
  // The exact figure and the count, in the supporting line — grouped by the
  // production formatter, so the separator is whatever it produces.
  assert.match(w.meta, /^Rp 152.450.000 · 4 wallets$/,
    'the supporting line reads ' + w.meta);
  // Same hierarchy Pulse uses: the abbreviated figure is the bigger of the two.
  assert.ok(w.valueBox.h > w.metaBox.h,
    'the abbreviated figure is not the dominant one');
});

t('the abbreviated headline holds one line, down to 320px', () => {
  for (const [name, f] of [['1440', WP], ['390', SM], ['320', WP320]]) {
    const w = f.walletsState;
    assert.strictEqual(w.valueWhiteSpace, 'nowrap',
      name + 'px: the abbreviated headline may wrap (white-space: ' + w.valueWhiteSpace + ')');
    assert.strictEqual(w.valueLines, 1,
      name + 'px: the headline is on ' + w.valueLines + ' lines');
  }
  // Rp 0 is short by construction, but it is still the same card.
  assert.strictEqual(WE320.walletsState.valueLines, 1, '320px: "Rp 0" wrapped');
});

t('neither state overflows, at any width down to 320px', () => {
  for (const [name, f] of [['populated 1440', WP], ['empty 1440', WE], ['empty 390', WEM],
                           ['populated 320', WP320], ['empty 320', WE320],
                           ['usd 1440', WUSD], ['mixed 1440', WMIX], ['mixed 390', WMIXM],
                           ['no-currency 1440', WNOC], ['four 1440', W4], ['four 390', W4M],
                           ['wallets 768', WP768], ['pulse 768', PULSE768]]) {
    assert.ok(f.scrollWidth <= f.clientWidth,
      name + ': scrollWidth ' + f.scrollWidth + ' > clientWidth ' + f.clientWidth);
    assert.strictEqual(f.overflowCount, 0,
      name + ': ' + f.overflowCount + ' overflowing element(s): ' + JSON.stringify(f.overflow));
  }
});

t('the watermark clears both amount lines in both states', () => {
  for (const [name, f] of [['populated 1440', WP], ['empty 1440', WE], ['empty 390', WEM],
                           ['populated 320', WP320], ['empty 320', WE320],
                           ['usd 1440', WUSD], ['mixed 1440', WMIX], ['mixed 390', WMIXM]]) {
    for (const c of f.brand.flagships) {
      assert.ok(c.safeGap > 0,
        name + ': only ' + c.safeGap + 'px between the amounts and the mark');
      assert.strictEqual(c.marks, 1, name + ': ' + c.marks + ' marks on the flagship card');
      assert.strictEqual(c.ariaHidden, 'true', name + ': the card mark is not aria-hidden');
    }
  }
});

/* ── currency safety, on the rendered page ───────────────────────────────────
   A balance belongs to one currency, so a total may only cover wallets that share
   one. The page used to add them all and label the result IDR. */

t('a dollar-only workspace reports no figure rather than relabelling rupiah', () => {
  // The balance behind a USD wallet is a sum of transactions.amount_idr — the
  // IDR-reporting column. Printing "$" in front of it would relabel rupiah as
  // dollars, which is worse than the cross-currency addition this replaced. Until
  // the backend derives native balances, the card states nothing.
  const w = WUSD.walletsState;
  assert.strictEqual(w.value, 'Balance unavailable',
    `the USD-only headline reads "${w.value}"`);
  assert.ok(!/\$/.test(w.value), `a dollar figure was printed: ${w.value}`);
  assert.ok(!/Rp/.test(w.value), `a rupiah figure was printed: ${w.value}`);
  // And it says why, with the wallets counted rather than hidden.
  assert.match(w.meta, /2 in other currencies \(not totalled yet\)/,
    `the USD-only supporting line reads "${w.meta}"`);
});

t('a mixed workspace totals only what it can prove, and says what it left out', () => {
  for (const [name, f] of [['desktop', WMIX], ['mobile', WMIXM]]) {
    const w = f.walletsState;
    // The IDR total, in the approved hierarchy, labelled IDR.
    assert.strictEqual(w.value, 'Rp 152.5M', `${name}: the headline reads ${w.value}`);
    assert.match(w.label || '', /IDR/, `${name}: the card label is "${w.label}"`);
    assert.match(w.meta, /^Rp 152 450 000 · 4 wallets · 2 in other currencies \(not totalled yet\)$/,
      `${name}: the supporting line reads "${w.meta}"`);
    // The number that must never appear: the two added together. IDR 152 450 000
    // plus USD 1 252 500 would compact to Rp 153.7M.
    assert.ok(!/153\.7M/.test(w.pageText || ''),
      `${name}: a combined cross-currency total is on screen`);
    // And no dollar figure anywhere, because none can be vouched for.
    assert.ok(!/\$/.test(w.pageText || ''),
      `${name}: a dollar amount appeared despite the balance being unprovable`);
    // The by-currency list belongs to the unshipped concept, not to this card.
    assert.strictEqual(w.currencies.length, 0,
      `${name}: the production card rendered the future by-currency list`);
  }
});

t('four currencies do not change the rule or the layout', () => {
  const w = W4.walletsState;
  assert.strictEqual(w.value, 'Rp 152.5M', `the headline reads ${w.value}`);
  assert.match(w.meta, /4 in other currencies \(not totalled yet\)/,
    `the supporting line reads "${w.meta}"`);
  assert.ok(!/\$|€|S\$/.test(w.pageText || ''), 'a foreign-currency figure was printed');
  assert.strictEqual(w.valueLines, 1, 'the headline wrapped with four currencies present');
});

t('a wallet with no currency is counted and asked about, never totalled', () => {
  const w = WNOC.walletsState;
  // The two IDR wallets total Rp 132.7M; the 5 000 000 with no currency is out.
  assert.match(w.value, /^Rp /, `the headline reads ${w.value}`);
  assert.match(w.meta, /needs currency/i,
    `the supporting line does not mention the wallet needing a currency: ${w.meta}`);
  assert.ok(!/137\.7M|Rp 137/.test(w.pageText || ''),
    'the unknown-currency balance was folded into the total anyway');
  // The per-wallet "Needs currency" badge lives on the wallet rows, which only
  // the real page renders — the preview shows header, card and zero state. The
  // row badge is covered by the source assertions in designPreview.test.mjs; what
  // the card must do, and does here, is exclude the balance and say why.
  assert.strictEqual(w.currencies.length, 0,
    'a single remaining currency should not render the by-currency list');
});

t('every currency on screen is written in its own notation', () => {
  // Nowhere may a currency symbol appear in front of another currency's amount.
  for (const [name, f] of [['USD', WUSD], ['mixed', WMIX], ['no-currency', WNOC],
                           ['four', W4]]) {
    const text = f.walletsState.pageText || '';
    assert.ok(!/Rp\s*\$|\$\s*Rp/.test(text), `${name}: two currency marks collided`);
  }
  // Nothing on the dollar-only page claims a figure in any currency.
  assert.ok(!/Rp|\$/.test(WUSD.walletsState.value || ''),
    'the dollar-only workspace printed a currency figure');
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

/* ── AI Accountant — Tax & Compliance Workbench ─────────────────────────────
   What a browser can settle and a source read cannot: whether the one navy card
   is branded, whether "insufficient data" still looks like money, and whether
   five tabs and three prose cards survive a phone. */
console.log('\nAI Accountant — the flagship and its mark');

t('the Tax reserve card is a flagship and wears exactly one mark', () => {
  const r = NAD.accountant.reserve;
  assert.ok(r.present, 'no reserve card rendered');
  assert.strictEqual(r.flagship, true, 'the page\u2019s one navy hero is not a flagship');
  assert.strictEqual(r.markPainted, true, 'the flagship mark is not painted');
  assert.strictEqual(NAD.brand.cardMarks, 1, `expected one card mark, saw ${NAD.brand.cardMarks}`);
});

t('the mark is the official white symbol, and inert to a reader', () => {
  const r = NAD.accountant.reserve;
  assert.match(r.markSrc || '', /symbol_white_transparent\.svg$/);
  assert.strictEqual(r.markAlt, '', 'a decorative mark must carry an empty alt');
  assert.strictEqual(r.markAria, 'true');
});

t('the mark claims a safe column the text may not enter', () => {
  // --mark-safe guarantees the label, the figure and the supporting line are
  // never set over the mark, and it belongs to shell.css rather than this page.
  // The custom property reads back as its unresolved calc() text, so what the
  // assertion measures is the USED value: the padding the card really reserves.
  const pad = parseFloat(NAD.accountant.reserve.safePad);
  assert.ok(pad > 100, `the card reserves only ${NAD.accountant.reserve.safePad} for the mark`);
  // And the column actually works: the nearest thing a reader has to read stops
  // clear of the mark's near edge. safeGap is that distance, measured on the
  // painted rectangles rather than inferred from the padding.
  const fs = (NAD.brand.flagships || []).filter((f) => f.painted);
  assert.strictEqual(fs.length, 1, `expected one flagship, saw ${fs.length}`);
  assert.ok(fs[0].safeGap >= 0,
    `content runs ${-fs[0].safeGap}px into the mark's column`);
  assert.ok(fs[0].cropped > 0,
    'the mark must be cropped by the card edge — an uncropped one reads as a parked icon');
});

t('nothing readable is painted over the mark, at any width', () => {
  for (const [name, V] of [['desktop', NAD], ['390', NAM], ['320', NA320]]) {
    const bad = (V.overlaps || []).filter((o) => /cfo-summary|acct-/.test(o.hero + o.cls));
    assert.strictEqual(bad.length, 0, `${name}: ${JSON.stringify(bad)}`);
  }
});

console.log('\nAI Accountant — absence, zero and amount');

t('with nothing measured the reserve is an em dash, not Rp 0', () => {
  const r = NAD.accountant.reserve;
  assert.strictEqual(r.value, '\u2014', `reserve read ${JSON.stringify(r.value)}`);
  assert.ok(!/Rp\s*0/.test(r.value || ''), 'an unmeasured reserve must never render as money');
  assert.ok((r.meta || '').length > 20, 'the absent reserve must say why it is absent');
});

t('a measured reserve renders as money', () => {
  const r = NCALC.accountant.reserve;
  assert.match(r.value || '', /^Rp\s/, `reserve read ${JSON.stringify(r.value)}`);
  assert.ok(!/\u2014/.test(r.value || ''));
});

t('a CONFIRMED zero renders as a zero, not as an em dash', () => {
  // One line, summing to nothing. This is the case the old `reserve > 0` test
  // swallowed: it showed the same em dash as never-measured.
  const r = NZERO.accountant.reserve;
  assert.match(r.value || '', /^Rp\s*0$/, `confirmed zero read ${JSON.stringify(r.value)}`);
});

t('no figure on the page is truncated at any width', () => {
  for (const [name, V] of [['desktop', NAD], ['390', NAM], ['320', NA320], ['calc', NCALC]]) {
    const cut = (V.figures || []).filter((f) => f.truncated);
    assert.strictEqual(cut.length, 0, `${name}: ${JSON.stringify(cut)}`);
  }
});

console.log('\nAI Accountant — a non-amount never looks like an amount');

t('insufficient data and not enabled render as chips, not as figures', () => {
  const rows = NAD.accountant.obligations;
  assert.ok(rows.length >= 3, `expected the obligation rows, saw ${rows.length}`);
  const nonAmount = rows.filter((r) => /insufficient|not enabled/i.test(r.amount || ''));
  assert.ok(nonAmount.length >= 2, `expected at least two non-amount rows, saw ${nonAmount.length}`);
  for (const r of nonAmount) {
    assert.strictEqual(r.isChip, true, `${r.label}: still rendered as a bare amount`);
    assert.ok(!/JetBrains/i.test(r.chipFont || ''),
      `${r.label}: a state is set in the figure face (${r.chipFont})`);
  }
});

t('a real amount IS in the figure face, beside the chips', () => {
  const rows = NCALC.accountant.obligations;
  const real = rows.filter((r) => /^Rp\s/.test(r.amount || ''));
  assert.ok(real.length >= 1, `expected one real amount, saw ${JSON.stringify(rows.map((r) => r.amount))}`);
  assert.match(real[0].amtFont || '', /JetBrains/i, 'money must be set in the figure face');
  assert.strictEqual(real[0].isChip, false);
  // And the chips are still chips on the same screen — the contrast is the point.
  assert.ok(NCALC.accountant.chipCount >= 1, 'the mixed state must show both treatments at once');
});

t('every non-amount row explains what it does not mean', () => {
  for (const r of NAD.accountant.obligations.filter((x) => x.isChip)) {
    assert.ok((r.sub || '').length > 30,
      `${r.label}: no hint under a state that could be read as "nothing is owed"`);
  }
});

console.log('\nAI Accountant — completeness is about the form');

t('a full completeness bar does not turn green', () => {
  const c = NCALC.accountant.completeness;
  assert.ok(c, 'no completeness meter rendered');
  // --success is #0F7A52. A bar at 100% in that colour reads as a compliance verdict.
  assert.ok(!/15,\s*122,\s*82/.test(c.bg), `the full bar is drawn in the success colour: ${c.bg}`);
});

t('the completeness card states what it measures and what it does not', () => {
  const c = NCALC.accountant.completeness;
  assert.ok((c.caveat || '').length > 30, 'no caveat beside a 100% figure');
  assert.ok(c.caveatBg && c.caveatBg !== 'rgba(0, 0, 0, 0)', 'the caveat must be a visible callout');
});

console.log('\nAI Accountant — one rhythm, one identity');

t('every gap between page sections is 18px', () => {
  assert.strictEqual(NAD.accountant.pageGap, '18px', `page gap is ${NAD.accountant.pageGap}`);
  const odd = NAD.accountant.sectionGaps.filter((g) => g !== 18);
  assert.deepStrictEqual(odd, [], `section gaps: ${NAD.accountant.sectionGaps.join(', ')}`);
});

t('the module renders exactly one page header on every view', () => {
  for (const [name, V] of [['workbench', NAD], ['calendar', NCAL], ['draft', NDRAFT]]) {
    assert.strictEqual(V.h1Total, 1, `${name}: ${V.h1Total} h1 on one page`);
    assert.strictEqual(V.heads.length, 1, `${name}: ${V.heads.length} page headers`);
  }
});

t('the page header keeps its badge out of the button box', () => {
  // context and actions are separate zones: a badge sharing the actions box
  // stretched edge to edge on a phone, which is right for a button and wrong
  // for a label.
  for (const b of NAM.headActions) {
    assert.ok(!/Preview/i.test(b.txt), `a status badge is sitting in the actions box: ${b.txt}`);
  }
});

t('page-level actions stay thumb-sized on a phone', () => {
  for (const b of NAM.headActions) {
    assert.ok(b.h >= 32, `${b.txt}: ${b.h}px tall`);
  }
});

console.log('\nAI Accountant — narrow screens');

t('nothing overflows the viewport at 390 or 320', () => {
  for (const [name, V] of [['390', NAM], ['320', NA320], ['calendar 390', NCALM]]) {
    assert.strictEqual(V.overflowCount, 0,
      `${name}: ${JSON.stringify(V.overflow)}`);
  }
});

t('the five tabs scroll, and say so', () => {
  const a = NAM.accountant;
  assert.strictEqual(a.tabs.length, 5, `saw ${a.tabs.length} tabs`);
  assert.strictEqual(a.tabsScrollable, true, 'five tabs fitting a phone would mean they are unreadably small');
  assert.match(a.tabsMask || '', /gradient/,
    'a strip that scrolls with no edge affordance hides three of its five tabs');
});

t('the tab strip does NOT scroll on desktop, and carries no fade there', () => {
  assert.strictEqual(NAD.accountant.tabsScrollable, false);
  assert.ok(!/gradient/.test(NAD.accountant.tabsMask || ''),
    'a fade on a strip with nothing past the edge is a lie');
});

t('the plain-language row is one column on a phone, three on desktop', () => {
  assert.strictEqual(NAD.accountant.plainCols, 3, `desktop: ${NAD.accountant.plainCols} columns`);
  assert.strictEqual(NAM.accountant.plainCols, 1,
    `390: ${NAM.accountant.plainCols} columns \u2014 prose does not fit in a 135px track`);
  assert.strictEqual(NA320.accountant.plainCols, 1, `320: ${NA320.accountant.plainCols} columns`);
});

t('the two-column bands stack on a phone', () => {
  assert.strictEqual(NAD.accountant.bandCols, 2);
  assert.strictEqual(NAM.accountant.bandCols, 1);
});

console.log('\nAI Accountant — calendar colour');

t('every marked calendar day clears 4.5:1 against its own ground', () => {
  // The old cellStyle set var(--warning) as text on var(--warning-soft) and a
  // bare #fff on the PPN cell. Contrast is measured here, not asserted in prose.
  const days = NCAL.accountant.calendarKinds;
  assert.ok(days.length >= 4, `expected the marked days, saw ${days.length}`);
  const lum = (c) => { const p = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; };
  for (const d of days) {
    const l1 = lum(d.color), l2 = lum(d.bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    assert.ok(ratio >= 4.5, `${d.kind} day ${d.day}: ${ratio.toFixed(2)}:1 (${d.color} on ${d.bg})`);
  }
});

t('the calendar keeps seven columns on a phone', () => {
  // A week has seven days; a stacked calendar is not a calendar. It may shrink,
  // it may not restructure.
  assert.ok(NCALM.accountant.calendarKinds.length >= 4, 'the marked days vanished at 390px');
  assert.strictEqual(NCALM.overflowCount, 0);
});

console.log('\nAI Accountant — the preview is still a preview');

t('no accountant view makes a network call', () => {
  for (const [name, V] of [['workbench', NAD], ['calendar', NCAL], ['draft', NDRAFT], ['calc', NCALC]]) {
    assert.deepStrictEqual(V.suspicious || [], [], `${name} reached the network: ${JSON.stringify(V.suspicious)}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
