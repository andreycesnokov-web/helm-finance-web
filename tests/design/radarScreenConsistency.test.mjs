// Radar Screen Consistency Tests
//
// Verifies Point 3 of user review:
// Proves consistency across the Radar screen:
// - SummaryCard figures (radarFigures: proj30, projBest, projWorst, totalIn, totalOut)
// - Chart time-series (radarSeries: forecast: days[30].expected, days[30].best, days[30].worst)
// - Key dates list (obligations, amounts, and currency valuations)
//
// Run: node tests/design/radarScreenConsistency.test.mjs
import assert from 'node:assert';
import { radarFigures } from '../../client/src/lib/radarFigures.js';
import { cashItems, forecast, keyDates } from '../../client/src/v2/lib/radarSeries.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

console.log('\nradar — screen consistency: summary card, chart series, and key dates');

t('summary card proj30, projBest, projWorst equal day 30 chart forecast on multi-currency dataset', () => {
  const today = '2026-10-05';
  const pulseData = {
    totalBalance: 150000000,
    burnRate: 1500000,
    as_of_date: today,
    rates: {
      USD: { rate: 16300, source: 'fixed_accounting_table', calculated_at: today, rate_effective_date: null, is_fixed_accounting: true },
      EUR: { rate: 17800, source: 'fixed_accounting_table', calculated_at: today, rate_effective_date: null, is_fixed_accounting: true },
    },
    debts: [
      // 1. Open IDR receivable inside horizon
      { id: '1', type: 'receivable', counterparty: 'PT Surya', amount: 25000000, due_date: '2026-10-15', status: 'open' },
      // 2. Open USD receivable inside horizon (converted via server rate: 1000 USD * 16300 = 16.3M)
      { id: '2', type: 'receivable', counterparty: 'Global Corp', amount: 1000, currency: 'USD', due_date: '2026-10-20', status: 'open' },
      // 3. Open IDR payable inside horizon
      { id: '3', type: 'payable', counterparty: 'PLN', amount: 8000000, due_date: '2026-10-10', status: 'open' },
      // 4. Partially paid payable (original 20M, paid 15M, remaining 5M)
      { id: '4', type: 'payable', counterparty: 'Vendor Tech', original_amount: 20000000, paid_amount: 15000000, remaining_amount: 5000000, due_date: '2026-10-18', status: 'partial' },
      // 5. Overdue payable (due 2026-10-01, should land on day 0)
      { id: '5', type: 'payable', counterparty: 'Office Lease', amount: 12000000, due_date: '2026-10-01', status: 'overdue' },
      // 6. Paid debt (must be excluded from BOTH card and chart)
      { id: '6', type: 'payable', counterparty: 'Old Bill', amount: 30000000, status: 'paid', remaining_amount: 0 },
      // 7. Settled debt (must be excluded from BOTH card and chart)
      { id: '7', type: 'payable', counterparty: 'Old Settle', amount: 15000000, is_settled: true },
      // 8. Rejected debt (must be excluded from BOTH card and chart)
      { id: '8', type: 'payable', counterparty: 'Draft X', amount: 9000000, approval_status: 'rejected' },
      // 9. Debt due in 45 days (> 30 days horizon, must be excluded from BOTH)
      { id: '9', type: 'payable', counterparty: 'Future Tax', amount: 40000000, due_date: '2026-11-20' },
      // 10. Undated IDR receivable (must be excluded from BOTH 30d card and chart forecast)
      { id: '10', type: 'receivable', counterparty: 'Undated Client', amount: 15000000, due_date: null, status: 'open' },
      // 11. Undated USD payable (must be excluded from BOTH 30d card and chart forecast, converted in undated list: 500 * 16300 = 8.15M)
      { id: '11', type: 'payable', counterparty: 'Undated Cloud SaaS', amount: 500, currency: 'USD', due_date: null, status: 'open' },
    ],
  };

  // 1. Compute summary figures via radarFigures
  const cardFigures = radarFigures(pulseData, { today });

  // 2. Compute chart series via cashItems and forecast
  const { items: chartItems, excluded } = cashItems({ debts: pulseData.debts, today, horizon: 30, rates: pulseData.rates });
  const chartForecast = forecast({ balance: pulseData.totalBalance, burnRate: pulseData.burnRate, items: chartItems, horizon: 30, today });
  const day30 = chartForecast.days[30];

  // Inflows: PT Surya (25M) + Global Corp (16.3M) = 41.3M (Undated Client 15M is EXCLUDED)
  assert.strictEqual(cardFigures.totalIn, 41300000);
  assert.strictEqual(cardFigures.totalIn, chartItems.filter(i => i.dir === 'in').reduce((s, i) => s + i.amount, 0));

  // Outflows: PLN (8M) + Vendor Tech (5M remaining) + Office Lease (12M overdue) = 25M (Undated Cloud SaaS 8.15M is EXCLUDED)
  assert.strictEqual(cardFigures.totalOut, 25000000);
  assert.strictEqual(cardFigures.totalOut, chartItems.filter(i => i.dir === 'out').reduce((s, i) => s + i.amount, 0));

  // Undated exclusions: both card and chart exclude the 2 undated items
  assert.strictEqual(excluded.undated, 2);
  assert.strictEqual(cardFigures.undatedDebts.length, 2);
  assert.strictEqual(cardFigures.assumptions.undatedCount, 2);
  assert.strictEqual(cardFigures.assumptions.undatedReceivablesTotalIdr, 15000000);
  assert.strictEqual(cardFigures.assumptions.undatedPayablesTotalIdr, 8150000);
  assert.strictEqual(cardFigures.assumptions.undatedTotalIdr, 23150000);

  // Exclusions:
  // Paid (id 6), Settled (id 7), Rejected (id 8), Future >30d (id 9)
  assert.strictEqual(excluded.foreign, 0); // USD was properly converted via server rate
  assert.strictEqual(cardFigures.assumptions.futureExcludedCount, 1);
  assert.strictEqual(cardFigures.assumptions.excludedPaidOrCancelledCount, 3);

  // Exact scenario alignment at day 30:
  // Expected: balance (150M) + totalIn (41.3M) - totalOut (25M) - burnRate * 30 (45M) = 121.3M
  assert.strictEqual(cardFigures.proj30, 121300000);
  assert.strictEqual(day30.expected, cardFigures.proj30);

  // Best: balance (150M) + totalIn (41.3M) - totalOut * 0.5 (12.5M) = 178.8M
  assert.strictEqual(cardFigures.projBest, 178800000);
  assert.strictEqual(day30.best, cardFigures.projBest);

  // Worst: balance (150M) - totalOut (25M) - burnRate * 30 (45M) = 80M
  assert.strictEqual(cardFigures.projWorst, 80000000);
  assert.strictEqual(day30.worst, cardFigures.projWorst);
});

