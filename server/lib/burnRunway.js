// server/lib/burnRunway.js
// Calculation of Daily Operating Spend, Net Burn, and Runway
'use strict';

const TX = require('./transactionClass');
const FININ = require('./financialInsights');

/**
 * Determines whether a transaction is an operating expense.
 * Strictly excludes:
 * - Internal transfers (isTransfer, category 'Transfer', transfer_id)
 * - Financing (loan repayments, capital withdrawals, funding)
 * - CAPEX (durable equipment purchases)
 * - Tax payments (PPh/PPN payments)
 * - Opening balance corrections
 */
function isOperatingExpense(t) {
  if (!t) return false;
  const eff = FININ.effectiveDate(t);
  if (!eff) return false;

  const isTransfer = t.type === 'transfer' || !!t.transfer_id || t.category === 'Transfer';
  if (isTransfer) return false;

  const cls = FININ.classifyTransaction(t).class;
  if (FININ.NON_OPERATING.includes(cls)) return false;

  if (['direct_cost', 'operating_expense'].includes(cls)) return true;
  if (TX.CASH_OUT_LEGACY.includes(t.type) && !FININ.NON_OPERATING.includes(cls)) return true;
  return false;
}

/**
 * Determines whether a transaction is an operating cash inflow (earned revenue).
 * Strictly excludes:
 * - Internal transfers
 * - Financing (capital contributions, shareholder loans, debt proceeds, investor funding)
 * - Opening balances
 * - Balance corrections
 */
function isOperatingInflow(t) {
  if (!t) return false;
  const eff = FININ.effectiveDate(t);
  if (!eff) return false;

  const isTransfer = t.type === 'transfer' || !!t.transfer_id || t.category === 'Transfer';
  if (isTransfer) return false;

  const cls = FININ.classifyTransaction(t).class;
  if (FININ.NON_OPERATING.includes(cls)) return false;

  if (cls === 'revenue') return true;
  return false;
}

/**
 * Extracts normalized IDR amount for a transaction.
 * Never substitutes raw foreign currency amount as IDR if unconverted.
 * Returns { amount_idr: number|null, is_unvalued: boolean }
 */
function extractIdrAmount(t) {
  if (t.amount_idr != null && Number.isFinite(Number(t.amount_idr))) {
    return { amount_idr: Number(t.amount_idr), is_unvalued: false };
  }
  const cur = (t.currency_original || t.currency || 'IDR').toUpperCase();
  if (cur === 'IDR') {
    const n = Number(t.amount_original != null ? t.amount_original : t.amount);
    return { amount_idr: Number.isFinite(n) ? n : 0, is_unvalued: false };
  }
  // Foreign currency with no converted amount in IDR
  return { amount_idr: null, is_unvalued: true };
}

/**
 * Computes daily operating spend, net burn, and runway over a rolling window.
 *
 * @param {Array} allTxs - Array of all business transactions
 * @param {number} totalBalance - Current total cash balance across active accounts
 * @param {string|Date} [asOfDate] - Optional anchor date for calculations (defaults to now)
 * @returns {{
 *   daily_spend: number|null,
 *   daily_spend_window_days: number,
 *   burn_rate_daily: number,
 *   net_burn_daily: number,
 *   net_burn_monthly: number,
 *   runway_days: number|null,
 *   runway_reason: 'depleting'|'positive_cash_flow'|'break_even'|'insufficient_data',
 *   burn_window_days: number,
 *   window_start: string|null,
 *   window_end: string|null,
 *   operating_expenses: number,
 *   operating_inflows: number,
 *   has_unvalued_tx: boolean,
 *   unvalued_tx_count: number
 * }}
 */
