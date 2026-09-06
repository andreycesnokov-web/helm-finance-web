// What the design preview route is allowed to be.
//
// PR #80 changed shared visual components, and visual claims need pictures. The
// preview page exists to produce those pictures from the REAL components, which
// makes it a permanent risk: a page that renders product chrome with no auth is
// exactly the kind of thing that quietly becomes reachable in production, or
// quietly drifts into a hand-written mock that proves nothing.
//
// These are structural assertions. The rendered-DOM assertions — h1 counts,
// computed colour, overflow at 390px — live in renderedPreview.test.mjs, which
// drives a real browser. Where a fact can be checked in the DOM, it is checked
// there and not here.
//
// Run: node tests/design/designPreview.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Source with comments stripped, so assertions about behaviour are not
 *  satisfied — or broken — by prose that merely describes it. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const PREVIEW = 'client/src/pages/DesignPreview.jsx';
const src = code(PREVIEW);
const app = code('client/src/App.jsx');

console.log('\ndesign preview — gating');

t('the route is behind a build-time flag', () => {
  assert.match(src, /import\.meta\.env\.VITE_DESIGN_PREVIEW_ENABLED\s*===\s*'true'/,
    'preview must read VITE_DESIGN_PREVIEW_ENABLED');
});

t('a disabled flag renders the not-found branch before anything else', () => {
  // The guard must be the first statement of the component: a later return would
  // still mount the page's data and effects on the way to the 404.
  const body = src.slice(src.indexOf('export default function DesignPreview'));
  const firstReturn = body.slice(0, body.indexOf('\n\n'));
  assert.match(firstReturn, /if\s*\(\s*!PREVIEW_ON\s*\)\s*return\s*<NotFound/,
    'the flag check must be the component\'s first statement');
});

t('the flag is compile-time, so a production bundle drops the page entirely', () => {
  // Vite inlines import.meta.env.VITE_* at build time, which is what lets the
  // minifier delete the branch and Rollup drop the lazy chunk. Anything the
  // browser could decide at runtime would ship the page to every customer.
  const gate = src.match(/const PREVIEW_ON\s*=\s*([^\n]+)/);
  assert.ok(gate, 'PREVIEW_ON is not defined');
  assert.match(gate[1], /import\.meta\.env\.VITE_DESIGN_PREVIEW_ENABLED/,
    `the gate reads ${gate[1].trim()}, which is not a build-time constant`);
  assert.strictEqual((src.match(/PREVIEW_ON\s*=[^=]/g) || []).length, 1,
    'PREVIEW_ON is assigned more than once');
  // Query params choose which example to render; they never decide whether the
  // page exists. Storage and cookies have no business here at all.
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(src),
    'the preview must not read browser storage');
});

t('the route is registered exactly once', () => {
  const hits = app.match(/path="\/design-preview"/g) || [];
  assert.strictEqual(hits.length, 1, `expected 1 route registration, found ${hits.length}`);
});

console.log('\ndesign preview — it must render the real thing');

t('the shared components come from the shipped modules', () => {
  assert.match(src, /import\s*\{[^}]*PageHeader[^}]*\}\s*from\s*'\.\.\/shell\/ui'/,
    'PageHeader must be imported from shell/ui');
  assert.match(src, /import\s*\{[^}]*SummaryCard[^}]*\}\s*from\s*'\.\.\/shell\/ui'/,
    'SummaryCard must be imported from shell/ui');
  assert.match(src, /import\s*\{\s*ExecutiveHero\s*\}\s*from\s*'\.\/business\/PulseBlocks'/,
    'ExecutiveHero must be imported from the real Pulse module');
});

t('the preview defines no look-alike of a component it is meant to prove', () => {
  // A local re-implementation would make every screenshot a lie.
  for (const name of ['PageHeader', 'SummaryCard', 'ExecutiveHero', 'StatusBadge', 'Btn']) {
    const declared = new RegExp(`(function|const)\\s+${name}\\b`);
    assert.ok(!declared.test(src), `${name} must not be redefined inside the preview`);
  }
});

t('money is formatted by the production formatter', () => {
  assert.match(src, /import\s*\{\s*formatAmount\s*\}\s*from\s*'\.\.\/lib\/money'/,
    'the preview must not hand-format currency');
});

console.log('\ndesign preview — it must not reach anything real');

t('no network, no database, no auth', () => {
  for (const forbidden of ['fetch(', 'apiFetch', 'supabase', 'axios', 'XMLHttpRequest',
    'useAuth', 'localStorage', 'sessionStorage']) {
    assert.ok(!src.includes(forbidden), `preview must not reference ${forbidden}`);
  }
});

t('no effects and no state — it is a fixed render', () => {
  for (const hook of ['useEffect', 'useState', 'useQuery', 'useContext']) {
    assert.ok(!src.includes(hook), `preview must not use ${hook}`);
  }
});

