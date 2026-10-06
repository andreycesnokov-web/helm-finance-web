// Unit Tests: Daily Spend, Net Burn, and Runway Calculations
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { computeBurnAndRunway, isOperatingExpense, isOperatingInflow, extractIdrAmount } = require('../../server/lib/burnRunway');
const FININ = require('../../server/lib/financialInsights');

describe('Daily Spend, Net Burn and Runway (burnRunway.js)', () => {

  it('1. Positive Cash Flow: Daily spend is displayed, Net burn is 0, Runway is null with positive_cash_flow reason', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Operating revenue: 100 000 000 IDR on 2026-09-26 (10 days before)
      { id: 1, type: 'income', category: 'Sales', description: 'Customer software license payment', amount_original: 100000000, amount_idr: 100000000, transaction_date: '2026-09-26' },
      // Operating expenses: 15 000 000 IDR (10M on 2026-10-01, 5M on 2026-09-26)
      { id: 2, type: 'expense', category: 'Office', description: 'Monthly cloud servers', amount_original: 10000000, amount_idr: 10000000, transaction_date: '2026-10-01' },
      { id: 3, type: 'expense', category: 'Supplies', description: 'Office supplies', amount_original: 5000000, amount_idr: 5000000, transaction_date: '2026-09-26' },
    ];

    const totalBalance = 200000000;
    const res = computeBurnAndRunway(txs, totalBalance, fixedAsOf);

    // Window: from 2026-09-26 to 2026-10-06 = 10 calendar days
    // Daily spend: 15 000 000 / 10 = 1 500 000 IDR/day
    assert.strictEqual(res.burn_window_days, 10, 'Window days must be 10');
    assert.strictEqual(res.window_start, '2026-09-26');
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 15000000);
    assert.strictEqual(res.operating_inflows, 100000000);
    assert.strictEqual(res.daily_spend, 1500000, 'Daily spend must be computed from operating expenses');
    assert.strictEqual(res.net_burn_daily, 0, 'Net burn must be 0 because revenue exceeds expenses');
    assert.strictEqual(res.net_burn_monthly, 0, 'Monthly net burn must be 0');
    assert.strictEqual(res.runway_days, null, 'Runway must be null because company is cash flow positive');
    assert.strictEqual(res.runway_reason, 'positive_cash_flow');
  });

  it('2. Negative Cash Flow: Daily spend and Net burn are computed, Runway shows days to depletion', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Operating revenue: 10 000 000 IDR
      { id: 1, type: 'income', category: 'Sales', description: 'Client fee project payment', amount_original: 10000000, amount_idr: 10000000, transaction_date: '2026-09-06' },
      // Operating expenses: 40 000 000 IDR over 30 days
      { id: 2, type: 'expense', category: 'Salaries', description: 'Payroll engineering', amount_original: 40000000, amount_idr: 40000000, transaction_date: '2026-09-06' },
    ];

    const totalBalance = 60000000; // 60M IDR cash in bank
    const res = computeBurnAndRunway(txs, totalBalance, fixedAsOf);

    // Over 30 days:
    // Daily spend: 40M / 30 = 1 333 333 IDR/day
    assert.strictEqual(res.burn_window_days, 30);
    assert.strictEqual(res.daily_spend, Math.round(40000000 / 30));
    // Net cash drain: 40M - 10M = 30M IDR
    // Net burn daily: 30M / 30 = 1 000 000 IDR/day
    assert.strictEqual(res.net_burn_daily, 1000000);
    assert.strictEqual(res.net_burn_monthly, 30000000);
    // Runway: 60M / 1M = 60 days
    assert.strictEqual(res.runway_days, 60);
    assert.strictEqual(res.runway_reason, 'depleting');
  });

  it('3. Break-Even Cash Flow: Inflows equal expenses -> net burn is 0 and runway is null', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      { id: 1, type: 'income', category: 'Sales', description: 'Client fee payment', amount_original: 20000000, amount_idr: 20000000, transaction_date: '2026-10-02' },
      { id: 2, type: 'expense', category: 'Rent', description: 'Office lease rent', amount_original: 20000000, amount_idr: 20000000, transaction_date: '2026-10-02' },
    ];

    const res = computeBurnAndRunway(txs, 50000000, fixedAsOf);
    assert.strictEqual(res.net_burn_daily, 0);
    assert.strictEqual(res.runway_days, null);
    assert.strictEqual(res.runway_reason, 'break_even');
  });

  it('4. Empty Data: Returns null for daily spend and runway, with insufficient_data reason', () => {
    const res = computeBurnAndRunway([], 50000000, '2026-10-06');

    assert.strictEqual(res.daily_spend, null, 'Must be null, NOT an artificial zero');
    assert.strictEqual(res.runway_days, null, 'Runway must be null');
    assert.strictEqual(res.runway_reason, 'insufficient_data');
    assert.strictEqual(res.net_burn_daily, 0);
  });

  it('5. Future Transactions Exclusion: Transactions after asOfDate belong to forecast and are strictly excluded', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Past expense: 10 000 000 IDR on 2026-10-02
      { id: 1, type: 'expense', description: 'Office rent', amount_original: 10000000, amount_idr: 10000000, transaction_date: '2026-10-02' },
      // Future expense: 50 000 000 IDR on 2026-10-15 (future forecast obligation)
      { id: 2, type: 'expense', description: 'Future equipment supplier invoice', amount_original: 50000000, amount_idr: 50000000, transaction_date: '2026-10-15' },
      // Future revenue: 100 000 000 IDR on 2026-10-20
      { id: 3, type: 'income', category: 'Sales', description: 'Future contract payment', amount_original: 100000000, amount_idr: 100000000, transaction_date: '2026-10-20' },
    ];

    const res = computeBurnAndRunway(txs, 40000000, fixedAsOf);

    // Only past expense from 2026-10-02 to 2026-10-06 (4 days) must be counted
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 10000000, 'Future 50M expense must not be included');
    assert.strictEqual(res.operating_inflows, 0, 'Future 100M revenue must not be included');
    assert.strictEqual(res.burn_window_days, 4);
    assert.strictEqual(res.daily_spend, 2500000, '10M / 4 days = 2.5M IDR/day');
  });

  it('6. Currency Safety: Foreign currency with missing IDR conversion is flagged and not added as raw IDR', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // IDR expense: 5 000 000 IDR
      { id: 1, type: 'expense', description: 'Local server maintenance', amount_original: 5000000, amount_idr: 5000000, currency_original: 'IDR', transaction_date: '2026-10-05' },
      // USD expense: $500 with NO amount_idr conversion
      { id: 2, type: 'expense', description: 'US SaaS license', amount_original: 500, amount_idr: null, currency_original: 'USD', transaction_date: '2026-10-05' },
    ];

    const res = computeBurnAndRunway(txs, 20000000, fixedAsOf);

    // The $500 USD must NOT be added as 500 IDR!
    assert.strictEqual(res.operating_expenses, 5000000, 'Must only include converted amounts');
    assert.strictEqual(res.has_unvalued_tx, true, 'Must flag unvalued transactions');
    assert.strictEqual(res.unvalued_tx_count, 1);
  });

  it('7. Internal Transfer & Financing Neutrality: Does not inflate operating spend, net burn or runway', () => {
    const fixedAsOf = '2026-10-06';
    const baseTxs = [
      { id: 10, type: 'expense', category: 'Software', description: 'SaaS subscription', amount_original: 3000000, amount_idr: 3000000, transaction_date: '2026-10-04' },
    ];

    const baseRes = computeBurnAndRunway(baseTxs, 50000000, fixedAsOf);

    // Add internal transfers and financing
    const txsWithNonOperating = [
      ...baseTxs,
      // Internal wallet transfer legs
      { id: 20, type: 'expense', category: 'Transfer', transfer_id: 'xfer-1', description: 'Transfer: BCA -> Mandiri', amount_original: 50000000, amount_idr: 50000000, transaction_date: '2026-10-04' },
      { id: 21, type: 'income', category: 'Transfer', transfer_id: 'xfer-1', description: 'Transfer: BCA -> Mandiri', amount_original: 50000000, amount_idr: 50000000, transaction_date: '2026-10-04' },
      // Capital injection
      { id: 22, type: 'income', category: 'Financing', description: 'Capital contribution by founder', amount_original: 100000000, amount_idr: 100000000, transaction_date: '2026-10-04' },
      // Opening balance
      { id: 23, type: 'income', category: 'Opening balance', description: 'Opening balance · BCA', amount_original: 20000000, amount_idr: 20000000, transaction_date: '2026-10-04' },
      // USD liquidity reserve
      { id: 24, type: 'income', description: 'USD liquidity reserve', amount_original: 800, amount_idr: 14333600, transaction_date: '2026-10-04' },
    ];

    const testRes = computeBurnAndRunway(txsWithNonOperating, 50000000, fixedAsOf);

    assert.strictEqual(testRes.daily_spend, baseRes.daily_spend, 'Internal transfers and funding must not change daily spend');
    assert.strictEqual(testRes.net_burn_daily, baseRes.net_burn_daily, 'Transfers and funding must not change net burn');
    assert.strictEqual(testRes.runway_days, baseRes.runway_days, 'Runway must remain identical');
  });

  it('8. Classification Counterexamples: Distinguishes vendor invoice expenses, customer payments and ambiguous reserves', () => {
    // 1. Supplier invoice expense -> operating_expense, NOT revenue, NOT financing
    const tSupplier = { type: 'expense', description: 'Vendor invoice #402 for Cloud Hosting Services', transaction_date: '2026-10-01' };
    assert.strictEqual(isOperatingExpense(tSupplier), true, 'Supplier invoice expense is an operating expense');
    assert.strictEqual(isOperatingInflow(tSupplier), false, 'Supplier invoice expense is not an inflow');
    const cSupplier = FININ.classifyTransaction(tSupplier);
    assert.strictEqual(cSupplier.class, 'operating_expense');

    // 2. Client payment -> revenue (operating inflow)
    const tClient = { type: 'income', description: 'Client payment invoice 101', transaction_date: '2026-10-01' };
    assert.strictEqual(isOperatingInflow(tClient), true, 'Client payment invoice is an operating inflow');
    assert.strictEqual(isOperatingExpense(tClient), false, 'Client payment is not an expense');
    const cClient = FININ.classifyTransaction(tClient);
    assert.strictEqual(cClient.class, 'revenue');

    // 3. Ambiguous reserve -> unknown (needs review, NOT operating revenue)
    const tAmbiguous = { type: 'income', description: 'General reserve allocation', transaction_date: '2026-10-01' };
    assert.strictEqual(isOperatingInflow(tAmbiguous), false, 'Ambiguous reserve is not an operating inflow');
    const cAmbiguous = FININ.classifyTransaction(tAmbiguous);
    assert.strictEqual(cAmbiguous.class, 'unknown');
    assert.strictEqual(cAmbiguous.needs_review, true);

    // 4. Hotel reservation expense -> operating expense (outflow), NOT financing
    const tHotel = { type: 'expense', description: 'Hotel room reservation for business trip', transaction_date: '2026-10-01' };
    assert.strictEqual(isOperatingExpense(tHotel), true, 'Hotel room reservation expense is operating');
    const cHotel = FININ.classifyTransaction(tHotel);
    assert.notStrictEqual(cHotel.class, 'financing', 'Hotel reservation must not match financing');

    // 5. USD liquidity reserve -> financing (non-operating)
    const tLiq = { type: 'income', description: 'USD liquidity reserve', transaction_date: '2026-10-01' };
    assert.strictEqual(isOperatingInflow(tLiq), false, 'Liquidity reserve is not operating revenue');
    const cLiq = FININ.classifyTransaction(tLiq);
    assert.strictEqual(cLiq.class, 'financing');
  });
});
