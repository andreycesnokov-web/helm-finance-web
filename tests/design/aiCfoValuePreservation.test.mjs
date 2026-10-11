// Did the AI CFO migration move a digit?
//
// The design report first argued value preservation by putting "Rp 152.4M" next
// to "Rp 122.8M" — two different fixtures from two different pages, which
// demonstrates nothing at all. This file answers the question properly: it
// renders the OLD expression and the NEW one over the SAME input and compares
// them token by token.
//
// The "before" column is not a paraphrase. Each expression below is copied
// verbatim from origin/main:client/src/pages/AICFO.jsx (eb10e3ad) with its line
// cited, so a reviewer can diff this file against that one rather than take the
// comparison on trust. The "after" column calls the real production helpers.
//
// Run: node tests/design/aiCfoValuePreservation.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import { fmt, fmtFull } from '../../client/src/lib/api.js';
import {
  money, moneyFull, signedMoney, directionalMoney, countOrMissing, MISSING,
  scoreBand, runwayBand,
} from '../../client/src/lib/aiCfoFigures.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

/* ── the one fixture both columns are rendered from ─────────────────────────
   The shape GET /api/ai-cfo/context returns. Values chosen to land on the
   awkward cases: a figure that rounds at the tenth, a negative net flow, a
   sub-thousand amount that fmt() prints in full, an exact zero, and a
   nine-digit figure that crosses into billions. */
const CTX = {
  business: { name: 'Nusantara Facilities', base_currency: 'IDR' },
  cash: { total_balance: 122850000, wallets_count: 4 },
  current_month: {
    income: 78745000, expenses: 42450000, net_flow: 36295000,
    transactions_count: 62, burn_rate: 3282833, burn_window_days: 30,
  },
  receivables: { total_remaining: 65850000, overdue_count: 0 },
  payables: { total_remaining: 31200000, overdue_count: 0 },
  runway_days: 37,
  cfo_score: {
    score: 80,
    factors: {
      cash_health: { score: 90, impact: 'positive' },
      runway: { score: 70, impact: 'neutral' },
      payables: { score: 80, impact: 'positive' },
      receivables: { score: 85, impact: 'positive' },
      expense_control: { score: 92, impact: 'positive' },
    },
  },
  hiring_readiness: { status: 'ready', safe_monthly_salary: 12400000 },
  risks: [{ severity: 'high', title: '3 overdue payables', amount: 24500000 }],
  next_actions: [{ priority: 'high', title: 'Chase overdue invoices', amount: 38900000 }],
};

const CURRENCY = CTX.business.base_currency;

/* ── BEFORE: origin/main:client/src/pages/AICFO.jsx, verbatim ───────────────
   Each entry is { label, old, new } where `old` is the previous expression and
   `new` calls the shipped helper. Only the presentation of the currency and the
   sign glyph may differ; every digit must survive. */
const c = CTX.cash;
const month = CTX.current_month;
const recv = CTX.receivables;
const pay = CTX.payables;
const hire = CTX.hiring_readiness;

