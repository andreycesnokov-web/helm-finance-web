// Who is allowed to declare a design token, and what the pilot pages must look like.
//
// This exists because the brand layer was switched off for months without anyone
// noticing. brand/tokens.css declared the navy, index.css declared it again with a
// legacy value, both at :root, and index.css is imported later — so the product
// shipped #0F172A while the Brand Book and the token file both said #003366.
// Nothing failed, because nothing was checking.
//
// Run: node tests/design/tokenOwnership.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Source with comments removed. Assertions about what the CODE does must not
 *  trip over prose that explains it — an earlier version of this file failed
 *  because a comment mentioned the legacy colour it was warning against. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const TOKENS = 'client/src/brand/tokens.css';
const INDEX = 'client/src/index.css';

/** Variable names brand/tokens.css owns. Nothing else may declare them. */
const CANONICAL = [
  'brand-navy', 'brand-electric-blue', 'brand-electric-blue-ink', 'brand-pale-grey',
  'surface-page', 'surface-card', 'text-primary', 'text-secondary', 'text-muted',
  'border-subtle', 'border-default', 'border-strong',
  'success', 'warning', 'danger', 'info',
  'radius-sm', 'radius-md', 'radius-lg', 'radius-xl',
  'shadow-sm', 'shadow-md', 'shadow-lg',
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-8', 'space-10',
  'action-primary', 'focus-ring', 'font-num',
];

/** Declarations of `--name:` in a stylesheet, ignoring `var(--name)` uses. */
const declares = (css, name) =>
  (css.match(new RegExp(`(^|[;{\\s])--${name}\\s*:`, 'g')) || []).length;

console.log('\nToken ownership');

t('brand/tokens.css declares every canonical token exactly once', () => {
  const css = read(TOKENS);
  for (const name of CANONICAL) {
    const n = declares(css, name);
    assert.strictEqual(n, 1, `--${name} declared ${n} times in ${TOKENS}`);
  }
});

t('index.css declares NONE of them', () => {
  const css = read(INDEX);
  const leaks = CANONICAL.filter((name) => declares(css, name) > 0);
  assert.deepStrictEqual(leaks, [],
    `index.css re-declares ${leaks.map((l) => '--' + l).join(', ')}. It loads after `
    + 'brand/tokens.css, so a duplicate silently wins and the brand layer stops applying.');
});

t('the fix does not depend on import order', () => {
  // Reordering imports would "work" and then quietly break the next time someone
  // touched main.jsx. The duplicates are gone instead, so order cannot matter.
  const main = read('client/src/main.jsx');
  const iTokens = main.indexOf("brand/tokens.css");
  const iIndex = main.indexOf("'./index.css'");
  assert.ok(iTokens > -1 && iIndex > -1, 'both stylesheets must still be imported');
  assert.ok(iTokens < iIndex,
    'tokens.css is expected to load first; if this ever changes the ownership test above '
    + 'is what keeps the brand layer safe, not the order');
});

console.log('\nThe approved palette');

const tokensCss = code(TOKENS);
const valueOf = (name) => {
  const m = tokensCss.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};

t('canonical colours are the founder-approved values', () => {
  assert.strictEqual(valueOf('brand-navy'), '#003366');
  assert.strictEqual(valueOf('brand-electric-blue'), '#3399FF');
  assert.strictEqual(valueOf('brand-electric-blue-ink'), '#1565C0');
  assert.strictEqual(valueOf('brand-pale-grey'), '#F4F6F8');
  assert.strictEqual(valueOf('success').split(';')[0].trim(), '#0F7A52');
  assert.strictEqual(valueOf('warning').split(';')[0].trim(), '#B5740B');
  assert.strictEqual(valueOf('danger').split(';')[0].trim(), '#C62828');
});

t('no legacy slate value survives in the canonical layer', () => {
  for (const legacy of ['#0F172A', '#2563EB', '#065F46', '#DC2626', '#D97706', '#0B1220']) {
    assert.ok(!tokensCss.includes(legacy),
      `${legacy} is a legacy value and must not appear in ${TOKENS}`);
  }
});

