// Radar's arithmetic — the 30-day cash forecast.
//
// Reads GET /api/pulse?scope=business data.
// Invariants:
// 1. Paid, settled, cancelled, and pending_approval obligations are strictly excluded from confirmed cash.
// 2. Partially paid obligations use remaining balance; confirmed zero is never replaced with original amount.
// 3. Foreign currencies are converted to IDR via server-provided rates with source & date metadata (never summed 1:1).
//    There is NO client-side fallback table. If server rate is missing, the obligation is excluded and hasIncompleteForecast is set to true.
// 4. Horizon: only obligations falling within the 30-day window are counted in the 30-day projection. Obligations due > 30 days are excluded.
// 5. Overdue and undated items are tracked with explicit assumptions:
//    - Overdue payables are counted as immediate outflow requirements (conservative payment assumption).
//    - Overdue receivables are counted in expected income under collection assumptions, but DROPPED in worst-case (projWorst).
// 6. Double-counting boundary:
//    - burnRate is historical 30-day cash outflow from transactions.
//    - totalOut is discrete scheduled debt obligations.
//    - NOTE: Without transactional categorization on burnRate, recurring operational expenses (e.g. rent) present in both history and future payables cannot be automatically deduplicated.
// 7. Preserves exact formula:
//    proj30    = balance + totalIn - totalOut - burnRate * 30
//    projBest  = balance + totalIn - totalOut * 0.5
//    projWorst = balance - totalOut - burnRate * 30

const DAY_MS = 86400000;

export function startOfDay(d) {
  if (!d) return null;
  const m = typeof d === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const x = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}

