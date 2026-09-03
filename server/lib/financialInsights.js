// Advanced Financial Insights V1 — cash-basis estimates from the transaction ledger.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
// A keyword classifier over transactions the user already recorded, plus the four
// derived figures Pulse wants to show: gross profit, CAPEX, estimated EBITDA and
// estimated net profit.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//   * NOT audited accounting. Everything here is CASH-BASIS: it reads money that
//     moved, not accruals. Revenue recognition, matching and cut-off are not applied.
//   * NOT a depreciation engine. CAPEX is reported as cash spent on assets in the
//     period; it is never depreciated, and never subtracted from EBITDA.
//   * NOT a substitute for a chart of accounts. Classification is keyword matching
//     over `category` and `description`, so anything unrecognised stays `unknown`
//     and is deliberately excluded from every metric rather than guessed into one.
//
// The honest-failure rule: a metric that cannot be computed from real classified
// amounts returns a `needs_*` / `locked` status instead of a number. Callers must
// render the status, not a zero.
'use strict';

/** Buckets a transaction can land in. `unknown` is a real outcome, not an error. */
const CLASSES = [
  'revenue', 'direct_cost', 'operating_expense', 'capex',
  'tax', 'interest', 'financing', 'other', 'unknown',
];

/**
 * Effective date of a transaction: the day the money actually moved.
 *
 * `created_at` is when the row was TYPED, which is a different thing entirely — a
 * back-dated entry inserted today belongs to its own month, not to this one. It is
 * kept only as a fallback for rows written before `transaction_date` existed.
 */
function effectiveDate(tx) {
  return (tx && (tx.transaction_date || tx.date || tx.created_at)) || null;
}

