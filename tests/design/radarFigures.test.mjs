// Radar's forecast arithmetic, pinned.
//
// The design-system migration rewrote every pixel of Radar and must not have
// moved a single figure. These values were computed from the PREVIOUS
// implementation's expressions before the markup changed, so if the migration
// had altered an operator, a sign or an order of operations, this file fails.
//
// It also pins the three scenarios the product requires — best, expected and
// worst — and the runway/burn pair the header and the KPI row both read.
//
// Pure functions, no browser, no build. Run: node tests/design/radarFigures.test.mjs
import assert from 'node:assert';
import { radarFigures } from '../../client/src/lib/radarFigures.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

// The same shape GET /api/pulse?scope=business returns.
const FIXTURE = {
  totalBalance: 122850000,
  burnRate: 3282833,
  burnWindowDays: 30,
  debts: [
    { id: 'r1', type: 'receivable', counterparty: 'PT Sinar Abadi', amount: 48200000 },
    { id: 'r2', type: 'receivable', counterparty: 'Bali Retail Group', amount: 17650000 },
    { id: 'p1', type: 'payable', counterparty: 'Kantor Pajak', amount: 21400000 },
    { id: 'p2', type: 'payable', counterparty: 'Supplier Nusantara', amount: 9800000 },
  ],
};

console.log('\nradar — the forecast the migration must not have moved');

t('receivables and payables are split and summed as before', () => {
  const f = radarFigures(FIXTURE);
  assert.strictEqual(f.receivables.length, 2);
  assert.strictEqual(f.payables.length, 2);
  assert.strictEqual(f.totalIn, 65850000);
  assert.strictEqual(f.totalOut, 31200000);
});

t('the three scenarios are unchanged', () => {
  const f = radarFigures(FIXTURE);
  // expected: everything planned lands, burn continues 30 days
  assert.strictEqual(f.proj30, 59015010);
  // best: all income received, half the payables actually leave
  assert.strictEqual(f.projBest, 173100000);
  // worst: no receivable arrives, every payable does, burn continues
  assert.strictEqual(f.projWorst, -6834990);
  // The scenarios must stay ordered — a best case below the worst case would
  // mean the formulas had been swapped.
  assert.ok(f.projBest > f.proj30, 'best case is not above expected');
  assert.ok(f.projWorst < f.proj30, 'worst case is not below expected');
});

t('burn and runway are unchanged', () => {
  const f = radarFigures(FIXTURE);
  assert.strictEqual(f.monthlyBurn, 98484990);
  assert.strictEqual(f.runway, 37);
  assert.strictEqual(f.isHealthy, true);
});

t('a negative expected balance flips the health flag, not the arithmetic', () => {
  const f = radarFigures({ ...FIXTURE, totalBalance: 1000000 });
  assert.strictEqual(f.proj30, 1000000 + 65850000 - 31200000 - 3282833 * 30);
  assert.ok(f.proj30 < 0);
  assert.strictEqual(f.isHealthy, false);
});

t('no burn means no runway, never a division by zero', () => {
  const f = radarFigures({ ...FIXTURE, burnRate: 0 });
  assert.strictEqual(f.runway, null, 'runway must be null, not Infinity');
  assert.strictEqual(f.monthlyBurn, 0);
  // With no burn the expected balance is simply balance + in − out.
  assert.strictEqual(f.proj30, 122850000 + 65850000 - 31200000);
});

t('an empty or missing payload produces zeros, not NaN', () => {
  for (const input of [undefined, null, {}, { debts: [] }]) {
    const f = radarFigures(input);
    for (const k of ['balance', 'burnRate', 'totalIn', 'totalOut',
                     'proj30', 'projBest', 'projWorst', 'monthlyBurn']) {
      assert.ok(Number.isFinite(f[k]), `${k} is ${f[k]} for ${JSON.stringify(input)}`);
    }
    assert.strictEqual(f.runway, null);
  }
});

t('a debt of an unknown type is counted in neither direction', () => {
  const f = radarFigures({ ...FIXTURE, debts: [
    ...FIXTURE.debts, { id: 'x', type: 'something_else', amount: 999999999 }] });
  assert.strictEqual(f.totalIn, 65850000, 'an unknown type leaked into income');
  assert.strictEqual(f.totalOut, 31200000, 'an unknown type leaked into payments');
  assert.strictEqual(f.proj30, 59015010, 'an unknown type moved the forecast');
});

t('debts with status paid, cancelled, or is_settled are strictly excluded', () => {
  const f = radarFigures({
    totalBalance: 100000000,
    burnRate: 1000000,
    debts: [
      { id: '1', type: 'payable', amount: 10000000, status: 'paid' },
      { id: '2', type: 'payable', amount: 5000000, status: 'cancelled' },
      { id: '3', type: 'payable', amount: 7000000, is_settled: true },
      { id: '4', type: 'payable', amount: 8000000, approval_status: 'rejected' },
      { id: '5', type: 'payable', amount: 12000000, status: 'open' },
    ],
  });
  assert.strictEqual(f.payables.length, 1);
  assert.strictEqual(f.payables[0].id, '5');
  assert.strictEqual(f.totalOut, 12000000);
  assert.strictEqual(f.assumptions.excludedPaidOrCancelledCount, 4);
});

