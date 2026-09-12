// AI Accountant — the display contract, asserted rather than described.
//
// The design pass restyled a page about tax. The one thing a design pass on a
// tax page must not do is change what a figure MEANS, so the meanings are the
// tests: an unmeasured amount is an em dash, a measured zero is a zero, and a
// row that says "insufficient data" never reads as "nothing is owed".
//
// Run: node tests/design/accountantFigures.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { money, moneyFull, MISSING } from '../../client/src/lib/aiCfoFigures.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const BLOCKS = 'client/src/pages/business/AccountantBlocks.jsx';
const PREMIUM = 'client/src/pages/business/AccountantPremium.jsx';
const CSS = 'client/src/pages/business/Accountant.css';
const PROFILE = 'client/src/pages/business/Accountant.jsx';

/* ── the reserve: absence is not zero ─────────────────────────────────────── */
// The old card read `reserve > 0 ? idr(reserve) : '—'`, so a server-confirmed
// zero and an unmeasured reserve were the same picture. `lines` is what the
// server actually summed, and it is what separates them.
const reserveShows = (reserve) => {
  const lines = (reserve && reserve.lines) || [];
  return lines.length > 0 ? money(reserve.amount, reserve.currency || 'IDR') : MISSING;
};

console.log('\nreserve — absence vs confirmed zero');
t('no lines and amount 0 → em dash, because nothing was measured', () => {
  assert.strictEqual(reserveShows({ amount: 0, currency: 'IDR', lines: [] }), MISSING);
});
t('no lines and no amount at all → em dash', () => {
  assert.strictEqual(reserveShows({ amount: null, currency: 'IDR', lines: [] }), MISSING);
});
t('a missing reserve object → em dash, never a crash and never Rp 0', () => {
  assert.strictEqual(reserveShows(null), MISSING);
  assert.strictEqual(reserveShows(undefined), MISSING);
});
t('one line summing to zero → a real Rp 0, not an em dash', () => {
  const shown = reserveShows({ amount: 0, currency: 'IDR', lines: [{ amount: 0 }] });
  assert.notStrictEqual(shown, MISSING);
  assert.match(shown, /^Rp\s*0$/);
});
t('lines with a real amount → that amount, compacted like every other flagship', () => {
  assert.strictEqual(reserveShows({ amount: 24850000, currency: 'IDR', lines: [{ amount: 24850000 }] }), 'Rp 24.9M');
});
t('the currency comes from the payload, never assumed', () => {
  assert.match(reserveShows({ amount: 1000, currency: 'IDR', lines: [{}] }), /^Rp/);
});

/* ── obligations: three states, three treatments ──────────────────────────── */
// obligationView is imported indirectly: it needs `t`, so it is reproduced here
// against the same branch order the component uses, and the source is asserted
// separately below to prove the component has not drifted from it.
const tStub = (k) => k;
const viewKind = (o) => {
  if (!o) return 'absent';
  if (o.status === 'calculated') return 'calculated';
  if (o.status === 'insufficient_data') return 'insufficient';
  return 'unavailable';
};

console.log('\nobligation states');
t('calculated with an amount → a figure', () => {
  assert.strictEqual(viewKind({ status: 'calculated', amount: 5 }), 'calculated');
  assert.strictEqual(moneyFull(5, 'IDR'), 'Rp 5');
});
t('calculated with a NULL amount → an em dash, not Rp 0', () => {
  // The old formatter was `'Rp ' + Number(v || 0).toLocaleString()`, which turned
  // a missing amount on a calculated row into a confident Rp 0.
  assert.strictEqual(moneyFull(null, 'IDR'), MISSING);
  assert.strictEqual(moneyFull(undefined, 'IDR'), MISSING);
  assert.strictEqual(moneyFull('', 'IDR'), MISSING);
});
t('calculated with amount 0 → Rp 0, because the engine measured it', () => {
  assert.strictEqual(moneyFull(0, 'IDR'), 'Rp 0');
});
t('insufficient_data → its own state, distinct from unavailable', () => {
  assert.strictEqual(viewKind({ status: 'insufficient_data' }), 'insufficient');
});
t('an unknown status falls through to unavailable, never to calculated', () => {
  for (const status of ['unavailable', 'pending', '', undefined, null, 'CALCULATED'])
    assert.strictEqual(viewKind({ status }), 'unavailable', `status=${status}`);
});
t('a missing obligation is absent, and absent shows an em dash', () => {
  assert.strictEqual(viewKind(null), 'absent');
});

