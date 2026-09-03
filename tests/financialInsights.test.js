// Advanced Financial Insights V1 — classification + metric maths.
// Run: node tests/financialInsights.test.js
const assert = require('node:assert');
const { classifyTransaction, computeInsights, effectiveDate } = require('../server/lib/financialInsights');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const tx = (type, category, amount, date, extra = {}) =>
  ({ type, category, description: category, amount_original: amount, transaction_date: date, ...extra });

// ── classification ─────────────────────────────────────────────────────────
t('classifies the demo revenue categories as revenue', () => {
  for (const c of ['DEMO - helmet wash revenue', 'DEMO - advertising slot revenue',
                   'DEMO - co-branding campaign revenue', 'DEMO - partner settlement',
                   'DEMO - Xendit settlement']) {
    assert.strictEqual(classifyTransaction(tx('income', c, 1, '2026-08-01')).class, 'revenue', c);
  }
});

t('classifies the demo direct costs as direct_cost', () => {
  for (const c of ['DEMO - refill/liquid supplies', 'DEMO - maintenance',
                   'DEMO - electricity', 'DEMO - logistics']) {
    assert.strictEqual(classifyTransaction(tx('expense', c, 1, '2026-08-01')).class, 'direct_cost', c);
  }
});

t('classifies the demo operating expenses as operating_expense', () => {
  for (const c of ['DEMO - location rent', 'DEMO - technician salary', 'DEMO - marketing',
                   'DEMO - software subscription', 'DEMO - bank/admin fee']) {
    assert.strictEqual(classifyTransaction(tx('expense', c, 1, '2026-08-01')).class, 'operating_expense', c);
  }
});

t('classifies asset purchases as capex', () => {
  for (const c of ['Equipment purchase', 'New machine for the line', 'Hardware purchase',
                   'asset purchase', 'Pembelian mesin']) {
    assert.strictEqual(classifyTransaction(tx('expense', c, 1, '2026-08-01')).class, 'capex', c);
  }
});

t('equipment MAINTENANCE is not capex — narrow claims must not over-reach', () => {
  assert.strictEqual(classifyTransaction(tx('expense', 'Equipment maintenance', 1, '2026-08-01')).class, 'direct_cost');
  assert.strictEqual(classifyTransaction(tx('expense', 'Machine repair', 1, '2026-08-01')).class, 'unknown');
});

t('classifies tax and interest', () => {
  assert.strictEqual(classifyTransaction(tx('expense', 'PPh Final 4(2) to DJP', 1, '2026-08-01')).class, 'tax');
  assert.strictEqual(classifyTransaction(tx('expense', 'Loan interest', 1, '2026-08-01')).class, 'interest');
  assert.strictEqual(classifyTransaction(tx('expense', 'Owner funding', 1, '2026-08-01')).class, 'financing');
});

t('unrecognised rows stay unknown and are flagged for review', () => {
  const r = classifyTransaction(tx('expense', 'Zzz mystery spend', 1, '2026-08-01'));
  assert.strictEqual(r.class, 'unknown');
  assert.strictEqual(r.needs_review, true);
  // Unrecognised INCOME must never be silently counted as revenue.
  const i = classifyTransaction(tx('income', 'Zzz mystery money', 1, '2026-08-01'));
  assert.strictEqual(i.class, 'unknown');
});

t('transfers and corrections never become P&L lines', () => {
  assert.strictEqual(classifyTransaction(tx('transfer', 'Move to cash', 1, '2026-08-01')).class, 'other');
  assert.strictEqual(classifyTransaction(tx('correction', 'Balance Correction', 1, '2026-08-01')).class, 'other');
});

// ── metric maths ───────────────────────────────────────────────────────────
const BASE = [
  tx('income',  'wash revenue',      10000, '2026-08-05'),
  tx('income',  'advertising slot',   5000, '2026-08-06'),
  tx('expense', 'refill supplies',    3000, '2026-08-07'),   // direct cost
  tx('expense', 'location rent',      2000, '2026-08-08'),   // opex
  tx('expense', 'equipment purchase', 8000, '2026-08-09'),   // capex
  tx('expense', 'PPh tax payment',     500, '2026-08-10'),   // tax
  tx('expense', 'loan interest',       250, '2026-08-11'),   // interest
];

t('revenue minus direct costs = gross profit, and margin is correct', () => {
  const r = computeInsights(BASE);
  assert.strictEqual(r.metrics.revenue, 15000);
  assert.strictEqual(r.metrics.direct_costs, 3000);
  assert.strictEqual(r.metrics.gross_profit, 12000);
  assert.strictEqual(r.metrics.gross_margin, 12000 / 15000);
  assert.strictEqual(r.status.gross_profit, 'available');
});

t('CAPEX is captured but EXCLUDED from EBITDA', () => {
  const r = computeInsights(BASE);
  assert.strictEqual(r.metrics.capex, 8000);
  assert.strictEqual(r.status.capex, 'available');
  // 15000 - 3000 - 2000 = 10000. If capex leaked in it would read 2000.
  assert.strictEqual(r.metrics.estimated_ebitda, 10000);
});