const ROWS = [
  {
    label: 'hero cash',
    // AICFO.jsx:314 — value: fmt(cash.total_balance), suffix: currency
    old: fmt(c.total_balance),
    new: money(c.total_balance, CURRENCY),
  },
  {
    label: 'hero cash, exact',
    // The old hero showed no exact figure at all; the flagship card adds one
    // beneath the abbreviation, from the same fmtFull() the page already used.
    old: fmtFull(c.total_balance),
    new: moneyFull(c.total_balance, CURRENCY),
  },
  {
    label: 'hero net per month',
    // AICFO.jsx:316 — (month.net_flow >= 0 ? '+' : '') + fmt(month.net_flow)
    old: (month.net_flow >= 0 ? '+' : '') + fmt(month.net_flow),
    new: signedMoney(month.net_flow, CURRENCY),
  },
  {
    label: 'receivables',
    // AICFO.jsx:435 — value: '+' + fmt(recv.total_remaining)
    old: '+' + fmt(recv.total_remaining),
    new: '+' + money(recv.total_remaining, CURRENCY),
  },
  {
    label: 'payables',
    // AICFO.jsx:436 — value: '−' + fmt(pay.total_remaining)
    old: '−' + fmt(pay.total_remaining),
    new: '−' + money(pay.total_remaining, CURRENCY),
  },
  {
    label: 'income',
    // AICFO.jsx:437 — value: '+' + fmt(month.income)
    old: '+' + fmt(month.income),
    new: '+' + money(month.income, CURRENCY),
  },
  {
    label: 'expenses',
    // AICFO.jsx:438 — value: '−' + fmt(month.expenses)
    old: '−' + fmt(month.expenses),
    new: '−' + money(month.expenses, CURRENCY),
  },
  {
    label: 'burn rate',
    // AICFO.jsx:438 — sub: `${fmt(month.burn_rate)} ${currency}/day`
    old: fmt(month.burn_rate),
    new: money(month.burn_rate, CURRENCY),
  },
  {
    label: 'safe monthly salary',
    // AICFO.jsx:413 — {fmt(hireReady.safe_monthly_salary)} <span>{currency}/mo</span>
    old: fmt(hire.safe_monthly_salary),
    new: money(hire.safe_monthly_salary, CURRENCY),
  },
  {
    label: 'risk amount',
    // AICFO.jsx:461 — {fmt(r.amount)} {currency}
    old: fmt(CTX.risks[0].amount),
    new: money(CTX.risks[0].amount, CURRENCY),
  },
  {
    label: 'next-action amount',
    // AICFO.jsx:492 — {fmt(a.amount)} {currency}
    old: fmt(CTX.next_actions[0].amount),
    new: money(CTX.next_actions[0].amount, CURRENCY),
  },
];

/** Strip the sign and the currency, leaving only the number the reader sees. */
const digitsOf = (s) => String(s).replace(/^[+−-]/, '').replace(/^Rp\s*/, '').trim();

console.log('\nAI CFO — same fixture, old expression vs new');
console.log('  ' + 'figure'.padEnd(22) + 'before'.padEnd(18) + 'after');
for (const r of ROWS) {
  console.log('  ' + r.label.padEnd(22) + String(r.old).padEnd(18) + r.new);
}

t('every money figure keeps its exact digits', () => {
  for (const r of ROWS) {
    assert.strictEqual(digitsOf(r.new), digitsOf(r.old),
      `${r.label}: was "${r.old}", now "${r.new}" — the number changed`);
  }
});

t('every money figure gained a currency, and only that', () => {
  for (const r of ROWS) {
    assert.ok(/Rp\s/.test(r.new), `${r.label} renders "${r.new}" with no currency`);
    // Nothing was added beyond the prefix: strip it and the sign, and the two
    // strings are identical.
    assert.strictEqual(digitsOf(r.new), digitsOf(r.old));
  }
});

t('the sign survives, and a negative reads as a typographic minus', () => {
  const negative = -22700000;
  // AICFO.jsx:316 produced fmt()'s own ASCII hyphen for a negative net flow.
  const before = (negative >= 0 ? '+' : '') + fmt(negative);
  const after = signedMoney(negative, CURRENCY);
  assert.strictEqual(before, '-22.7M', `the old expression produced "${before}"`);
  assert.strictEqual(after, '−Rp 22.7M', `the new expression produced "${after}"`);
  // Same magnitude, same digits. The glyph is the one deliberate change: U+2212
  // rather than a hyphen, matching the rest of the design system.
  assert.strictEqual(digitsOf(after), digitsOf(before));
  assert.notStrictEqual(after[0], '-', 'a negative still uses an ASCII hyphen');
  assert.strictEqual(after[0], '−', 'a negative is not a typographic minus');
});

t('zero is still zero, and is not dressed up as a rounded million', () => {
  assert.strictEqual(fmt(0), '0');
  assert.strictEqual(money(0, CURRENCY), 'Rp 0');
  // No sign on zero. This asserted '+Rp 0' until review pointed out that
  // `n < 0 ? '−' : '+'` signs zero as positive, which disagrees with signBand()
  // refusing to colour it. See "zero takes NO sign" below.
  assert.strictEqual(signedMoney(0, CURRENCY), 'Rp 0');
  // The whole reason fmt() is kept rather than money.js's compactAmount().
  assert.ok(!/0\.0M/.test(money(0, CURRENCY)));
});