t('every figure is synthetic', () => {
  // An NPWP is 15-16 digits, an Indonesian account number 10-16. Nothing of that
  // shape may appear, and the demo identifier must be visibly fake.
  const digits = src.match(/\d[\d.\-\s]{9,}\d/g) || [];
  for (const d of digits) {
    const bare = d.replace(/\D/g, '');
    assert.ok(bare.length < 10, `suspicious long identifier in fixtures: ${d.trim()}`);
  }
  // The workspace identifier is gone from the fixture entirely: the switcher renders
  // one when present, and a technical code is not something a business user needs
  // to read on every screen.
  assert.ok(!/business_code\s*:/.test(src),
    'the fixture still carries a business_code, which the switcher will render');
});

t('the page says what it is, in the page', () => {
  assert.match(src, /SYNTHETIC DATA/,
    'a screenshot of this page must be self-labelling once it leaves the repo');
});

console.log('\ndesign preview — the watermark is decoration');

t('the one decorative mark is inert to assistive technology', () => {
  // It lives in the page hero now, and it carries no information a caption does
  // not already carry.
  const ui = code('client/src/shell/ui.jsx');
  const imgs = ui.match(/<img[^>]*cfo-pagehead-mark[^>]*>/g) || [];
  assert.strictEqual(imgs.length, 1, `expected one page-hero mark, found ${imgs.length}`);
  assert.match(imgs[0], /aria-hidden="true"/, 'the page-hero mark is not aria-hidden');
  assert.match(imgs[0], /alt=""/, 'the page-hero mark has no empty alt');
});

t('the financial cards draw no mark of their own', () => {
  // Total Cash / Total Balance used to carry a second large mark directly below
  // the page hero's. One content area, one mark.
  for (const f of ['client/src/shell/ui.jsx', 'client/src/pages/business/PulseBlocks.jsx']) {
    const src2 = code(f);
    assert.ok(!/cfo-summary-sym|pulse-cash-mark/.test(src2),
      `${f} still renders a watermark inside a financial card`);
  }
  for (const f of ['client/src/shell/shell.css', 'client/src/pages/business/Pulse.css']) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.ok(!/\.cfo-summary-sym\s*\{|\.pulse-cash-mark\s*\{/.test(css),
      `${f} still styles a financial-card watermark`);
  }
});

t('the page-hero mark sits inside the band rather than off its edge', () => {
  const css = read('client/src/shell/shell.css');
  const m = css.match(/\.cfo-pagehead-mark\s*\{([^}]*)\}/g) || [];
  const rule = m.find((r) => /position:absolute/.test(r));
  assert.ok(rule, '.cfo-pagehead-mark has no positioned rule');
  const right = ((rule.match(/right:\s*([^;]+)/) || [])[1] || '').trim();
  // A negative length (or a calc that negates one) hangs the mark off the band edge,
  // which is what made it read as an icon clipped by the layout.
  assert.ok(!/^-/.test(right) && !/\*\s*-1/.test(right),
    `the mark is offset ${right} — a negative inset clips it against the edge`);
});

console.log('\ndesign preview — the accessible action colour is actually used');

t('the primary button consumes the action token, not the raw brand accent', () => {
  // white on --brand-electric-blue (#3399FF) is 2.94:1 and fails AA. The token
  // layer defines --action-primary for exactly this reason; the button has to use it.
  const shell = read('client/src/shell/shell.css');
  const rule = shell.match(/\.cfo-btn-primary\s*\{([^}]*)\}/);
  assert.ok(rule, '.cfo-btn-primary not found');
  assert.match(rule[1], /background:\s*var\(--action-primary\)/,
    '.cfo-btn-primary must use var(--action-primary)');
  assert.ok(!/--brand-electric-blue/.test(rule[1]),
    '.cfo-btn-primary must not paint itself with the raw brand accent');
});

t('Settings is a footer utility, not a navigation item', () => {
  const shellSrc = code('client/src/shell/WorkspaceShell.jsx');
  assert.ok(!/key:\s*'settings'[^}]*icon:/.test(shellSrc),
    'Settings is still declared as a nav item with an icon');
  assert.match(shellSrc, /SETTINGS_DESTINATION/,
    'there is no declared settings destination');
  assert.match(shellSrc, /className="cfo-side-settings"/,
    'the sidebar footer utility is missing');
  // Team manages people; settings manages configuration. Both must exist.
  assert.match(shellSrc, /key: 'team'/, 'the Team nav item was removed');
});

t('the footer utility keeps the routes the nav items used', () => {
  const shellSrc = code('client/src/shell/WorkspaceShell.jsx');
  assert.match(shellSrc, /to: '\/business\/settings'/, 'business settings route lost');
  assert.match(shellSrc, /to: '\/personal\/settings'/, 'personal settings route lost');
});

t('page-header context badges do not share the mobile full-width action grid', () => {
  const ui = code('client/src/shell/ui.jsx');
  assert.match(ui, /className="cfo-pagehead-context"/,
    'context badges need their own box, or the mobile grid stretches them edge to edge');
  const right = ui.match(/cfo-pagehead-right[\s\S]*?<\/div>\s*\)\}/);
  assert.ok(right && !/\{context\}[\s\S]{0,40}className="cfo-pagehead-actions"/.test(ui),
    'context must not be rendered inside the actions box');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