t('tax and interest are excluded from EBITDA but hit net profit', () => {
  const r = computeInsights(BASE);
  assert.strictEqual(r.metrics.tax_expense, 500);
  assert.strictEqual(r.metrics.interest_expense, 250);
  assert.strictEqual(r.metrics.estimated_ebitda, 10000);
  assert.strictEqual(r.metrics.estimated_net_profit, 10000 - 500 - 250);
});

t('OPEX is included in EBITDA', () => {
  const withoutOpex = computeInsights(BASE.filter((x) => x.category !== 'location rent'));
  assert.strictEqual(withoutOpex.metrics.estimated_ebitda, 12000);
});

t('financing never touches any metric', () => {
  const r = computeInsights([...BASE, tx('expense', 'loan repayment', 99999, '2026-08-12')]);
  assert.strictEqual(r.metrics.estimated_ebitda, 10000);
  assert.strictEqual(r.metrics.estimated_net_profit, 9250);
});

// ── date semantics ─────────────────────────────────────────────────────────
t('effective date prefers transaction_date over created_at', () => {
  assert.strictEqual(effectiveDate({ transaction_date: '2026-07-01', created_at: '2026-09-03' }), '2026-07-01');
  assert.strictEqual(effectiveDate({ created_at: '2026-09-03' }), '2026-09-03');
});

t('a back-dated row counts in its transaction month, not the insert month', () => {
  const backdated = [{ type: 'income', category: 'wash revenue', amount_original: 1000,
                       transaction_date: '2026-07-15', created_at: '2026-09-03T10:00:00Z' }];
  const july = computeInsights(backdated, { from: '2026-07-01', to: '2026-07-31' });
  assert.strictEqual(july.metrics.revenue, 1000, 'must land in July');
  const september = computeInsights(backdated, { from: '2026-09-01', to: '2026-09-30' });
  assert.strictEqual(september.metrics.revenue, 0, 'must NOT land in September');
  assert.strictEqual(july.series[0].period, '2026-07');
});

t('series is grouped by effective month and ordered', () => {
  const r = computeInsights([
    tx('income', 'wash revenue', 100, '2026-08-01'),
    tx('income', 'wash revenue', 200, '2026-07-01'),
    tx('income', 'wash revenue', 300, '2026-09-01'),
  ]);
  assert.deepStrictEqual(r.series.map((s) => s.period), ['2026-07', '2026-08', '2026-09']);
  assert.deepStrictEqual(r.series.map((s) => s.revenue), [200, 100, 300]);
});

// ── locked / insufficient states ───────────────────────────────────────────
t('empty business returns locked states and never throws', () => {
  const r = computeInsights([]);
  assert.strictEqual(r.metrics.revenue, 0);
  assert.strictEqual(r.status.ebitda, 'locked');
  assert.strictEqual(r.status.net_profit, 'locked');
  assert.strictEqual(r.status.gross_profit, 'needs_cost_structure');
  assert.strictEqual(r.status.capex, 'needs_asset_structure');
  assert.strictEqual(r.metrics.gross_margin, null);
  assert.strictEqual(r.transactions_considered, 0);
});

t('unknown categories alone do NOT unlock final metrics', () => {
  const r = computeInsights([
    tx('income',  'Zzz mystery money', 5000, '2026-08-01'),
    tx('expense', 'Zzz mystery spend', 4000, '2026-08-02'),
  ]);
  assert.strictEqual(r.metrics.revenue, 0, 'unknown income is not revenue');
  assert.strictEqual(r.metrics.opex, 0, 'unknown expense is not opex');
  assert.strictEqual(r.status.ebitda, 'locked');
  assert.strictEqual(r.status.net_profit, 'locked');
  assert.ok(r.warnings.some((w) => /could not be classified/.test(w)));
});

t('revenue without direct costs reports needs_cost_structure', () => {
  const r = computeInsights([tx('income', 'wash revenue', 5000, '2026-08-01'),
                             tx('expense', 'location rent', 1000, '2026-08-02')]);
  assert.strictEqual(r.status.gross_profit, 'needs_cost_structure');
  assert.strictEqual(r.status.ebitda, 'estimated', 'opex alone still supports an EBITDA estimate');
});

t('no asset spend reports needs_asset_structure', () => {
  const r = computeInsights([tx('income', 'wash revenue', 5000, '2026-08-01')]);
  assert.strictEqual(r.status.capex, 'needs_asset_structure');
  assert.strictEqual(r.metrics.capex, 0);
});

t('every estimated metric carries its safety warning', () => {
  const r = computeInsights(BASE);
  assert.ok(r.warnings.some((w) => /cash-basis/i.test(w)));
  assert.ok(r.warnings.some((w) => /Needs full accounting structure/i.test(w)));
  assert.ok(r.warnings.some((w) => /Depreciation and amortisation are not modelled/i.test(w)));
});

t('period window filters on the effective date', () => {
  const r = computeInsights(BASE, { from: '2026-08-05', to: '2026-08-07' });
  assert.strictEqual(r.metrics.revenue, 15000);
  assert.strictEqual(r.metrics.direct_costs, 3000);
  assert.strictEqual(r.metrics.opex, 0, 'the 08-08 rent is outside the window');
  assert.strictEqual(r.period.from, '2026-08-05');
});

console.log(`\n${pass} passed`);
