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

/** Buckets a transaction can land in. `unknown` is a real outcome, not an error.
 *
 *  Only `revenue` counts as operating revenue, and only `direct_cost` +
 *  `operating_expense` count as operating cash out. Everything else is real money
 *  that moved but is NOT operating performance — it is reported separately as other
 *  cash movement so it can never inflate revenue, OPEX or EBITDA. */
const CLASSES = [
  'revenue', 'direct_cost', 'operating_expense', 'capex',
  'tax', 'interest', 'financing',
  'opening_balance', 'transfer', 'balance_correction',
  'other', 'unknown',
];

/** Classes that are cash movement but never operating performance. */
const NON_OPERATING = Object.freeze([
  'capex', 'tax', 'interest', 'financing',
  'opening_balance', 'transfer', 'balance_correction', 'other',
]);

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
  // Seeding a wallet with what was already in it. This is NOT money the business
  // earned, and counting it as revenue was the V1 bug this table exists to prevent.
  // POST /api/wallets writes "Opening balance · <wallet>"; the category and source
  // markers are set on newer rows so older ones still match on the description.
  opening_balance: [/opening\s+balance/i, /wallet_opening_balance/i, /\bsaldo\s+awal\b/i],
  // Money moving between accounts the business already owns — net zero, never revenue.
  transfer: [/\btransfer\b/i, /intercompany/i, /\bmove\s+to\b/i, /between\s+wallets/i],
  balance_correction: [/balance\s+correction/i, /\breconcil/i],
  // A durable asset being bought — not the servicing of one. `NOT_CAPEX` guards
  // "equipment maintenance", which is an operating cost, not a purchase.
  capex: [/\bequipment\b/i, /\bmachine(ry)?\b/i, /\bhardware\b/i, /\bdevice\b/i,
          /asset\s+purchase/i, /purchase\s+of\s+(a\s+)?(machine|equipment|device)/i,
          /\bperalatan\b/i, /\bmesin\b/i, /capital\s+expenditure/i, /\bcapex\b/i],
  tax: [/\bdjp\b/i, /\bpph\b/i, /\bppn\b/i, /\bpajak\b/i, /tax\s+payable/i,
        /withholding/i, /\bbukti\s+potong\b/i, /\btax\b/i],
  interest: [/\binterest\b/i, /\bbunga\b/i, /loan\s+interest/i],
  financing: [/loan\s+(repayment|principal|proceeds)/i, /owner\s+(funding|withdrawal|draw)/i,
              /capital\s+(injection|contribution)/i, /\bfinancing\b/i, /\bmodal\b/i,
              /shareholder\s+loan/i, /\bfunding\b/i, /\bdividend\b/i],
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
  const src = (tx && tx.source) || '';
  const none = { class: 'unknown', matched_on: 'none', needs_review: true };

  // ── Non-operating checks run FIRST, before the income/expense gate ──────────
  // These are the rows that must never reach the revenue or OPEX buckets. A wallet
  // opening balance is written as type='income', so gating on type alone would file
  // it as revenue — which is exactly the bug this ordering prevents.
  if (type === 'correction' || hit(RE.balance_correction, s))
    return { class: 'balance_correction', matched_on: 'type_or_keyword', needs_review: false };
  if (hit(RE.opening_balance, s) || /wallet_opening_balance/i.test(src))
    return { class: 'opening_balance', matched_on: 'keyword', needs_review: false };
  if (type === 'transfer' || hit(RE.transfer, s))
    return { class: 'transfer', matched_on: 'type_or_keyword', needs_review: false };

  if (!s) return none;

  // Narrow claims next.
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

  const zero = () => ({
    revenue: 0, direct_costs: 0, opex: 0, capex: 0, tax_expense: 0, interest_expense: 0,
    unknown: 0, financing: 0, opening_balance: 0, transfer: 0, balance_correction: 0, other: 0,
  });
  const total = zero();
  const byMonth = new Map();
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let unknownCount = 0;

  // Every class maps to exactly one accumulator, so no amount is ever counted twice
  // and none is silently dropped — the excluded ones are reported, not hidden.
  const FIELD = {
    revenue: 'revenue', direct_cost: 'direct_costs', operating_expense: 'opex',
    capex: 'capex', tax: 'tax_expense', interest: 'interest_expense',
    financing: 'financing', opening_balance: 'opening_balance', transfer: 'transfer',
    balance_correction: 'balance_correction', other: 'other', unknown: 'unknown',
  };

  for (const t of rows) {
    const { class: cls, needs_review } = classifyTransaction(t);
    counts[cls] = (counts[cls] || 0) + 1;
    const amt = amountOf(t);
    const mk = monthKey(effectiveDate(t));
    if (!byMonth.has(mk)) byMonth.set(mk, zero());
    const m = byMonth.get(mk);

    const field = FIELD[cls];
    if (field) { total[field] += amt; m[field] += amt; }
    if (cls === 'unknown' && needs_review) unknownCount++;
  }

  const derive = (b) => {
    const gross_profit = b.revenue - b.direct_costs;
    // CAPEX is NOT subtracted: EBITDA is before capital spend, and cash-basis CAPEX
    // is not an expense. Tax and interest are excluded by definition of EBITDA.
    const estimated_ebitda = b.revenue - b.direct_costs - b.opex;
    // The two figures Pulse shows at the top. Named explicitly so nobody has to infer
    // that "revenue" here means OPERATING revenue and excludes opening balances,
    // funding and transfers.
    const operating_cash_out = b.direct_costs + b.opex;
    return {
      revenue: b.revenue,
      operating_revenue: b.revenue,
      direct_costs: b.direct_costs,
      gross_profit,
      gross_margin: b.revenue > 0 ? gross_profit / b.revenue : null,
      opex: b.opex,
      operating_cash_out,
      net_operating_position: b.revenue - operating_cash_out,
      capex: b.capex,
      estimated_ebitda,
      tax_expense: b.tax_expense,
      interest_expense: b.interest_expense,
      estimated_net_profit: estimated_ebitda - b.tax_expense - b.interest_expense,
      // Real cash that moved but is not operating performance. Surfaced, never merged.
      other_cash_movement: {
        opening_balance: b.opening_balance,
        funding: b.financing,
        transfers: b.transfer,
        balance_corrections: b.balance_correction,
        tax: b.tax_expense,
        capex: b.capex,
        needs_review: b.unknown,
        total: b.opening_balance + b.financing + b.transfer + b.balance_correction + b.unknown,
      },
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
    needs_review_count: unknownCount,
    transactions_considered: rows.length,
  };
}

module.exports = {
  CLASSES, NON_OPERATING, classifyTransaction, computeInsights, effectiveDate, monthKey,
};
