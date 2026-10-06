// Unit Tests: Daily Spend, Net Burn, and Runway Calculations
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeBurnAndRunway, isOperatingExpense, isOperatingInflow, extractIdrAmount } = require('../../server/lib/burnRunway');
const FININ = require('../../server/lib/financialInsights');

describe('Daily Spend, Net Burn and Runway (burnRunway.js)', () => {

  it('1. Positive Cash Flow (Fully Valued): Daily spend is displayed, Net burn is 0, Runway is null with positive_cash_flow', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Operating revenue: 100 000 000 IDR on 2026-09-27
      { id: 1, type: 'income', category: 'Sales', description: 'Customer software license payment', amount_original: 100000000, amount_idr: 100000000, transaction_date: '2026-09-27' },
      // Operating expenses: 15 000 000 IDR (10M on 2026-10-01, 5M on 2026-09-27)
      { id: 2, type: 'expense', category: 'Office', description: 'Monthly cloud servers', amount_original: 10000000, amount_idr: 10000000, transaction_date: '2026-10-01' },
      { id: 3, type: 'expense', category: 'Supplies', description: 'Office supplies', amount_original: 5000000, amount_idr: 5000000, transaction_date: '2026-09-27' },
    ];

    const totalBalance = 200000000;
    const res = computeBurnAndRunway(txs, totalBalance, fixedAsOf);

    // Window: from 2026-09-27 to 2026-10-06 inclusive:
    // (Oct 6 - Sept 27) = 9 days diff + 1 = 10 calendar days inclusive
    assert.strictEqual(res.burn_window_days, 10, 'Window days must be 10 calendar days inclusive');
    assert.strictEqual(res.window_start, '2026-09-27');
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 15000000);
    assert.strictEqual(res.operating_inflows, 100000000);
    assert.strictEqual(res.daily_spend, 1500000, 'Daily spend = 15M / 10 days = 1.5M IDR/day');
    assert.strictEqual(res.net_burn_daily, 0, 'Net burn must be 0 because revenue exceeds expenses');
    assert.strictEqual(res.net_burn_monthly, 0, 'Monthly net burn must be 0');
    assert.strictEqual(res.runway_days, null, 'Runway must be null because company is cash flow positive');
    assert.strictEqual(res.runway_reason, 'positive_cash_flow');
    assert.strictEqual(res.has_unvalued_tx, false);
  });

  it('2. Negative Cash Flow: Daily spend and Net burn are computed, Runway shows days to depletion', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Operating revenue: 10 000 000 IDR
      { id: 1, type: 'income', category: 'Sales', description: 'Client fee project payment', amount_original: 10000000, amount_idr: 10000000, transaction_date: '2026-09-07' },
      // Operating expenses: 40 000 000 IDR over 30 days
      { id: 2, type: 'expense', category: 'Salaries', description: 'Payroll engineering', amount_original: 40000000, amount_idr: 40000000, transaction_date: '2026-09-07' },
    ];

    const totalBalance = 60000000; // 60M IDR cash in bank
    const res = computeBurnAndRunway(txs, totalBalance, fixedAsOf);

    // Over 30 days (2026-09-07 to 2026-10-06 inclusive):
    // Daily spend: 40M / 30 = 1 333 333 IDR/day
    assert.strictEqual(res.burn_window_days, 30);
    assert.strictEqual(res.window_start, '2026-09-07');
    assert.strictEqual(res.window_end, '2026-10-06');
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

  it('5. Incomplete FX Valuation blocks confident positive flow and runway: known IDR income + unconverted USD expense', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Known IDR revenue: 40 000 000 IDR
      { id: 1, type: 'income', category: 'Sales', description: 'Client payment', amount_original: 40000000, amount_idr: 40000000, currency_original: 'IDR', transaction_date: '2026-10-02' },
      // USD expense without IDR conversion: $5,000 USD
      { id: 2, type: 'expense', description: 'Overseas software licenses', amount_original: 5000, amount_idr: null, currency_original: 'USD', transaction_date: '2026-10-04' },
    ];

    const res = computeBurnAndRunway(txs, 100000000, fixedAsOf);

    // Missing expense must NOT turn into zero burn or claim positive cash flow!
    assert.strictEqual(res.has_unvalued_tx, true, 'has_unvalued_tx must be true');
    assert.strictEqual(res.unvalued_tx_count, 1, 'unvalued_tx_count must be 1');
    assert.strictEqual(res.is_partial, true, 'is_partial must be true');
    assert.strictEqual(res.runway_days, null, 'Runway must NOT be calculated when foreign transactions are unvalued');
    assert.strictEqual(res.runway_reason, 'incomplete_valuation', 'Must block positive_cash_flow and return incomplete_valuation');
    assert.notStrictEqual(res.runway_reason, 'positive_cash_flow', 'Must NEVER claim positive flow when expenses are missing valuation');
  });

  it('6. Window Boundaries: Exactly 1 day (start == end)', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      { id: 1, type: 'expense', description: 'Daily lunch catering', amount_original: 1200000, amount_idr: 1200000, transaction_date: '2026-10-06' },
    ];

    const res = computeBurnAndRunway(txs, 10000000, fixedAsOf);

    // Window from 2026-10-06 to 2026-10-06 inclusive = 1 day
    assert.strictEqual(res.burn_window_days, 1, 'Window days for single date must be exactly 1');
    assert.strictEqual(res.window_start, '2026-10-06');
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.daily_spend, 1200000, 'Daily spend for 1 day = 1.2M / 1 = 1.2M');
    assert.strictEqual(res.operating_expenses, 1200000);
  });

  it('7. Window Boundaries: Partial window of 5 days (2026-10-02 to 2026-10-06 inclusive)', () => {
    const fixedAsOf = '2026-10-06';
    const txs = [
      // Operating inflow on 2026-10-02: 40 000 000 IDR
      { id: 1, type: 'income', category: 'Sales', description: 'Client invoice 101', amount_original: 40000000, amount_idr: 40000000, transaction_date: '2026-10-02' },
      // Operating expenses on 2026-10-04 (5M) and 2026-10-05 (10M): Total = 15 000 000 IDR
      { id: 2, type: 'expense', description: 'Cloud servers', amount_original: 5000000, amount_idr: 5000000, transaction_date: '2026-10-04' },
      { id: 3, type: 'expense', description: 'Office lease', amount_original: 10000000, amount_idr: 10000000, transaction_date: '2026-10-05' },
    ];

    const res = computeBurnAndRunway(txs, 100000000, fixedAsOf);

    // From 2026-10-02 to 2026-10-06 inclusive is exactly 5 calendar days:
    // Oct 2, Oct 3, Oct 4, Oct 5, Oct 6 = 5 days
    // Denominator = 5
    // Daily spend = 15 000 000 / 5 = 3 000 000 IDR/day (NOT 3.75M)
    assert.strictEqual(res.burn_window_days, 5, '5 calendar days inclusive');
    assert.strictEqual(res.window_start, '2026-10-02');
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 15000000);
    assert.strictEqual(res.daily_spend, 3000000, '15M / 5 days = 3,000,000 IDR/day');
    assert.strictEqual(res.net_burn_daily, 0, 'Inflows (40M) exceed expenses (15M)');
    assert.strictEqual(res.runway_reason, 'positive_cash_flow');
  });

  it('8. Window Boundaries: Exactly 30 days (asOfDate - 29 days)', () => {
    const fixedAsOf = '2026-10-06';
    // 30 days window starts at 2026-09-07
    const txs = [
      { id: 1, type: 'expense', description: 'Office lease', amount_original: 30000000, amount_idr: 30000000, transaction_date: '2026-09-07' },
      { id: 2, type: 'expense', description: 'Software license', amount_original: 15000000, amount_idr: 15000000, transaction_date: '2026-10-06' },
    ];

    const res = computeBurnAndRunway(txs, 90000000, fixedAsOf);

    assert.strictEqual(res.burn_window_days, 30, 'Full window must be exactly 30 days');
    assert.strictEqual(res.window_start, '2026-09-07');
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 45000000);
    assert.strictEqual(res.daily_spend, 1500000, '45M / 30 = 1,500,000 IDR/day');
  });

  it('9. Window Boundaries: Transaction before window start is strictly excluded', () => {
    const fixedAsOf = '2026-10-06';
    // Oldest transaction is 2 months ago (2026-08-01)
    // 30-day window starts at 2026-09-07
    const txs = [
      // Excluded: before window start
      { id: 1, type: 'expense', description: 'Old August payment', amount_original: 90000000, amount_idr: 90000000, transaction_date: '2026-08-01' },
      // Inside window:
      { id: 2, type: 'expense', description: 'September server', amount_original: 15000000, amount_idr: 15000000, transaction_date: '2026-09-10' },
      { id: 3, type: 'expense', description: 'October office', amount_original: 15000000, amount_idr: 15000000, transaction_date: '2026-10-01' },
    ];

    const res = computeBurnAndRunway(txs, 100000000, fixedAsOf);

    assert.strictEqual(res.burn_window_days, 30);
    assert.strictEqual(res.window_start, '2026-09-07');
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 30000000, 'Old 90M transaction before window start must be excluded');
    assert.strictEqual(res.daily_spend, 1000000, '30M / 30 = 1,000,000 IDR/day');
  });

  it('10. Future Transactions Exclusion: Transactions after asOfDate belong to forecast and are strictly excluded', () => {
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

    // Only past expense from 2026-10-02 to 2026-10-06 (5 days inclusive) must be counted
    assert.strictEqual(res.window_end, '2026-10-06');
    assert.strictEqual(res.operating_expenses, 10000000, 'Future 50M expense must not be included');
    assert.strictEqual(res.operating_inflows, 0, 'Future 100M revenue must not be included');
    assert.strictEqual(res.burn_window_days, 5);
    assert.strictEqual(res.daily_spend, 2000000, '10M / 5 days = 2,000,000 IDR/day');
  });

  it('11. Internal Transfer & Financing Neutrality: Does not inflate operating spend, net burn or runway', () => {
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

  it('12. Classification Counterexamples: Distinguishes vendor invoice expenses, customer payments and ambiguous reserves', () => {
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
