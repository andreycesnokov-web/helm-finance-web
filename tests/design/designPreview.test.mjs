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
  // minifier delete the branch. A runtime source (localStorage, a query param,
  // an API response) would ship the whole page to every customer.
  assert.ok(!/localStorage|sessionStorage|location\.search|document\.cookie/.test(
    src.slice(0, src.indexOf('export default function DesignPreview'))
      .replace(/const ONLY[\s\S]*?: null\n/, '')),
    'gating must not depend on anything readable at runtime');
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
  assert.ok(/DEMO-/.test(src), 'the workspace identifier must be visibly a demo value');
});

t('the page says what it is, in the page', () => {
  assert.match(src, /SYNTHETIC DATA/,
    'a screenshot of this page must be self-labelling once it leaves the repo');
});

console.log('\ndesign preview — the watermark is decoration');

t('every hero mark is hidden from assistive technology', () => {
  // Two components draw the mark. Both must be inert to a screen reader: it
  // carries no information a caption does not already carry.
  for (const p of ['client/src/shell/ui.jsx', 'client/src/pages/business/PulseBlocks.jsx']) {
    const s = code(p);
    const imgs = s.match(/<img[^>]*(?:cash-mark|summary-sym)[^>]*>/g) || [];
    assert.ok(imgs.length > 0, `no watermark <img> found in ${p}`);
    for (const img of imgs) {
      assert.match(img, /aria-hidden="true"/, `watermark not aria-hidden in ${p}`);
      assert.match(img, /alt=""/, `watermark missing empty alt in ${p}`);
    }
  }
});

t('the two watermark implementations stay in step', () => {
  // They were 210px/.07/bottom-right and 180px/.10/top-right — the same idea drawn
  // twice, differently, on the product's two dark heroes.
  const shell = read('client/src/shell/shell.css');
  const pulse = read('client/src/pages/business/Pulse.css');
  const grab = (css, sel) => {
    const m = css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `${sel} not found`);
    const pick = (prop) => (m[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`)) || [])[1]?.trim();
    return { width: pick('width'), opacity: pick('opacity'), right: pick('right'), top: pick('top') };
  };
  assert.deepStrictEqual(
    grab(shell, '.cfo-summary-sym'), grab(pulse, '.pulse-cash-mark'),
    'the summary-card mark and the Pulse cash mark must be drawn identically');
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