const monthKey = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null
    : `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
};

/* ── keyword tables ────────────────────────────────────────────────────────
   Ordered by specificity. CAPEX / tax / interest / financing are tested BEFORE
   the general expense buckets, because they are narrower claims. */
const RE = {
  // A durable asset being bought — not the servicing of one. `NOT_CAPEX` guards
  // "equipment maintenance", which is an operating cost, not a purchase.
  capex: [/\bequipment\b/i, /\bmachine(ry)?\b/i, /\bhardware\b/i, /\bdevice\b/i,
          /asset\s+purchase/i, /purchase\s+of\s+(a\s+)?(machine|equipment|device)/i,
          /\bperalatan\b/i, /\bmesin\b/i, /capital\s+expenditure/i, /\bcapex\b/i],
  tax: [/\bdjp\b/i, /\bpph\b/i, /\bppn\b/i, /\bpajak\b/i, /tax\s+payable/i,
        /withholding/i, /\bbukti\s+potong\b/i, /\btax\b/i],
  interest: [/\binterest\b/i, /\bbunga\b/i, /loan\s+interest/i],
  financing: [/loan\s+(repayment|principal)/i, /owner\s+funding/i, /capital\s+injection/i,
              /\bfinancing\b/i, /\bmodal\b/i, /shareholder\s+loan/i],
  revenue: [/\brevenue\b/i, /\bsales\b/i, /\bpenjualan\b/i, /wash\s+revenue/i,
            /advertising\s+slot/i, /co-?branding/i, /partner\s+settlement/i,
            /xendit\s+settlement/i, /\bsettlement\b/i, /\bincome\b/i],
  direct_cost: [/refill/i, /liquid\s+supplies/i, /\bsupplies\b/i, /\bmaintenance\b/i,
                /\belectricity\b/i, /\blistrik\b/i, /\blogistics\b/i, /\bcogs\b/i,
                /direct\s+cost/i, /\bconsumables?\b/i],
  operating_expense: [/\brent\b/i, /\bsewa\b/i, /\bsalary\b/i, /\bpayroll\b/i, /\bgaji\b/i,
                      /\bmarketing\b/i, /\bsoftware\b/i, /subscription/i, /\bbank\b.*\bfee\b/i,
                      /admin\s+fee/i, /\butilit(y|ies)\b/i, /\binsurance\b/i, /\boffice\b/i],
};
const NOT_CAPEX = [/maintenance/i, /\brepair/i, /\bservicing\b/i, /\brental\b/i, /\brent\b/i];

const hay = (tx) => `${(tx && tx.category) || ''} ${(tx && tx.description) || ''} ${(tx && tx.notes) || ''}`.trim();
const hit = (list, s) => list.some((re) => re.test(s));

/**
 * Classify one transaction.
 * @returns { class, matched_on, needs_review }
 */
function classifyTransaction(tx) {
  const s = hay(tx);
  const type = (tx && tx.type) || '';
  const none = { class: 'unknown', matched_on: 'none', needs_review: true };
  if (!s) return none;

  // Narrow claims first.
  if (hit(RE.capex, s) && !hit(NOT_CAPEX, s)) return { class: 'capex', matched_on: 'keyword', needs_review: false };
  if (hit(RE.tax, s)) return { class: 'tax', matched_on: 'keyword', needs_review: false };
  if (hit(RE.interest, s)) return { class: 'interest', matched_on: 'keyword', needs_review: false };
  if (hit(RE.financing, s)) return { class: 'financing', matched_on: 'keyword', needs_review: false };

  // Money direction is a strong signal, so revenue is only claimed for inbound rows.
  if (type === 'income') {
    if (hit(RE.revenue, s)) return { class: 'revenue', matched_on: 'keyword', needs_review: false };
    // Inbound but unrecognised: real money, unclear source. Never silently revenue.
    return { class: 'unknown', matched_on: 'income_unmatched', needs_review: true };
  }

  if (type === 'expense' || type === 'payroll') {
    if (type === 'payroll') return { class: 'operating_expense', matched_on: 'type', needs_review: false };
    if (hit(RE.direct_cost, s)) return { class: 'direct_cost', matched_on: 'keyword', needs_review: false };
    if (hit(RE.operating_expense, s)) return { class: 'operating_expense', matched_on: 'keyword', needs_review: false };
    return { class: 'unknown', matched_on: 'expense_unmatched', needs_review: true };
  }

  // transfer / correction and anything else: never a P&L line.
  if (type === 'transfer' || type === 'correction') return { class: 'other', matched_on: 'type', needs_review: false };
  return none;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const amountOf = (tx) => Math.abs(num(tx.amount_idr != null ? tx.amount_idr : tx.amount_original != null ? tx.amount_original : tx.amount));

/**
 * Compute V1 insights over a set of transactions.
 *
 * @param transactions rows with { type, category, description, amount_*, transaction_date }
 * @param opts { from, to } ISO dates (inclusive) filtering on the EFFECTIVE date
 * @returns { period, metrics, status, warnings, series, classified_counts }
 */
function computeInsights(transactions = [], opts = {}) {
  const rows = (Array.isArray(transactions) ? transactions : []).filter((t) => {
    const d = effectiveDate(t);
    if (!d) return false;
    if (opts.from && String(d).slice(0, 10) < String(opts.from).slice(0, 10)) return false;
    if (opts.to && String(d).slice(0, 10) > String(opts.to).slice(0, 10)) return false;
    return true;
  });

  const zero = () => ({ revenue: 0, direct_costs: 0, opex: 0, capex: 0, tax_expense: 0, interest_expense: 0, unknown: 0 });
  const total = zero();
  const byMonth = new Map();
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let unknownCount = 0;

  for (const t of rows) {
    const { class: cls, needs_review } = classifyTransaction(t);
    counts[cls] = (counts[cls] || 0) + 1;
    const amt = amountOf(t);
    const mk = monthKey(effectiveDate(t));
    if (!byMonth.has(mk)) byMonth.set(mk, zero());
    const m = byMonth.get(mk);

    const add = (field) => { total[field] += amt; m[field] += amt; };
    if (cls === 'revenue') add('revenue');
    else if (cls === 'direct_cost') add('direct_costs');
    else if (cls === 'operating_expense') add('opex');
    else if (cls === 'capex') add('capex');
    else if (cls === 'tax') add('tax_expense');
    else if (cls === 'interest') add('interest_expense');
    else if (cls === 'unknown') { add('unknown'); if (needs_review) unknownCount++; }
    // `financing` and `other` are intentionally excluded from every P&L metric.
  }

  const derive = (b) => {
    const gross_profit = b.revenue - b.direct_costs;
    // CAPEX is NOT subtracted: EBITDA is before capital spend, and cash-basis CAPEX
    // is not an expense. Tax and interest are excluded by definition of EBITDA.
    const estimated_ebitda = b.revenue - b.direct_costs - b.opex;
    return {
      revenue: b.revenue,
      direct_costs: b.direct_costs,
      gross_profit,
      gross_margin: b.revenue > 0 ? gross_profit / b.revenue : null,
      opex: b.opex,
      capex: b.capex,
      estimated_ebitda,
      tax_expense: b.tax_expense,
      interest_expense: b.interest_expense,
      estimated_net_profit: estimated_ebitda - b.tax_expense - b.interest_expense,
    };
  };

  const metrics = derive(total);
  const hasRevenue = total.revenue > 0;
  const hasCosts = total.direct_costs > 0 || total.opex > 0;

  const status = {
    gross_profit: hasRevenue && total.direct_costs > 0 ? 'available' : 'needs_cost_structure',
    capex: total.capex > 0 ? 'available' : 'needs_asset_structure',
    ebitda: hasRevenue && hasCosts ? 'estimated' : 'locked',
    net_profit: hasRevenue && hasCosts ? 'estimated' : 'locked',
  };

  const warnings = [];
  if (unknownCount > 0) {
    warnings.push(`${unknownCount} transaction${unknownCount === 1 ? '' : 's'} could not be classified and ${unknownCount === 1 ? 'is' : 'are'} excluded from every metric.`);
  }
  if (status.ebitda === 'estimated') {
    warnings.push('Estimated EBITDA is cash-basis, before depreciation and amortisation mapping.');
    warnings.push('Needs full accounting structure for final EBITDA.');
  }
  if (status.net_profit === 'estimated') {
    warnings.push('Estimated net profit is incomplete until tax, interest and depreciation are fully mapped.');
  }
  if (total.tax_expense === 0) warnings.push('No tax expense classified in this period.');
  if (total.interest_expense === 0) warnings.push('No interest expense classified in this period.');
  warnings.push('Depreciation and amortisation are not modelled in V1.');

  const series = [...byMonth.entries()]
    .filter(([k]) => k)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([period, b]) => ({ period, ...derive(b) }));

  const dates = rows.map((t) => String(effectiveDate(t)).slice(0, 10)).filter(Boolean).sort();

  return {
    period: {
      from: opts.from || dates[0] || null,
      to: opts.to || dates[dates.length - 1] || null,
      granularity: 'month',
    },
    metrics,
    status,
    warnings,
    series,
    classified_counts: counts,
    transactions_considered: rows.length,
  };
}

module.exports = { CLASSES, classifyTransaction, computeInsights, effectiveDate, monthKey };
