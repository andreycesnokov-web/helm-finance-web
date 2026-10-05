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
  as_of_date: '2026-10-05',
  debts: [
    { id: 'r1', type: 'receivable', counterparty: 'PT Sinar Abadi', amount: 48200000, due_date: '2026-10-14' },
    { id: 'r2', type: 'receivable', counterparty: 'Bali Retail Group', amount: 17650000, due_date: '2026-10-28' },
    { id: 'p1', type: 'payable', counterparty: 'Kantor Pajak', amount: 21400000, due_date: '2026-10-09' },
    { id: 'p2', type: 'payable', counterparty: 'Supplier Nusantara', amount: 9800000, due_date: '2026-10-02' },
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
      { id: '1', type: 'payable', amount: 10000000, status: 'paid', due_date: '2026-10-15' },
      { id: '2', type: 'payable', amount: 5000000, status: 'cancelled', due_date: '2026-10-15' },
      { id: '3', type: 'payable', amount: 7000000, is_settled: true, due_date: '2026-10-15' },
      { id: '4', type: 'payable', amount: 8000000, approval_status: 'rejected', due_date: '2026-10-15' },
      { id: '5', type: 'payable', amount: 12000000, status: 'open', due_date: '2026-10-15' },
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
      { id: '1', type: 'payable', original_amount: 50000000, paid_amount: 50000000, remaining_amount: 0, due_date: '2026-10-15' },
      // Partial payment with explicit remaining_amount
      { id: '2', type: 'payable', original_amount: 30000000, paid_amount: 10000000, remaining_amount: 20000000, due_date: '2026-10-15' },
      // Partial payment calculated from original_amount - paid_amount
      { id: '3', type: 'receivable', original_amount: 40000000, paid_amount: 15000000, due_date: '2026-10-15' },
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
      { id: '1', type: 'receivable', amount: 1000, currency: 'USD', due_date: '2026-10-15' },
      { id: '2', type: 'payable', amount: 500, currency: 'EUR', due_date: '2026-10-15' },
      { id: '3', type: 'payable', amount: 2000000, currency: 'IDR', due_date: '2026-10-15' },
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
      { id: '1', type: 'receivable', amount: 1000, currency: 'UNKNOWN_CURRENCY', due_date: '2026-10-15' },
      { id: '2', type: 'payable', amount: 500, currency: null, due_date: '2026-10-15' },
      { id: '3', type: 'payable', amount: 5000000, currency: 'IDR', due_date: '2026-10-15' },
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

t('assumptions track overdue and undated obligations explicitly under unified contract', () => {
  const today = '2026-10-01';
  const f = radarFigures({
    totalBalance: 100000000,
    burnRate: 0,
    debts: [
      { id: '1', type: 'payable', amount: 5000000, due_date: '2026-09-20' }, // Overdue -> included
      { id: '2', type: 'receivable', amount: 8000000, due_date: null },        // Undated -> EXCLUDED from 30d forecast
      { id: '3', type: 'payable', amount: 12000000, due_date: '2026-10-10' }, // Normal -> included
    ],
  }, { today });

  // Undated item excluded from forecast inflows
  assert.strictEqual(f.totalIn, 0);
  assert.strictEqual(f.totalOut, 17000000);
  assert.strictEqual(f.assumptions.overdueCount, 1);
  assert.strictEqual(f.assumptions.undatedCount, 1);
  assert.strictEqual(f.payables.find(p => p.id === '1').is_overdue, true);
  assert.strictEqual(f.undatedDebts.find(r => r.id === '2').is_undated, true);
});

t('undated obligations are strictly excluded from 30-day forecast in both directions (in/out), including foreign currency', () => {
  const today = '2026-10-05';
  const data = {
    totalBalance: 100000000,
    burnRate: 1000000,
    as_of_date: today,
    rates: {
      USD: { rate: 16300, source: 'fixed_accounting_table', calculated_at: today, rate_effective_date: null, is_fixed_accounting: true },
      EUR: { rate: 17800, source: 'fixed_accounting_table', calculated_at: today, rate_effective_date: null, is_fixed_accounting: true },
    },
    debts: [
      // Dated items (should be counted in 30d forecast)
      { id: 'd_r1', type: 'receivable', amount: 10000000, currency: 'IDR', due_date: '2026-10-15' },
      { id: 'd_p1', type: 'payable', amount: 5000000, currency: 'IDR', due_date: '2026-10-20' },

      // Undated IDR items
      { id: 'u_r1', type: 'receivable', amount: 20000000, currency: 'IDR', due_date: null },
      { id: 'u_p1', type: 'payable', amount: 8000000, currency: 'IDR', due_date: undefined },

      // Undated Foreign currency items (USD and EUR)
      // 1000 USD * 16300 = 16,300,000 IDR
      { id: 'u_r2_usd', type: 'receivable', amount: 1000, currency: 'USD', due_date: null },
      // 500 EUR * 17800 = 8,900,000 IDR
      { id: 'u_p2_eur', type: 'payable', amount: 500, currency: 'EUR', due_date: '' },
    ],
  };

  const f = radarFigures(data, { today });

  // 1. Forecast includes ONLY dated items:
  assert.strictEqual(f.totalIn, 10000000);
  assert.strictEqual(f.receivables.length, 1);
  assert.strictEqual(f.receivables[0].id, 'd_r1');

  assert.strictEqual(f.totalOut, 5000000);
  assert.strictEqual(f.payables.length, 1);
  assert.strictEqual(f.payables[0].id, 'd_p1');

  // proj30 = 100M + 10M - 5M - 30M = 75M
  assert.strictEqual(f.proj30, 75000000);
  assert.strictEqual(f.projBest, 100000000 + 10000000 - 2500000);
  assert.strictEqual(f.projWorst, 100000000 - 5000000 - 30000000);

  // 2. Undated obligations are strictly excluded and collected in dedicated structures:
  assert.strictEqual(f.undatedDebts.length, 4);
  assert.strictEqual(f.assumptions.undatedCount, 4);
  assert.strictEqual(f.assumptions.undatedReceivablesCount, 2);
  assert.strictEqual(f.assumptions.undatedPayablesCount, 2);

  // Undated receivables: 20M IDR + 16.3M IDR (USD) = 36.3M IDR
  assert.strictEqual(f.assumptions.undatedReceivablesTotalIdr, 36300000);
  // Undated payables: 8M IDR + 8.9M IDR (EUR) = 16.9M IDR
  assert.strictEqual(f.assumptions.undatedPayablesTotalIdr, 16900000);
  assert.strictEqual(f.assumptions.undatedTotalIdr, 53200000);

  // All undated items carry converted amount_idr and metadata
  const usdItem = f.undatedDebts.find(d => d.id === 'u_r2_usd');
  assert.strictEqual(usdItem.amount_idr, 16300000);
  assert.strictEqual(usdItem.rate_used, 16300);
  assert.strictEqual(usdItem.rate_source, 'fixed_accounting_table');
  assert.strictEqual(usdItem.rate_effective_date, null);
  assert.strictEqual(usdItem.is_fixed_accounting, true);

  const eurItem = f.undatedDebts.find(d => d.id === 'u_p2_eur');
  assert.strictEqual(eurItem.amount_idr, 8900000);
  assert.strictEqual(eurItem.rate_used, 17800);
  assert.strictEqual(eurItem.rate_source, 'fixed_accounting_table');
  assert.strictEqual(eurItem.rate_effective_date, null);
  assert.strictEqual(eurItem.is_fixed_accounting, true);
});

t('burnRate source and double-counting boundary: recurring expenses present in both history and payables', () => {
  // Scenario:
  // Last month the company paid rent of Rp 10,000,000. It is in allTxs, so rolling daily burnRate is 10M / 30 = 333,333.
  // Next month the company also has scheduled rent of Rp 10,000,000 entered in debts (payables).
  const burnRate = 10000000 / 30;
  const f = radarFigures({
    totalBalance: 50000000,
    burnRate,
    debts: [
      { id: 'rent_future', type: 'payable', amount: 10000000, due_date: '2026-10-15' },
    ],
  });

  // Discrete scheduled payables: 10M
  assert.strictEqual(f.totalOut, 10000000);
  // Rolling monthly burn from past 30 days: 10M
  assert.strictEqual(f.monthlyBurn, 10000000);
  // Both are subtracted in the forecast: 50M - 10M (payables) - 10M (monthlyBurn) = 30M
  assert.strictEqual(f.proj30, 30000000);
  // Verified boundary: Without transactional categorization or tagging on burnRate,
  // the client cannot automatically deduct past recurring rent from rolling burnRate.
  // The system explicitly records burnRateNote in assumptions and does NOT claim "No Double-Counting".
  assert.ok(f.assumptions.burnRateNote.includes('Recurring expenses'));
});

t('no static client fallback FX rates: missing server rate flags incomplete forecast', () => {
  // Without server rates in data.rates or data.accounts, foreign currency is NOT converted via static client table
  const fWithoutServerRates = radarFigures({
    totalBalance: 50000000,
    burnRate: 0,
    debts: [
      { id: '1', type: 'payable', amount: 1000, currency: 'USD', due_date: '2026-10-15' },
    ],
  });
  assert.strictEqual(fWithoutServerRates.hasIncompleteForecast, true);
  assert.strictEqual(fWithoutServerRates.totalOut, 0, 'USD debt without server rate must NOT be summed');
  assert.strictEqual(fWithoutServerRates.unconvertedDebts[0].reason, 'unknown_rate');

  // WITH server rates (including honest source and date metadata)
  const fWithServerRates = radarFigures({
    totalBalance: 50000000,
    burnRate: 0,
    as_of_date: '2026-10-05',
    rates: {
      USD: { rate: 16300, source: 'fixed_accounting_table', calculated_at: '2026-10-05', rate_effective_date: null, is_fixed_accounting: true },
    },
    debts: [
      { id: '1', type: 'payable', amount: 1000, currency: 'USD', due_date: '2026-10-15' },
    ],
  });
  assert.strictEqual(fWithServerRates.hasIncompleteForecast, false);
  assert.strictEqual(fWithServerRates.totalOut, 16300000);
  assert.strictEqual(fWithServerRates.payables[0].rate_source, 'fixed_accounting_table');
  assert.strictEqual(fWithServerRates.payables[0].rate_effective_date, null);
  assert.strictEqual(fWithServerRates.payables[0].is_fixed_accounting, true);
});

t('overdue receivables are NOT treated as guaranteed: dropped in worst case', () => {
  const today = '2026-10-05';
  const f = radarFigures({
    totalBalance: 100000000,
    burnRate: 1000000,
    debts: [
      { id: 'p_overdue', type: 'payable', amount: 5000000, due_date: '2026-10-01' },
      { id: 'r_overdue', type: 'receivable', amount: 8000000, due_date: '2026-10-01' },
    ],
  }, { today });

  // Separate tracking in assumptions
  assert.strictEqual(f.assumptions.overduePayablesCount, 1);
  assert.strictEqual(f.assumptions.overdueReceivablesCount, 1);

  // In expected scenario (proj30): receivables are included under collection assumption
  // balance (100M) + totalIn (8M) - totalOut (5M) - burnRate * 30 (30M) = 73M
  assert.strictEqual(f.proj30, 73000000);

  // In worst-case scenario (projWorst): overdue receivables are DROPPED (risk of default/non-payment)
  // balance (100M) - totalOut (5M) - burnRate * 30 (30M) = 65M
  assert.strictEqual(f.projWorst, 65000000);
  assert.strictEqual(f.projWorst, f.balance - f.totalOut - f.monthlyBurn);
});

t('programmatic before -> after execution on exact same fixture', () => {
  // Legacy / Old implementation before fix
  function oldRadarFigures(d) {
    const balance = Number(d?.totalBalance || 0);
    const burnRate = Number(d?.burnRate || 0);
    const monthlyBurn = Math.round(burnRate * 30);
    const receivables = (d?.debts || []).filter(x => x?.type === 'receivable');
    const payables = (d?.debts || []).filter(x => x?.type === 'payable');
    const totalIn = receivables.reduce((s, x) => s + Number(x?.amount || 0), 0);
    const totalOut = payables.reduce((s, x) => s + Number(x?.amount || 0), 0);
    const proj30 = balance + totalIn - totalOut - burnRate * 30;
    return { balance, burnRate, monthlyBurn, totalIn, totalOut, proj30 };
  }

  const fixture = {
    totalBalance: 100000000,
    burnRate: 1000000,
    rates: {
      USD: { rate: 16300, source: 'server_snapshot', date: '2026-10-05' },
    },
    debts: [
      { id: 'D1', type: 'payable', amount: 10000000, status: 'paid', remaining_amount: 0 },
      { id: 'D2', type: 'payable', amount: 1000, currency: 'USD', due_date: '2026-10-15' },
      { id: 'D3', type: 'payable', amount: 20000000, currency: 'IDR', due_date: '2026-11-20' },
      { id: 'D4', type: 'receivable', amount: 2000, currency: 'USD', due_date: '2026-10-10' },
      { id: 'D5', type: 'payable', amount: 5000000, currency: 'IDR', due_date: '2026-10-01' },
      { id: 'D6', type: 'receivable', amount: 500, currency: 'XYZ', due_date: '2026-10-12' },
    ],
  };

  const oldRes = oldRadarFigures(fixture);
  const newRes = radarFigures(fixture, { today: '2026-10-05' });

  // OLD calculation verification:
  // totalIn: D4 (2000) + D6 (500) = 2500
  assert.strictEqual(oldRes.totalIn, 2500);
  // totalOut: D1 (10M) + D2 (1000) + D3 (20M) + D5 (5M) = 35001000 (D5 was included!)
  assert.strictEqual(oldRes.totalOut, 35001000);
  // proj30: 100M + 2500 - 35001000 - 30M = 35001500
  assert.strictEqual(oldRes.proj30, 35001500);

  // NEW calculation verification:
  // D1 excluded (paid)
  // D2 converted: 1000 USD * 16300 = 16.3M
  // D3 excluded from 30d horizon (due in 46 days)
  // D4 converted: 2000 USD * 16300 = 32.6M
  // D5 included: 5M (overdue payable)
  // D6 excluded (XYZ rate missing) -> hasIncompleteForecast: true
  assert.strictEqual(newRes.totalIn, 32600000);
  assert.strictEqual(newRes.totalOut, 21300000);
  assert.strictEqual(newRes.proj30, 81300000);
  assert.strictEqual(newRes.hasIncompleteForecast, true);
});

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nALL PASS — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);