export function radarFigures(data, options = {}) {
  const d = data || {};
  const balance = Number(d.totalBalance || 0);
  const burnRate = Number(d.burnRate || 0);
  const monthlyBurn = Math.round(burnRate * 30);
  const runway = burnRate > 0 ? Math.round(balance / burnRate) : null;

  const asOfDate = d.as_of_date || (options.today ? String(options.today).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const today = (options.today ? startOfDay(options.today) : (d.as_of_date ? startOfDay(d.as_of_date) : null)) || startOfDay(new Date());
  const horizon = options.horizon !== undefined ? Number(options.horizon) : 30;

  // Rate lookup: server rates ONLY. No static client fallback table.
  // Base currency IDR is 1:1 by definition.
  const rates = {
    IDR: { rate: 1, source: 'base_currency', date: asOfDate },
  };

  // 1. From server accounts rate_today
  if (Array.isArray(d.accounts)) {
    for (const acc of d.accounts) {
      if (acc && acc.currency && acc.rate_today) {
        rates[String(acc.currency).trim().toUpperCase()] = {
          rate: Number(acc.rate_today),
          source: 'server_account_snapshot',
          date: asOfDate,
        };
      }
    }
  }

  // 2. From server pulse rates payload
  if (d.rates && typeof d.rates === 'object') {
    for (const [c, entry] of Object.entries(d.rates)) {
      const curCode = String(c).trim().toUpperCase();
      if (entry != null && typeof entry === 'object' && entry.rate != null) {
        rates[curCode] = {
          rate: Number(entry.rate),
          source: entry.source || 'server_snapshot',
          date: entry.date || asOfDate,
        };
      } else if (entry != null && !Number.isNaN(Number(entry))) {
        rates[curCode] = {
          rate: Number(entry),
          source: 'server_snapshot',
          date: asOfDate,
        };
      }
    }
  }

  // 3. Explicit options.rates override (for testing or simulations)
  if (options.rates && typeof options.rates === 'object') {
    for (const [c, entry] of Object.entries(options.rates)) {
      const curCode = String(c).trim().toUpperCase();
      if (entry != null && typeof entry === 'object' && entry.rate != null) {
        rates[curCode] = {
          rate: Number(entry.rate),
          source: entry.source || 'options_override',
          date: entry.date || asOfDate,
        };
      } else if (entry != null && !Number.isNaN(Number(entry))) {
        rates[curCode] = {
          rate: Number(entry),
          source: 'options_override',
          date: asOfDate,
        };
      }
    }
  }

  const rawDebts = Array.isArray(d.debts) ? d.debts : [];

  const receivables = [];
  const payables = [];
  const excludedPaidOrCancelled = [];
  const excludedPending = [];
  const excludedFuture = [];
  const unconverted = [];
  const overduePayables = [];
  const overdueReceivables = [];
  const undatedItems = [];

  const includeUndated = options.includeUndated !== undefined ? Boolean(options.includeUndated) : true;

  for (const item of rawDebts) {
    if (!item) continue;

    // 1. Status exclusion (paid, cancelled, settled, rejected, pending_approval)
    const status = String(item.status || '').toLowerCase();
    if (['paid', 'cancelled'].includes(status) || item.is_settled === true || item.approval_status === 'rejected') {
      excludedPaidOrCancelled.push(item);
      continue;
    }

    if (item.approval_status === 'pending_approval') {
      excludedPending.push(item);
      continue;
    }

    // 2. Remaining balance (strictly never let confirmed 0 fall back to original amount)
    let remaining;
    if (item.remaining_amount !== undefined && item.remaining_amount !== null) {
      remaining = Number(item.remaining_amount);
    } else {
      const orig = Number(item.original_amount ?? item.amount ?? 0);
      const paid = Number(item.paid_amount || 0);
      remaining = Math.max(0, orig - paid);
    }

    if (remaining <= 0) {
      // Confirmed 0 remaining balance = completed obligation
      excludedPaidOrCancelled.push(item);
      continue;
    }

    // 3. Currency conversion to IDR via server rate
    const rawCur = item.currency;
    let cur = null;
    let rateMissing = false;
    let amountIdr = null;
    let rateUsed = null;
    let rateSource = null;
    let rateDate = null;

    if (rawCur === null || rawCur === '') {
      // Explicitly missing currency
      rateMissing = true;
    } else if (rawCur === undefined) {
      // Unspecified currency: default to IDR unless strict
      if (options.strictCurrency) {
        rateMissing = true;
      } else {
        cur = 'IDR';
        rateUsed = 1;
        rateSource = 'base_currency';
        rateDate = asOfDate;
        amountIdr = remaining;
      }
    } else {
      cur = String(rawCur).trim().toUpperCase();
      const rObj = rates[cur];
      if (rObj && Number(rObj.rate) > 0) {
        rateUsed = Number(rObj.rate);
        rateSource = rObj.source || 'server_snapshot';
        rateDate = rObj.date || asOfDate;
        amountIdr = cur === 'IDR' ? remaining : Math.round(remaining * rateUsed);
      } else {
        rateMissing = true;
      }
    }

    if (rateMissing) {
      unconverted.push({
        ...item,
        remaining,
        currency: cur,
        reason: !cur ? 'missing_currency' : 'unknown_rate',
      });
      continue;
    }

    // 4. Date evaluation
    let isOverdue = false;
    let isUndated = false;
    let daysUntil = null;
    const due = item.due_date ? startOfDay(item.due_date) : null;

    if (!due) {
      isUndated = true;
      undatedItems.push(item);
      if (!includeUndated) {
        continue;
      }
    } else {
      daysUntil = Math.round((due.getTime() - today.getTime()) / DAY_MS);
      if (daysUntil > horizon) {
        excludedFuture.push({
          ...item,
          remaining,
          currency: cur,
          amountIdr,
          daysUntil,
        });
        continue;
      }
      if (daysUntil < 0) {
        isOverdue = true;
        if (item.type === 'receivable') overdueReceivables.push(item);
        else if (item.type === 'payable') overduePayables.push(item);
      }
    }

    const enriched = {
      ...item,
      amount: amountIdr,
      remaining_amount: remaining,
      currency: cur,
      original_amount: remaining,
      original_currency: cur,
      amount_idr: amountIdr,
      rate_used: rateUsed,
      rate_source: rateSource,
      rate_date: rateDate,
      days_until: daysUntil,
      is_overdue: isOverdue,
      is_undated: isUndated,
    };

    if (item.type === 'receivable') {
      receivables.push(enriched);
    } else if (item.type === 'payable') {
      payables.push(enriched);
    }
  }

  const totalIn = receivables.reduce((s, x) => s + (x.amount || 0), 0);
  const totalOut = payables.reduce((s, x) => s + (x.amount || 0), 0);

  // Exact scenario formula (pinned by design test suite)
  const proj30 = balance + totalIn - totalOut - burnRate * 30;
  const projBest = balance + totalIn - totalOut * 0.5;
  const projWorst = balance - totalOut - burnRate * 30;

  const hasIncompleteForecast = unconverted.length > 0;

  return {
    balance,
    burnRate,
    receivables,
    payables,
    totalIn,
    totalOut,
    proj30,
    projBest,
    projWorst,
    monthlyBurn,
    runway,
    isHealthy: proj30 >= 0,
    burnWindowDays: d.burnWindowDays,
    hasIncompleteForecast,
    unconvertedDebts: unconverted,
    serverRatesAvailable: rates,
    assumptions: {
      overduePayablesCount: overduePayables.length,
      overdueReceivablesCount: overdueReceivables.length,
      overdueCount: overduePayables.length + overdueReceivables.length,
      undatedCount: undatedItems.length,
      futureExcludedCount: excludedFuture.length,
      futureExcludedTotalIdr: excludedFuture.reduce((s, x) => s + (x.amountIdr || 0), 0),
      excludedPaidOrCancelledCount: excludedPaidOrCancelled.length,
      excludedPendingCount: excludedPending.length,
      hasIncompleteForecast,
      unconvertedCount: unconverted.length,
      burnRateSource: 'rolling_30d_cash_out',
      burnRateNote: 'burnRate is derived from historical 30-day cash outflow. Recurring expenses present in both history and scheduled payables are not automatically deduplicated.',
    },
  };
}

export default radarFigures;