t('key dates items and amounts correspond exactly to counted chart obligations', () => {
  const today = '2026-10-05';
  const pulseData = {
    totalBalance: 100000000,
    burnRate: 1000000,
    as_of_date: today,
    rates: { USD: { rate: 16300, source: 'server_snapshot', date: today } },
    debts: [
      { id: '1', type: 'receivable', counterparty: 'Client A', amount: 10000000, due_date: '2026-10-15', status: 'open' },
      { id: '2', type: 'payable', counterparty: 'Vendor B', amount: 500, currency: 'USD', due_date: '2026-10-20', status: 'open' },
    ],
  };

  const f = radarFigures(pulseData, { today });
  const { items } = cashItems({ debts: pulseData.debts, today, horizon: 30, rates: pulseData.rates });
  const kd = keyDates(items);

  // Both have exactly 2 items
  assert.strictEqual(f.receivables.length + f.payables.length, 2);
  assert.strictEqual(kd.shown.length, 2);

  // USD vendor: 500 * 16300 = 8,150,000 IDR
  const fVendor = f.payables.find(p => p.id === '2');
  const kdVendor = kd.shown.find(k => k.id === '2');
  assert.strictEqual(fVendor.amount, 8150000);
  assert.strictEqual(kdVendor.amount, 8150000);
});

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nALL PASS — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