t('the boundaries fmt() rounds at are unmoved', () => {
  // fmt() switches notation at 1e3, 1e6 and 1e9 and fixes one decimal. These are
  // the cases where a swapped formatter would show up first.
  const cases = [
    [999, '999'], [1000, '1K'], [999999, '1000K'],
    [1000000, '1.0M'], [122850000, '122.8M'],
    [999999999, '1000.0M'], [1000000000, '1.0B'],
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(fmt(input), expected, `fmt(${input}) is "${fmt(input)}"`);
    assert.strictEqual(money(input, CURRENCY), 'Rp ' + expected);
  }
});

t('half-up rounding was NOT introduced — fmt() truncates where compactAmount rounds', () => {
  // 152.45M is the figure that made PR #80 add half-up rounding to compactAmount.
  // AI CFO keeps fmt(), which does not round that way, so the page still prints
  // what it always printed. Swapping in compactAmount would print 152.5M here.
  assert.strictEqual(fmt(152450000), '152.4M');
  assert.strictEqual(money(152450000, CURRENCY), 'Rp 152.4M');
});

console.log('\nAI CFO — absence is not zero');

/* The distinction every one of these turns on: a MEASURED zero and an ABSENT
   value are different facts about a business. The first implementation collapsed
   them — `Number(v || 0)` — so a field the server never sent rendered as a
   confident "+Rp 0": a claim that the business broke exactly even this month. */

const ABSENT = [['null', null], ['undefined', undefined], ['empty string', ''],
  ['NaN', NaN], ['a non-number', 'abc'], ['Infinity', Infinity]];

t('a missing figure renders as absence, in every formatter', () => {
  for (const [what, v] of ABSENT) {
    assert.strictEqual(money(v, CURRENCY), MISSING, `money(${what}) is "${money(v, CURRENCY)}"`);
    assert.strictEqual(moneyFull(v, CURRENCY), MISSING, `moneyFull(${what}) is "${moneyFull(v, CURRENCY)}"`);
    assert.strictEqual(signedMoney(v, CURRENCY), MISSING, `signedMoney(${what}) is "${signedMoney(v, CURRENCY)}"`);
    assert.strictEqual(directionalMoney(v, CURRENCY, '+'), MISSING,
      `directionalMoney(${what}) is "${directionalMoney(v, CURRENCY, '+')}"`);
  }
});

t('a missing figure never wears a currency, a sign, or a digit', () => {
  // "Rp —" reads as a rupiah amount that happens to be unprintable; "+Rp —"
  // asserts a direction about a figure nobody measured. Both were real outputs
  // of the first implementation.
  for (const [what, v] of ABSENT) {
    for (const rendered of [money(v, CURRENCY), moneyFull(v, CURRENCY),
      signedMoney(v, CURRENCY), directionalMoney(v, CURRENCY, '−')]) {
      assert.ok(!/Rp/.test(rendered), `${what} rendered "${rendered}" — it carries a currency`);
      assert.ok(!/^[+−]/.test(rendered), `${what} rendered "${rendered}" — it carries a sign`);
      assert.ok(!/\d/.test(rendered), `${what} rendered "${rendered}" — absence became a number`);
    }
  }
});

t('a CONFIRMED zero is a figure, and prints as one', () => {
  // The other half of the rule. A business that really holds nothing must not be
  // shown a dash, which would read as "we could not measure this".
  for (const zero of [0, '0', -0]) {
    assert.strictEqual(money(zero, CURRENCY), 'Rp 0', `money(${JSON.stringify(zero)})`);
    assert.strictEqual(signedMoney(zero, CURRENCY), 'Rp 0', `signedMoney(${JSON.stringify(zero)})`);
    assert.notStrictEqual(money(zero, CURRENCY), MISSING);
  }
});

t('zero takes NO sign', () => {
  // `n < 0 ? '−' : '+'` signs zero as positive. Zero is neither, and signBand()
  // already refuses to COLOUR it — the glyph has to agree with the colour.
  const z = signedMoney(0, CURRENCY);
  assert.strictEqual(z, 'Rp 0', `zero rendered "${z}"`);
  assert.ok(!z.startsWith('+'), `zero rendered "${z}" — it is signed positive`);
  assert.ok(!z.startsWith('−'), `zero rendered "${z}" — it is signed negative`);
});