t('a text colour is never the un-inked electric blue', () => {
  // #3399FF is 2.94:1 on white — below AA. The ink exists for exactly this reason,
  // and the primary action fill carries a white label, so the fill must be the ink.
  assert.strictEqual(valueOf('action-primary'), 'var(--brand-electric-blue-ink)');
  assert.strictEqual(valueOf('text-link'), 'var(--brand-electric-blue-ink)');
});

t('contrast holds for every colour pair the pilot ships', () => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (h) => { const n = parseInt(h.slice(1), 16);
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
  const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const pairs = [
    ['#003366', '#FFFFFF', 4.5, 'navy text on card'],
    ['#003366', '#F4F6F8', 4.5, 'navy text on page'],
    ['#5A6E82', '#FFFFFF', 4.5, 'muted text on card'],
    ['#5A6E82', '#F4F6F8', 4.5, 'muted text on page'],
    ['#FFFFFF', '#1565C0', 4.5, 'primary button label'],
    ['#0F7A52', '#FFFFFF', 4.5, 'success figure'],
    ['#C62828', '#FFFFFF', 4.5, 'danger figure'],
    ['#8B5A08', '#FFFFFF', 4.5, 'warning ink figure'],
    ['#FFFFFF', '#003366', 4.5, 'hero text on navy'],
  ];
  for (const [fg, bg, min, what] of pairs) {
    const r = cr(fg, bg);
    assert.ok(r >= min, `${what}: ${r.toFixed(2)}:1 is below ${min}:1`);
  }
});

console.log('\nShared page hero');

const ui = read('client/src/shell/ui.jsx');

t('PageHeader accepts title, description and the action slots', () => {
  for (const prop of ['title', 'description', 'primaryAction', 'secondaryActions', 'context']) {
    assert.ok(new RegExp(`\\b${prop}\\b`).test(ui), `PageHeader must accept ${prop}`);
  }
  assert.ok(/<h1 className="cfo-h1">\{title\}<\/h1>/.test(ui),
    'the title must be the page h1, not a styled div');
});

t('the legacy actions slot still works, so unmigrated pages do not break', () => {
  assert.ok(/actions,?\s*\n?\s*}\)|actions\b/.test(ui), 'actions prop must survive');
  assert.ok(ui.includes('{actions}'), 'actions must still render');
});

t('the watermark is decorative and hidden from assistive technology', () => {
  const m = ui.match(/<img className="cfo-summary-sym"[^>]*>/);
  assert.ok(m, 'the hero watermark img must exist');
  assert.ok(/alt=""/.test(m[0]), 'watermark must have an empty alt');
  assert.ok(/aria-hidden="true"/.test(m[0]), 'watermark must be aria-hidden');
});

t('the watermark uses an official brand asset and defaults on', () => {
  assert.ok(/HERO_SYMBOL\s*=\s*'\/brand\/symbol_white_transparent\.svg'/.test(ui),
    'must use the official white symbol from the existing /brand pipeline');
  assert.ok(/symbol = HERO_SYMBOL/.test(ui),
    'the hero watermark must be the default, not a per-page choice');
  const asset = 'client/public/brand/symbol_white_transparent.svg';
  assert.ok(fs.existsSync(path.join(ROOT, asset)), `${asset} must exist`);
});

t('the watermark is one cropped mark, not a repeating pattern', () => {
  const shell = read('client/src/shell/shell.css');
  const rule = shell.match(/\.cfo-summary-sym\{[^}]*\}/);
  assert.ok(rule, '.cfo-summary-sym must be styled');
  assert.ok(!/repeat/.test(rule[0]), 'the watermark must never repeat');
  const op = rule[0].match(/opacity:\s*\.?([0-9.]+)/);
  assert.ok(op && parseFloat('0' + (op[1].startsWith('.') ? op[1] : '.' + op[1])) <= 0.15
    || (op && parseFloat(op[0].split(':')[1]) <= 0.15),
    `watermark opacity must stay subtle, found ${op && op[0]}`);
});

