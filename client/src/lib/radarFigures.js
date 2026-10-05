// Radar's arithmetic — the 30-day cash forecast.
//
// Reads GET /api/pulse?scope=business data.
// Invariants:
// 1. Paid and cancelled obligations are strictly excluded.
// 2. Partially paid obligations use remaining balance; confirmed zero is never replaced with original amount.
// 3. Foreign currencies are converted to IDR via today's rate (never summed 1:1). Missing rate or currency is flagged as incomplete forecast and excluded from sums.
// 4. Horizon: only obligations falling within the 30-day window are counted in the 30-day projection. Overdue and undated are included under stated assumptions; obligations due > 30 days are excluded.
// 5. Preserves exact formula:
//    proj30    = balance + totalIn - totalOut - burnRate * 30
//    projBest  = balance + totalIn - totalOut * 0.5
//    projWorst = balance - totalOut - burnRate * 30

export const DEFAULT_RATES_TO_IDR = {
  IDR: 1,
  USD: 16300,
  EUR: 17800,
  SGD: 12500,
  USDT: 16290,
  MYR: 3850,
  THB: 490,
  CNY: 2320,
  AUD: 10800,
  GBP: 21500,
  JPY: 110,
};

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

  // Rate lookup table: options.rates -> data.rates -> data.accounts[].rate_today -> DEFAULT_RATES_TO_IDR
  const rates = { ...DEFAULT_RATES_TO_IDR };
  if (Array.isArray(d.accounts)) {
    for (const acc of d.accounts) {
      if (acc && acc.currency && acc.rate_today) {
        rates[String(acc.currency).trim().toUpperCase()] = Number(acc.rate_today);
      }
    }
  }
  if (d.rates && typeof d.rates === 'object') {
    for (const [c, r] of Object.entries(d.rates)) {
      if (r != null && !Number.isNaN(Number(r))) {
        rates[String(c).trim().toUpperCase()] = Number(r);
      }
    }
  }
  if (options.rates && typeof options.rates === 'object') {
    for (const [c, r] of Object.entries(options.rates)) {
      if (r != null && !Number.isNaN(Number(r))) {
        rates[String(c).trim().toUpperCase()] = Number(r);
      }
    }
  }

  const today = (options.today ? startOfDay(options.today) : (d.as_of_date ? startOfDay(d.as_of_date) : null)) || startOfDay(new Date());
  const horizon = options.horizon !== undefined ? Number(options.horizon) : 30;

  const rawDebts = Array.isArray(d.debts) ? d.debts : [];

  const receivables = [];
  const payables = [];
  const excludedPaidOrCancelled = [];
  const excludedFuture = [];
  const unconverted = [];
  const overdueItems = [];
  const undatedItems = [];

  for (const item of rawDebts) {
    if (!item) continue;

    // 1. Status exclusion (paid, cancelled, settled, rejected)
    const status = String(item.status || '').toLowerCase();
    if (['paid', 'cancelled'].includes(status) || item.is_settled === true || item.approval_status === 'rejected') {
      excludedPaidOrCancelled.push(item);
      continue;
    }

    // 2. Remaining balance (strictly never let 0 fall back to original amount)
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

    // 3. Currency conversion to IDR
    const rawCur = item.currency;
    let cur = null;
    let rateMissing = false;
    let amountIdr = null;
    let rateUsed = null;

    if (rawCur === null || rawCur === '') {
      // Explicitly missing currency
      rateMissing = true;
    } else if (rawCur === undefined) {
      // Unspecified currency
      if (options.strictCurrency) {
        rateMissing = true;
      } else {
        cur = 'IDR';
        rateUsed = 1;
        amountIdr = remaining;
      }
    } else {
      cur = String(rawCur).trim().toUpperCase();
      if (cur === 'IDR') {
        rateUsed = 1;
        amountIdr = remaining;
      } else {
        const r = rates[cur];
        if (r && Number(r) > 0) {
          rateUsed = Number(r);
          amountIdr = Math.round(remaining * rateUsed);
        } else {
          rateMissing = true;
        }
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
        overdueItems.push(item);
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

  // Exact scenario formula
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
    assumptions: {
      overdueCount: overdueItems.length,
      undatedCount: undatedItems.length,
      futureExcludedCount: excludedFuture.length,
      futureExcludedTotalIdr: excludedFuture.reduce((s, x) => s + (x.amountIdr || 0), 0),
      excludedPaidOrCancelledCount: excludedPaidOrCancelled.length,
      hasIncompleteForecast,
      unconvertedCount: unconverted.length,
    },
  };
}

export default radarFigures;