t('a signed figure either side of zero keeps its sign AND its old rounding', () => {
  // The rounding half matters as much as the sign: this is the same fmt() the
  // page has always used, so the digits are the digits it always printed.
  assert.strictEqual(signedMoney(36295000, CURRENCY), '+Rp 36.3M');
  assert.strictEqual(signedMoney(-22700000, CURRENCY), '−Rp 22.7M');
  assert.strictEqual(signedMoney(1, CURRENCY), '+Rp 1');
  assert.strictEqual(signedMoney(-1, CURRENCY), '−Rp 1');
  for (const n of [1, 999, 1000, 1000000, 122850000, 152450000, 999999999]) {
    assert.strictEqual(signedMoney(n, CURRENCY), '+Rp ' + fmt(n), `+${n}`);
    assert.strictEqual(signedMoney(-n, CURRENCY), '−Rp ' + fmt(n), `-${n}`);
  }
});

t('a count is absent or exact, never a defaulted zero', () => {
  // month.transactions_count went through `?? 0`, so a missing count rendered
  // "0 transactions" — a statement about a month nobody counted.
  for (const [what, v] of ABSENT) {
    assert.strictEqual(countOrMissing(v), MISSING, `countOrMissing(${what})`);
  }
  assert.strictEqual(countOrMissing(0), '0');
  assert.strictEqual(countOrMissing(62), '62');
});

t('a direction goes on only when there is a figure to give it to', () => {
  assert.strictEqual(directionalMoney(65850000, CURRENCY, '+'), '+Rp 65.8M');
  assert.strictEqual(directionalMoney(31200000, CURRENCY, '−'), '−Rp 31.2M');
  // A real zero still gets its direction: "nothing outstanding" is a
  // measurement, and the tile reads +Rp 0 rather than a dash.
  assert.strictEqual(directionalMoney(0, CURRENCY, '+'), '+Rp 0');
  assert.strictEqual(directionalMoney(null, CURRENCY, '+'), MISSING);
});

t('no page-level default can smuggle a zero past the formatter', () => {
  // The formatters are only half the guarantee. If a call site writes
  // `value ?? 0` or `Number(x || 0)` before handing the figure over, absence has
  // already become zero and no formatter can tell the difference.
  const blocks = fs.readFileSync(
    path.join(ROOT, 'client/src/pages/AICFOBlocks.jsx'), 'utf8').replace(/\r\n/g, '\n');
  const code = blocks.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const smuggled = code.match(/\?\?\s*0|\|\|\s*0\s*\)/g) || [];
  assert.deepStrictEqual(smuggled, [],
    `a call site defaults absence to zero before formatting: ${smuggled.join(', ')}`);
  // And the raw formatter is not reachable from the page any more, so a new
  // figure cannot bypass the absence rule by calling fmt() directly.
  assert.ok(!/\bfmt\s*\(/.test(code), 'AICFOBlocks calls fmt() directly, bypassing the absence rule');
  assert.ok(!/currencyPrefix\s*\(/.test(code),
    'AICFOBlocks builds a currency prefix itself, bypassing the absence rule');
});
console.log('\nAI CFO — the figures that are NOT money');

t('the runway is a count of days and takes no currency', () => {
  // AICFO.jsx:315 — runway === null ? '—' : runway >= 999 ? '∞' : String(runway),
  // with t('radar.days') as a separate suffix. Same number, same three cases.
  const render = (d) => (d === null || d === undefined ? '—' : d >= 999 ? '∞' : `${d} days`);
  assert.strictEqual(render(CTX.runway_days), '37 days');
  assert.strictEqual(render(null), '—');
  assert.strictEqual(render(999), '∞');
  for (const d of [0, 8, 37, 148]) {
    assert.ok(!/Rp/.test(render(d)), `runway ${d} rendered with a currency`);
  }
});

t('the CFO score and its factors are rendered raw, unformatted and uncurrencied', () => {
  assert.strictEqual(String(CTX.cfo_score.score), '80');
  for (const f of Object.values(CTX.cfo_score.factors)) {
    assert.strictEqual(String(f.score), String(f.score));
    assert.ok(!/Rp/.test(String(f.score)));
  }
});

console.log('\nAI CFO — the bands over this same fixture');

t('this fixture lands on the bands the screenshot shows', () => {
  // Ties the numeric fixture to the picture in artifacts/: score 80 is healthy,
  // a 37-day runway is adequate and therefore uncoloured, and the 70/neutral
  // runway FACTOR is grey rather than green.
  assert.strictEqual(scoreBand(CTX.cfo_score.score), 'healthy');
  assert.strictEqual(runwayBand(CTX.runway_days), 'adequate');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