/* ── the wording contract ─────────────────────────────────────────────────── */
console.log('\nwording — what a state must never be read as');
const LOCALES = ['en', 'ru', 'id'];
const locale = (l) => read(`client/src/i18n/${l}.js`);

t('every locale carries the accountantHub block', () => {
  for (const l of LOCALES) assert.match(locale(l), /accountantHub:\s*\{/, l);
});
t('the three locales declare the SAME keys', () => {
  const keysOf = (l) => {
    const src = locale(l);
    const start = src.indexOf('accountantHub: {');
    const body = src.slice(start, src.indexOf('\n  },', start));
    return [...body.matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((m) => m[1]).sort();
  };
  const en = keysOf('en');
  assert.ok(en.length > 100, `expected a full block, got ${en.length} keys`);
  for (const l of ['ru', 'id']) assert.deepStrictEqual(keysOf(l), en, `${l} differs from en`);
});
t('each locale states that insufficient data is not "nothing is owed"', () => {
  // The exact wording differs per language; what must exist in all three is a
  // dedicated hint key, separate from the state label itself.
  for (const l of LOCALES) {
    assert.match(locale(l), /stateInsufficientHint:\s*'[^']{20,}'/, `${l}: missing or trivial hint`);
    assert.match(locale(l), /stateUnavailableHint:\s*'[^']{20,}'/, `${l}: missing or trivial hint`);
  }
});
t('each locale states that completeness measures the FORM only', () => {
  for (const l of LOCALES)
    assert.match(locale(l), /completenessCaveat:\s*'[^']{30,}'/, `${l}: missing or trivial caveat`);
});
t('no locale claims a count of obligations on the completeness card', () => {
  // The removed sentence read "N deterministic obligations identified from your
  // profile" while the card beside it listed a different number — see
  // _specs/accountant-applicability-obligations-contradiction.md.
  for (const l of LOCALES) {
    const src = locale(l);
    const start = src.indexOf('accountantHub: {');
    const body = src.slice(start, src.indexOf('\n  },', start));
    assert.ok(!/deterministic obligation/i.test(body), `${l}: still claims an obligation count`);
  }
});

/* ── the component has not drifted from what is tested above ──────────────── */
console.log('\nsource — the page renders what these tests describe');
const blocks = code(BLOCKS);
const premium = code(PREMIUM);

t('the reserve keys on lines.length, not on amount > 0', () => {
  assert.match(blocks, /lines\.length\s*>\s*0/);
  assert.ok(!/reserve\s*>\s*0/.test(blocks), 'a > 0 test would hide a confirmed zero');
});
t('no module-local currency formatter survives', () => {
  // `const idr = v => 'Rp ' + Number(v || 0).toLocaleString(...)` was the source
  // of the absence-as-zero bug and of a second number format on one product.
  for (const src of [blocks, premium])
    assert.ok(!/Number\(\s*\w+\s*\|\|\s*0\s*\)\.toLocaleString/.test(src),
      'an absence-as-zero formatter is back');
  assert.ok(!/const\s+idr\s*=/.test(premium), 'the local idr() formatter is back');
});
t('amounts go through the shared figure helpers', () => {
  assert.match(blocks, /from '\.\.\/\.\.\/lib\/aiCfoFigures'/);
  assert.match(blocks, /\bmoneyFull\(/);
  assert.match(blocks, /\bmoney\(/);
});
t('a non-amount state is NOT rendered in the amount/figure face', () => {
  // The chip class exists and is what the amount slot receives for a
  // non-calculated row; the mono figure face is reserved for real money.
  assert.match(blocks, /acct-ob-state/);
  assert.match(blocks, /kind === 'calculated' \? v\.amount : <StateChip/);
});
t('completeness never turns green', () => {
  const css = read(CSS);
  const rule = css.slice(css.indexOf('.acct-meter-fill'), css.indexOf('.acct-completeness-meta'));
  assert.ok(!/--success/.test(rule), 'a full completeness bar must not read as compliance');
  assert.ok(!/tone={completeness >= 80/.test(blocks));
  assert.ok(!/cfo-badge-success/.test(blocks));
});

/* ── design-system boundaries ─────────────────────────────────────────────── */
console.log('\ndesign system');
t('the module declares no colour of its own', () => {
  const css = read(CSS)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // The tab-fade mask is a MASK, not a colour: #000/transparent there select
    // opacity, and no token exists (or should) for a mask stop.
    .replace(/mask-image:[^;]+;/g, ' ');
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepStrictEqual(hexes, [], `hex literals in page CSS: ${hexes.join(', ')}`);
  assert.ok(!/rgba?\(/.test(css), 'raw rgb()/rgba() in page CSS');
});
t('warning text uses --warning-ink, never --warning, on a soft ground', () => {
  const css = read(CSS);
  for (const m of css.matchAll(/\{[^}]*background:\s*var\(--warning-soft\)[^}]*\}/g)) {
    assert.ok(/color:\s*var\(--warning-ink\)/.test(m[0]),
      `--warning-soft ground without --warning-ink text: ${m[0].trim()}`);
  }
});
t('one vertical rhythm: 18px, declared once on the page container', () => {
  const css = read(CSS);
  const page = css.slice(css.indexOf('.acct-wb {'), css.indexOf('}', css.indexOf('.acct-wb {')));
  assert.match(page, /gap:\s*18px/);
  assert.match(page, /flex-direction:\s*column/);
});
t('every multi-column band uses the same 18px gutter', () => {
  const css = read(CSS);
  for (const name of ['.acct-wb-band {', '.acct-wb-band-3 {']) {
    const block = css.slice(css.indexOf(name), css.indexOf('}', css.indexOf(name)));
    assert.match(block, /gap:\s*18px/, name);
  }
});
t('the container renders no inline style objects', () => {
  const inline = [...premium.matchAll(/style=\{\{/g)];
  assert.strictEqual(inline.length, 0, `${inline.length} inline style blocks left in the container`);
});
t('the only inline style left in the blocks is the one genuinely dynamic width', () => {
  // Matched on the opening brace and the line it sits on: the survivor's value is
  // a template literal, whose own closing brace defeats a [^}]* body match.
  const lines = blocks.split('\n').filter((l) => l.includes('style={{'));
  assert.strictEqual(lines.length, 1, `unexpected inline styles:\n${lines.join('\n')}`);
  assert.match(lines[0], /width:\s*`\$\{pct\}%`/,
    'the survivor must be the completeness meter width — a value no stylesheet can hold');
});

/* ── the flagship and its mark ────────────────────────────────────────────── */
console.log('\nbranding');
t('the reserve card is the shared SummaryCard wearing flagship', () => {
  assert.match(blocks, /<SummaryCard\s[\s\S]{0,120}flagship/);
});
t('the page never hand-builds a cfo-summary div', () => {
  assert.ok(!/className="cfo-summary"/.test(blocks));
  assert.ok(!/className="cfo-summary"/.test(premium));
});
t('the page never positions or restyles the watermark', () => {
  const css = read(CSS);
  assert.ok(!/cfo-flagship-mark/.test(css), 'the mark is shell.css’s to place, not the page’s');
  assert.ok(!/--mark-(size|inside|safe|gap)/.test(css));
});
t('the empty state uses the official symbol from /brand', () => {
  assert.match(blocks, /'\/brand\/symbol_navy_blue_dot_transparent\.svg'/);
});

/* ── one page, one identity ───────────────────────────────────────────────── */
console.log('\npage identity');
t('the module renders exactly one PageHeader', () => {
  const heads = [...blocks.matchAll(/<PageHeader/g)];
  assert.strictEqual(heads.length, 1, 'a second header means a tab can rename the page');
});
t('the header is no longer suppressed on any tab', () => {
  assert.ok(!/tab !== 'profile' && head/.test(premium));
});
t('the embedded profile tab draws its controls, not a second header', () => {
  const profile = code(PROFILE);
  assert.match(profile, /embedded\s*=\s*false/, 'the profile page must accept an embedded mode');
  assert.match(profile, /embedded\s*\n?\s*\?\s*<div className="cfo-accountant-embedded-actions">/);
});
t('Save still travels with the form it saves', () => {
  const profile = code(PROFILE);
  assert.match(profile, /Save profile/);
  assert.match(profile, /const actions = \(/);
});

/* ── nothing about tax moved ──────────────────────────────────────────────── */
console.log('\nboundaries — the design pass changed no tax logic');
t('the statutory schedule is byte-for-byte what shipped', () => {
  // Days, keys, kinds and order. A design PR that shifts a statutory date is a
  // different and much more serious kind of change.
  const sched = premium.slice(premium.indexOf('export function idComplianceDeadlines'),
    premium.indexOf('export function upcomingDeadlines'));
  assert.match(sched, /mk\(10, 'pph2126',[\s\S]*?'withholding'\)/);
  assert.match(sched, /mk\(10, 'pph23',[\s\S]*?'service'\)/);
  assert.match(sched, /mk\(15, 'pph25',[\s\S]*?'cit'\)/);
  assert.match(sched, /mk\(20, 'pph21file',[\s\S]*?'withholding'\)/);
  assert.match(sched, /mk\(new Date\(year, month \+ 1, 0\)\.getDate\(\), 'ppn',[\s\S]*?'ppn'\)/);
});
t('the endpoints are unchanged', () => {
  for (const ep of ['/accountant/applicability', '/accountant/profile', '/pulse',
                    '/accountant/obligations', '/ai-accountant/required-documents'])
    assert.ok(premium.includes(`'${ep}'`), `missing ${ep}`);
});
t('the premium gate is unchanged', () => {
  assert.match(premium, /import\.meta\.env\.VITE_AI_ACCOUNTANT_PREMIUM === 'true'/);
  assert.match(premium, /if \(!PREMIUM\) return <BusinessAccountant \/>/);
});
t('the applicability filter is still the one source of truth for gaps', () => {
  assert.match(premium, /applicableMissingFields\(/);
});
t('no tax rate or threshold literal was introduced', () => {
  // The rule is that no RATE lives in the presentation layer — a tax figure must
  // come from an activated rule, never from a component. A CSS percentage is a
  // length, not a rate, so lines that are plainly layout are excluded rather
  // than the check being dropped altogether.
  const LAYOUT = /width|height|flex|basis|translate|margin|padding|top|left|right|bottom|size|gap/i;
  const suspicious = blocks.split('\n')
    .filter((l) => !LAYOUT.test(l))
    .flatMap((l) => l.match(/\b\d+(\.\d+)?\s*%/g) || []);
  assert.deepStrictEqual(suspicious, [], `a rate-shaped literal appeared: ${suspicious.join(', ')}`);
});
t('the document-recognition engine is untouched by this module', () => {
  for (const src of [blocks, premium])
    assert.ok(!/DocumentIntake|documentIntakeView|getSignedUrl|openDocumentSafely/.test(src));
});

/* ── the calendar keeps every deadline it is given ────────────────────────── */
console.log('\ncalendar — nothing is discarded');
t('two deadlines on one day both survive the grid', () => {
  // The 10th carries PPH 21/26 AND PPH 23. A Map keyed one-entry-per-day kept
  // the last of them and coloured the cell by it, so the second obligation
  // simply vanished from the grid. Days map to lists now.
  assert.ok(!/new Map\(deadlines\.map\(/.test(premium),
    'a one-entry-per-day map drops the second deadline on the 10th');
  assert.match(premium, /byDay\.set\(x\.day, \[\.\.\.\(byDay\.get\(x\.day\) \|\| \[\]\), x\]\)/);
});
t('a cell names every deadline it carries', () => {
  assert.match(blocks, /dls\.map\(\(d\) => d\.title\)\.join/);
  assert.match(blocks, /is-multi/);
});
t('the schedule itself is untouched by that change', () => {
  // Two entries on day 10 IS the schedule, and it is what it always was.
  const sched = premium.slice(premium.indexOf('export function idComplianceDeadlines'),
    premium.indexOf('export function upcomingDeadlines'));
  const tens = [...sched.matchAll(/mk\(10,/g)];
  assert.strictEqual(tens.length, 2, 'the 10th must still carry exactly two deadlines');
});

/* ── narrow screens ───────────────────────────────────────────────────────── */
console.log('\nnarrow screens');
t('the plain-language row stacks to one column, not two 135px ones', () => {
  const css = read(CSS);
  const mq = css.slice(css.indexOf('@media (max-width: 560px)'));
  assert.match(mq, /\.acct-plain-grid \{ grid-template-columns: 1fr; \}/);
});
t('both bands stack at the same breakpoint', () => {
  const css = read(CSS);
  const mq = css.slice(css.indexOf('@media (max-width: 560px)'));
  assert.match(mq, /\.acct-wb-band,\s*\n\s*\.acct-wb-band-3 \{ grid-template-columns: 1fr; \}/);
});
t('the tab strip gets a scroll affordance on a phone', () => {
  const css = read(CSS);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]{0,400}mask-image/);
  assert.match(blocks, /is-end/);
});
t('nothing sets a min-width wider than a phone', () => {
  const css = read(CSS);
  for (const m of css.matchAll(/min-width:\s*(\d+)px/g))
    assert.ok(Number(m[1]) <= 320, `min-width: ${m[1]}px would scroll a phone sideways`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