t('partially paid debts use remaining balance; confirmed zero never falls back to original amount', () => {
  const f = radarFigures({
    totalBalance: 100000000,
    burnRate: 0,
    debts: [
      // Explicit remaining_amount = 0 should be treated as settled/paid, NOT fall back to original_amount
      { id: '1', type: 'payable', original_amount: 50000000, paid_amount: 50000000, remaining_amount: 0 },
      // Partial payment with explicit remaining_amount
      { id: '2', type: 'payable', original_amount: 30000000, paid_amount: 10000000, remaining_amount: 20000000 },
      // Partial payment calculated from original_amount - paid_amount
      { id: '3', type: 'receivable', original_amount: 40000000, paid_amount: 15000000 },
    ],
  });
  assert.strictEqual(f.payables.length, 1);
  assert.strictEqual(f.payables[0].id, '2');
  assert.strictEqual(f.payables[0].amount, 20000000);
  assert.strictEqual(f.totalOut, 20000000);

  assert.strictEqual(f.receivables.length, 1);
  assert.strictEqual(f.receivables[0].id, '3');
  assert.strictEqual(f.receivables[0].amount, 25000000);
  assert.strictEqual(f.totalIn, 25000000);

  assert.strictEqual(f.assumptions.excludedPaidOrCancelledCount, 1);
});

t('foreign currencies are converted to IDR via exchange rates, never summed 1:1', () => {
  const f = radarFigures({
    totalBalance: 50000000,
    burnRate: 0,
    rates: { USD: 16000, EUR: 18000 },
    debts: [
      { id: '1', type: 'receivable', amount: 1000, currency: 'USD' },
      { id: '2', type: 'payable', amount: 500, currency: 'EUR' },
      { id: '3', type: 'payable', amount: 2000000, currency: 'IDR' },
    ],
  });
  // 1000 USD * 16000 = 16,000,000 IDR
  assert.strictEqual(f.totalIn, 16000000);
  assert.strictEqual(f.receivables[0].original_amount, 1000);
  assert.strictEqual(f.receivables[0].original_currency, 'USD');
  assert.strictEqual(f.receivables[0].amount, 16000000);

  // 500 EUR * 18000 = 9,000,000 IDR + 2,000,000 IDR = 11,000,000 IDR
  assert.strictEqual(f.totalOut, 11000000);
  assert.strictEqual(f.hasIncompleteForecast, false);
});

t('missing currency or unknown FX rate flags incomplete forecast and excludes items', () => {
  const f = radarFigures({
    totalBalance: 50000000,
    burnRate: 0,
    debts: [
      { id: '1', type: 'receivable', amount: 1000, currency: 'UNKNOWN_CURRENCY' },
      { id: '2', type: 'payable', amount: 500, currency: null },
      { id: '3', type: 'payable', amount: 5000000, currency: 'IDR' },
    ],
  });
  assert.strictEqual(f.hasIncompleteForecast, true);
  assert.strictEqual(f.unconvertedDebts.length, 2);
  assert.strictEqual(f.unconvertedDebts[0].reason, 'unknown_rate');
  assert.strictEqual(f.unconvertedDebts[1].reason, 'missing_currency');
  // Unknown items must NOT leak into totalIn or totalOut
  assert.strictEqual(f.totalIn, 0);
  assert.strictEqual(f.totalOut, 5000000);
});

t('horizon filtering excludes debts due beyond 30 days', () => {
  const today = '2026-10-01';
  const f = radarFigures({
    totalBalance: 100000000,
    burnRate: 0,
    debts: [
      { id: '1', type: 'payable', amount: 10000000, due_date: '2026-10-15' }, // 14 days -> included
      { id: '2', type: 'payable', amount: 20000000, due_date: '2026-10-31' }, // 30 days -> included
      { id: '3', type: 'payable', amount: 30000000, due_date: '2026-11-15' }, // 45 days -> EXCLUDED
    ],
  }, { today });

  assert.strictEqual(f.payables.length, 2);
  assert.strictEqual(f.totalOut, 30000000);
  assert.strictEqual(f.assumptions.futureExcludedCount, 1);
  assert.strictEqual(f.assumptions.futureExcludedTotalIdr, 30000000);
});

t('assumptions track overdue and undated obligations explicitly', () => {
  const today = '2026-10-01';
  const f = radarFigures({
    totalBalance: 100000000,
    burnRate: 0,
    debts: [
      { id: '1', type: 'payable', amount: 5000000, due_date: '2026-09-20' }, // Overdue
      { id: '2', type: 'receivable', amount: 8000000, due_date: null },        // Undated
      { id: '3', type: 'payable', amount: 12000000, due_date: '2026-10-10' }, // Normal
    ],
  }, { today });

  assert.strictEqual(f.totalIn, 8000000);
  assert.strictEqual(f.totalOut, 17000000);
  assert.strictEqual(f.assumptions.overdueCount, 1);
  assert.strictEqual(f.assumptions.undatedCount, 1);
  assert.strictEqual(f.payables.find(p => p.id === '1').is_overdue, true);
  assert.strictEqual(f.receivables.find(r => r.id === '2').is_undated, true);
});

t('separation of scheduled discrete obligations from rolling operational burn rate', () => {
  const f = radarFigures({
    totalBalance: 200000000,
    burnRate: 2000000, // 2M / day = 60M / month
    debts: [
      { id: '1', type: 'payable', amount: 40000000 },
    ],
  });
  // totalOut is discrete scheduled payments = 40M
  assert.strictEqual(f.totalOut, 40000000);
  // monthlyBurn is operational burn = 60M
  assert.strictEqual(f.monthlyBurn, 60000000);
  // Expected balance proj30 = balance + totalIn - totalOut - burnRate * 30
  // 200M + 0 - 40M - 60M = 100M
  assert.strictEqual(f.proj30, 100000000);
  // Worst case: balance - totalOut - burnRate * 30 = 200M - 40M - 60M = 100M
  assert.strictEqual(f.projWorst, 100000000);
  // Best case: balance + totalIn - totalOut * 0.5 = 200M + 0 - 20M = 180M
  assert.strictEqual(f.projBest, 180000000);
});

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nALL PASS — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);