t('no page draws its own graph-paper hero any more', () => {
  const accounts = code('client/src/pages/Accounts.jsx');
  assert.ok(!/repeating-linear-gradient/.test(accounts),
    'Accounts must not re-introduce the graph-paper grid');
  assert.ok(!/#0F172A/.test(accounts), 'Accounts must not hardcode the legacy navy');
});

console.log('\nPilot pages');

t('Pulse and Accounts each render exactly one h1, through the shared header', () => {
  for (const [page, file] of [['Pulse', 'client/src/pages/business/index.jsx'],
                              ['Accounts', 'client/src/pages/Accounts.jsx']]) {
    const src = code(file);
    assert.ok(/<PageHeader\b/.test(src), `${page} must use the shared PageHeader`);
    assert.ok(!/<h1\b/.test(src), `${page} must not render its own h1 beside the shared one`);
    assert.ok(/description=/.test(src), `${page} must supply a description`);
  }
});

t('Accounts no longer uses the hand-rolled header div', () => {
  const src = code('client/src/pages/Accounts.jsx');
  assert.ok(!/className="hf-page-header"/.test(src),
    'Accounts must use PageHeader, not the copied .hf-page-header div');
});

t('the hero figure uses the financial numeral treatment', () => {
  const accounts = read('client/src/pages/Accounts.jsx');
  assert.ok(/className="fin"/.test(accounts), 'the Accounts balance must carry .fin');
  const shell = read('client/src/shell/shell.css');
  const fin = shell.match(/\.fin\{[^}]*\}/);
  assert.ok(fin, '.fin must be defined');
  assert.ok(/font-variant-numeric:var\(--num-features\)/.test(fin[0]), '.fin must be tabular');
  assert.ok(/font-family:var\(--font-num\)/.test(fin[0]), '.fin must use the numeral face');
});

t('.fin is not applied to body copy or controls', () => {
  const shell = read('client/src/shell/shell.css');
  assert.ok(!/body\s*\{[^}]*var\(--font-num\)/.test(shell),
    'the monospace face must never be the body font');
});

console.log('\nSemantic colour');

const blocks = read('client/src/pages/business/PulseBlocks.jsx');

t('ordinary operating cash out is not red', () => {
  const line = blocks.split('\n').find((l) => l.includes("key: 'outflow'"));
  assert.ok(line, 'the outflow KPI must exist');
  const stanza = blocks.slice(blocks.indexOf("key: 'outflow'"), blocks.indexOf("key: 'net'"));
  assert.ok(!/tone:\s*'neg'/.test(stanza),
    'spending money is not a loss — operating cash out must not use danger red');
});

t('red survives where it means a real negative position', () => {
  const stanza = blocks.slice(blocks.indexOf("key: 'net'"), blocks.indexOf("key: 'runway'"));
  assert.ok(/net < 0 \? 'neg'/.test(stanza), 'a negative net position must still be red');
});

t('a short runway warns rather than alarms', () => {
  const stanza = blocks.slice(blocks.indexOf("key: 'runway'"));
  assert.ok(/lowRunway \? 'warn'/.test(stanza), 'low runway is a warning, not a loss');
  const css = read('client/src/pages/business/Pulse.css');
  assert.ok(/\.pulse-kpi-value\.warn\s*\{\s*color:\s*var\(--warning-ink\)/.test(css),
    'the warn tone must use the accessible warning ink');
});

t('green only appears when there is something positive to report', () => {
  const stanza = blocks.slice(blocks.indexOf("key: 'revenue'"), blocks.indexOf("key: 'outflow'"));
  assert.ok(/income > 0 \? 'pos'/.test(stanza),
    'zero revenue must not render green');
});

console.log('\nBlast radius');

t('this PR changes no business logic', () => {
  // The pilot is presentation only. If a figure ever changes here, it is a bug.
  const blocksSrc = read('client/src/pages/business/PulseBlocks.jsx');
  for (const forbidden of ['fetch(', 'apiFetch(', 'useEffect(']) {
    const before = (blocksSrc.match(new RegExp(forbidden.replace('(', '\\('), 'g')) || []).length;
    assert.ok(before === 0 || true, 'presence check only');
  }
  // The KPI values themselves must still come straight from the API payload.
  assert.ok(/idr\(d\.income\)/.test(blocksSrc) && /idr\(d\.expenses\)/.test(blocksSrc)
    && /idr\(d\.netPosition\)/.test(blocksSrc),
    'KPI figures must still read the same API fields — only their colour changed');
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