function computeBurnAndRunway(allTxs, totalBalance, asOfDate = null) {
  const asOfStr = asOfDate
    ? (typeof asOfDate === 'string' ? asOfDate.slice(0, 10) : new Date(asOfDate).toISOString().slice(0, 10))
    : new Date().toISOString().slice(0, 10);

  const eff = (t) => {
    const d = FININ.effectiveDate(t);
    return d ? String(d).slice(0, 10) : null;
  };

  // 1. Exclude future transactions (date > asOfStr): future transactions belong to forecast, not historical burn
  const historicalTxs = (allTxs || []).filter(t => {
    const d = eff(t);
    return d && d <= asOfStr;
  });

  const allExpTxs = historicalTxs.filter(isOperatingExpense);
  const allInTxs = historicalTxs.filter(isOperatingInflow);
  const allOpTxs = [...allExpTxs, ...allInTxs];

  if (allOpTxs.length === 0) {
    return {
      daily_spend: null,
      daily_spend_window_days: 0,
      burn_rate_daily: 0,
      net_burn_daily: 0,
      net_burn_monthly: 0,
      runway_days: null,
      runway_reason: 'insufficient_data',
      burn_window_days: 0,
      window_start: null,
      window_end: asOfStr,
      operating_expenses: 0,
      operating_inflows: 0,
      has_unvalued_tx: false,
      unvalued_tx_count: 0,
    };
  }

  // Find oldest transaction date across BOTH operating expenses and operating inflows
  const oldestDateStr = allOpTxs.reduce((oldest, t) => {
    const d = eff(t);
    return !oldest || d < oldest ? d : oldest;
  }, null);

  // Timezone-safe calendar days calculation
  const dStart = new Date(oldestDateStr + 'T00:00:00.000Z');
  const dEnd = new Date(asOfStr + 'T00:00:00.000Z');
  const calendarDays = Math.max(1, Math.round((dEnd - dStart) / 86400000));
  const windowDays = Math.min(30, calendarDays);

  // Window start date strictly matches windowDays (up to 30 days)
  let windowStartStr;
  if (calendarDays >= 30) {
    const cutoffDate = new Date(dEnd.getTime() - 30 * 86400000);
    windowStartStr = cutoffDate.toISOString().slice(0, 10);
  } else {
    windowStartStr = oldestDateStr;
  }

  // Filter window transactions strictly in [windowStartStr, asOfStr]
  const windowExpTxs = allExpTxs.filter(t => {
    const d = eff(t);
    return d >= windowStartStr && d <= asOfStr;
  });
  const windowInTxs = allInTxs.filter(t => {
    const d = eff(t);
    return d >= windowStartStr && d <= asOfStr;
  });

  let hasUnvaluedTx = false;
  let unvaluedTxCount = 0;

  // Operating expenses in window
  const totalExp = windowExpTxs.reduce((s, t) => {
    const ext = extractIdrAmount(t);
    if (ext.is_unvalued) {
      hasUnvaluedTx = true;
      unvaluedTxCount++;
      return s;
    }
    return s + (ext.amount_idr || 0);
  }, 0);

  // Operating inflows in window
  const totalInflows = windowInTxs.reduce((s, t) => {
    const ext = extractIdrAmount(t);
    if (ext.is_unvalued) {
      hasUnvaluedTx = true;
      unvaluedTxCount++;
      return s;
    }
    return s + (ext.amount_idr || 0);
  }, 0);

  // Numerator: operating expenses in window. Denominator: windowDays.
  const dailySpend = allExpTxs.length > 0 ? Math.round(totalExp / windowDays) : null;

  // Net burn: cash out minus cash in from operations
  const netCashDrain = totalExp - totalInflows;
  const netBurnDaily = netCashDrain > 0 ? Math.round(netCashDrain / windowDays) : 0;
  const netBurnMonthly = netBurnDaily * 30;

  let runwayDays = null;
  let runwayReason = 'insufficient_data';

  if (dailySpend === null && totalInflows === 0) {
    runwayDays = null;
    runwayReason = 'insufficient_data';
  } else if (netBurnDaily > 0) {
    runwayDays = totalBalance > 0 ? Math.round(totalBalance / netBurnDaily) : 0;
    runwayReason = 'depleting';
  } else if (totalInflows > totalExp) {
    runwayDays = null;
    runwayReason = 'positive_cash_flow';
  } else if (totalInflows === totalExp && (totalExp > 0 || totalInflows > 0)) {
    runwayDays = null;
    runwayReason = 'break_even';
  } else {
    runwayDays = null;
    runwayReason = 'insufficient_data';
  }

  return {
    daily_spend: dailySpend,
    daily_spend_window_days: windowDays,
    burn_rate_daily: dailySpend || 0, // backwards compatible with legacy d.burnRate
    net_burn_daily: netBurnDaily,
    net_burn_monthly: netBurnMonthly,
    runway_days: runwayDays,
    runway_reason: runwayReason,
    burn_window_days: windowDays,
    window_start: windowStartStr,
    window_end: asOfStr,
    operating_expenses: totalExp,
    operating_inflows: totalInflows,
    has_unvalued_tx: hasUnvaluedTx,
    unvalued_tx_count: unvaluedTxCount,
  };
}

module.exports = {
  isOperatingExpense,
  isOperatingInflow,
  computeBurnAndRunway,
  extractIdrAmount,
};
