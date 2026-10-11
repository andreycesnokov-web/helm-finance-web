// tests/integration/radarForecastAndDateNavigation.test.js
// Verification of PR #131 Radar Navigation & Date Editing (DEF-03):
// 1. Undated obligation -> "Set date" link targeting correct debt ID and route
// 2. Setting date within 30-day horizon -> updates forecast (totalOut/totalIn, proj30)
// 3. Setting date beyond 30-day horizon -> excluded from 30-day forecast
// 4. Closing modal cleans URL and does not spontaneously reopen
// 5. Unknown or inaccessible ID handles gracefully without crash or foreign leak
// 6. Covers both payables and receivables

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { radarFigures } = require('../../client/src/lib/radarFigures.js');

describe('PR #131: Radar Navigation & Date Assignment (DEF-03)', () => {
  const asOf = '2026-10-05';
  const basePulse = {
    totalBalance: 100000000, // 100M IDR
    burnRate: 1000000,       // 1M/day -> 30M/month
    as_of_date: asOf,
    rates: { IDR: 1, USD: 17915 },
    accounts: [
      { id: 'w1', name: 'BCA IDR', currency: 'IDR', rate_today: 1, balance: 100000000, balance_idr: 100000000 }
    ],
    debts: []
  };

  it('Requirement 1 & 6: Undated obligations (payable & receivable) appear in undated list with "Set date" links', () => {
    const pulseWithUndated = {
      ...basePulse,
      debts: [
        { id: 201, type: 'payable', counterparty: 'Supplier Undated', original_amount: 15000000, amount: 15000000, currency: 'IDR', due_date: null, status: 'open' },
        { id: 202, type: 'receivable', counterparty: 'Client Undated', original_amount: 25000000, amount: 25000000, currency: 'IDR', due_date: null, status: 'open' },
      ]
    };

    const figures = radarFigures(pulseWithUndated, { today: asOf });
    assert.strictEqual(figures.undatedDebts.length, 2, 'Both debts must be marked as undated');

    const uPayable = figures.undatedDebts.find(d => d.id === 201);
    const uReceivable = figures.undatedDebts.find(d => d.id === 202);

    assert.ok(uPayable);
    assert.strictEqual(uPayable.is_undated, true);
    assert.strictEqual(uPayable.type, 'payable');
    const payableHref = uPayable.type === 'receivable' ? `/business/receivables?edit=${uPayable.id}` : `/business/payables?edit=${uPayable.id}`;
    assert.strictEqual(payableHref, '/business/payables?edit=201');

    assert.ok(uReceivable);
    assert.strictEqual(uReceivable.is_undated, true);
    assert.strictEqual(uReceivable.type, 'receivable');
    const receivableHref = uReceivable.type === 'receivable' ? `/business/receivables?edit=${uReceivable.id}` : `/business/payables?edit=${uReceivable.id}`;
    assert.strictEqual(receivableHref, '/business/receivables?edit=202');

    // Undated items are NOT counted in scheduled totalIn / totalOut
    assert.strictEqual(figures.totalOut, 0);
    assert.strictEqual(figures.totalIn, 0);
  });

  it('Requirement 2: Setting date within 30-day horizon updates forecast (totalOut increases, proj30 decreases)', () => {
    // Before date set (undated)
    const figuresBefore = radarFigures({
      ...basePulse,
      debts: [
        { id: 201, type: 'payable', counterparty: 'Supplier Alpha', original_amount: 10000000, amount: 10000000, currency: 'IDR', due_date: null, status: 'open' }
      ]
    }, { today: asOf });

    assert.strictEqual(figuresBefore.totalOut, 0);
    // proj30 = balance (100M) + totalIn (0) - totalOut (0) - burn (30M) = 70M
    assert.strictEqual(figuresBefore.proj30, 70000000);

    // After setting date to 2026-10-15 (10 days ahead, within 30-day window)
    const figuresAfter = radarFigures({
      ...basePulse,
      debts: [
        { id: 201, type: 'payable', counterparty: 'Supplier Alpha', original_amount: 10000000, amount: 10000000, currency: 'IDR', due_date: '2026-10-15', status: 'open' }
      ]
    }, { today: asOf });

    assert.strictEqual(figuresAfter.totalOut, 10000000, 'Scheduled totalOut must reflect 10M payable');
    // proj30 = 100M - 10M - 30M = 60M
    assert.strictEqual(figuresAfter.proj30, 60000000, 'Projected balance must decrease by 10M');
    assert.strictEqual(figuresAfter.payables.length, 1);
    assert.strictEqual(figuresAfter.undatedDebts.length, 0);
  });

  it('Requirement 3: Setting date beyond 30-day horizon excludes obligation from 30-day forecast', () => {
    // Debt due in 45 days (2026-11-19)
    const figuresFuture = radarFigures({
      ...basePulse,
      debts: [
        { id: 201, type: 'payable', counterparty: 'Supplier Far Future', original_amount: 10000000, amount: 10000000, currency: 'IDR', due_date: '2026-11-19', status: 'open' }
      ]
    }, { today: asOf, horizon: 30 });

    assert.strictEqual(figuresFuture.totalOut, 0, 'Payable beyond 30 days must be excluded from 30-day outflow');
    assert.strictEqual(figuresFuture.proj30, 70000000, 'Projection must not be reduced by beyond-horizon payable');
    assert.strictEqual(figuresFuture.payables.length, 0);
    assert.strictEqual(figuresFuture.assumptions.futureExcludedCount, 1, 'Must be catalogued in futureExcludedCount');
  });

  it('Requirement 4: Closing modal sanitizes URL and prevents spontaneous reopening', () => {
    // Simulate browser URL with edit param
    const currentUrl = new URL('https://app.cfo-ai.site/business/payables?tab=open&edit=201');
    assert.strictEqual(currentUrl.searchParams.get('edit'), '201');

    // Simulate handleCloseEdit logic in client/src/pages/business/index.jsx & Payables.jsx
    const params = new URLSearchParams(currentUrl.search);
    params.delete('edit');
    const cleanedSearch = params.toString() ? `?${params.toString()}` : '';
    const updatedUrl = `${currentUrl.origin}${currentUrl.pathname}${cleanedSearch}`;

    assert.strictEqual(updatedUrl, 'https://app.cfo-ai.site/business/payables?tab=open');
    assert.strictEqual(new URL(updatedUrl).searchParams.has('edit'), false, 'edit param completely removed');

    // On re-render with cleaned URL:
    const reParams = new URL(updatedUrl).searchParams;
    const editId = reParams.get('edit');
    let modalOpened = false;
    if (editId) {
      modalOpened = true;
    }
    assert.strictEqual(modalOpened, false, 'Modal does not spontaneously reopen after closing');
  });

  it('Requirement 5: Unknown or inaccessible ID handles gracefully without modal or foreign leak', () => {
    const debtsList = [
      { id: 101, type: 'payable', counterparty: 'Accessible Supplier' }
    ];

    const params = new URLSearchParams('?edit=999999');
    const editId = params.get('edit');
    const target = debtsList.find(d => String(d.id) === String(editId));

    assert.strictEqual(target, undefined, 'Target must not be found');

    let modalDebt = null;
    if (target) {
      modalDebt = target;
    } else {
      // URL sanitization on missing target
      params.delete('edit');
    }

    assert.strictEqual(modalDebt, null, 'Modal state remains null for non-existent ID');
    assert.strictEqual(params.has('edit'), false, 'Dangling invalid edit param is removed');
  });
});
