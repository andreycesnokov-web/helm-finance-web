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
const { PURPOSE_CLASS } = require('./transactionClassifications');

const CLASSES = [
  'revenue', 'direct_cost', 'operating_expense', 'capex',
  'tax', 'interest', 'financing',
  'opening_balance', 'transfer', 'balance_correction',
  'other', 'unknown', 'personal',
];

/** Classes that are cash movement but never operating performance. */
const NON_OPERATING = Object.freeze([
  'capex', 'tax', 'interest', 'financing',
  'opening_balance', 'transfer', 'balance_correction', 'other', 'personal',
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
              /capital\s+(injection|contribution|funding)/i, /\bfinancing\b/i, /\bmodal\s+(disetor|usaha)\b/i,
              /shareholder\s+loan/i, /\bfunding\b/i, /\bdividend\b/i,
              /liquidity\s+reserve/i, /capital\s+reserve/i, /treasury\s+reserve/i],
  revenue: [/\brevenue\b/i, /\bsales\b/i, /\bpenjualan\b/i, /wash\s+revenue/i,
            /advertising\s+slot/i, /co-?branding/i, /partner\s+settlement/i,
            /xendit\s+settlement/i, /\bsettlement\b/i, /\bincome\b/i,
            /(client|customer)\s+payment/i, /payment\s+(from|by)\s+(client|customer)/i,
            /pembayaran\s+(dari\s+)?(klien|pelanggan)/i, /pelunasan\s+piutang/i,
            /client\s+(fee|retainer|project|contract)/i, /customer\s+(invoice|fee|billing)/i],
  direct_cost: [/refill/i, /liquid\s+supplies/i, /\bsupplies\b/i, /\bmaintenance\b/i,
                /\belectricity\b/i, /\blistrik\b/i, /\blogistics\b/i, /\bcogs\b/i,
                /direct\s+cost/i, /\bconsumables?\b/i],
  operating_expense: [/\brent\b/i, /\bsewa\b/i, /\bsalary\b/i, /\bpayroll\b/i, /\bgaji\b/i,
                      /\bmarketing\b/i, /\bsoftware\b/i, /subscription/i, /\bbank\b.*\bfee\b/i,
                      /admin\s+fee/i, /\butilit(y|ies)\b/i, /\binsurance\b/i, /\boffice\b/i,
                      /(vendor|supplier)\s+invoice/i, /invoice\s+(pembelian|vendor|supplier)/i,
                      /pembayaran\s+(ke\s+|kepada\s+)?(vendor|supplier)/i, /tagihan\s+vendor/i],
};
const NOT_CAPEX = [/maintenance/i, /\brepair/i, /\bservicing\b/i, /\brental\b/i, /\brent\b/i];

// A person's confirmed P&L group outranks keywords (it is evidence, they are guesses). It applies only when the
// money's direction fits the group: an expense in a revenue category is a refund and is left to the rules below.
const GROUP_CLASS = {
  revenue: { class: 'revenue', types: ['income'] },
  other_income: { class: 'other', types: ['income'] },
  direct_cost: { class: 'direct_cost', types: ['expense', 'payroll'] },
  operating_cost: { class: 'operating_expense', types: ['expense', 'payroll'] },
  interest: { class: 'interest', types: ['expense', 'income'] },
  tax: { class: 'tax', types: ['expense'] },
  asset_purchase: { class: 'capex', types: ['expense'] },
  funding: { class: 'financing', types: ['income', 'expense'] },
  transfer: { class: 'transfer', types: ['income', 'expense'] },
};

const hay = (tx) => `${(tx && tx.category) || ''} ${(tx && tx.description) || ''} ${(tx && tx.notes) || ''}`.trim();
const hit = (list, s) => list.some((re) => re.test(s));

/**
 * Classify one transaction.
 * @returns { class, matched_on, needs_review }
 */
/**
 * @param evidence optional { fundingTx: Map<transaction id, null | principal> from the funding register — null for
 *   money received (any amount), the principal for a repayment (a debit above it also carries interest and is left to
 *   the rules below); categoryOf(tx) → { pnl_group } | null for this company's confirmed groups }
 */
// What words alone suggest, in the order the keyword rules have always used (narrow claims before the general
// buckets). null when no rule matches. Used on the category a person chose, then on the bank's description.
function wordsClass(s, type) {
  if (!s) return null;
  if (hit(RE.balance_correction, s)) return 'balance_correction';
  if (hit(RE.opening_balance, s)) return 'opening_balance';
  if (hit(RE.transfer, s)) return 'transfer';
  if (hit(RE.capex, s) && !hit(NOT_CAPEX, s)) return 'capex';
  if (hit(RE.tax, s)) return 'tax';
  if (hit(RE.interest, s)) return 'interest';
  if (hit(RE.financing, s)) return 'financing';
  // Money direction is a strong signal, so revenue is only claimed for inbound rows.
  if (type === 'income') return hit(RE.revenue, s) ? 'revenue' : null;
  if (type === 'expense') {
    if (hit(RE.direct_cost, s)) return 'direct_cost';
    if (hit(RE.operating_expense, s)) return 'operating_expense';
  }
  return null;
}
// Words never prove these on their own: a real transfer has its transfer record, a real opening balance its anchor.
const WORDS_NEED_REVIEW = ['transfer', 'opening_balance', 'balance_correction'];

// Precedence (AC-0 / I-1, 24 Oct 2026), strongest evidence first:
//   1. facts the ledger records (opening anchor, correction type, transfer record) — never text;
//   2. the funding register; 3. the business purpose a person set; 4. the category's confirmed P&L group;
//   5. the category a person chose (its name), payroll by type;
//   6. the bank description's wording — last, so "TRANSFER OR VIA IB …" on a customer payment can no longer
//      overrule what the person confirmed. Wording-only transfer / opening / correction stays out of revenue and
//      costs, as before, but is marked for review.
function classifyTransaction(tx, evidence = null) {
  const type = (tx && tx.type) || '';
  const src = (tx && tx.source) || '';
  const none = { class: 'unknown', matched_on: 'none', needs_review: true };

  // ── 1. Ledger facts, before the income/expense gate ─────────────────────────
  // A wallet opening balance is written as type='income', so gating on type alone would file it as revenue.
  // D4-A: a moved opening anchor (and its reversal) is an opening balance, not a correction.
  if (/^opening_reanchor(_reversal)?$/.test(src))
    return { class: 'opening_balance', matched_on: 'source', needs_review: false };
  if (type === 'correction')
    return { class: 'balance_correction', matched_on: 'type', needs_review: false };
  if ((tx && tx.is_opening_balance === true) || /wallet_opening_balance/i.test(src))
    return { class: 'opening_balance', matched_on: 'source', needs_review: false };
  if (type === 'transfer' || (tx && tx.transfer_id))
    return { class: 'transfer', matched_on: 'transfer_record', needs_review: false };

  // ── 2–4. Recorded evidence: the funding register, then a purpose, then a confirmed category group.
  const fundingLimit = evidence && evidence.fundingTx && tx && tx.id != null ? evidence.fundingTx.get(String(tx.id)) : undefined;
  if (fundingLimit !== undefined && (fundingLimit === null || amountOf(tx) <= Number(fundingLimit)))
    return { class: 'financing', matched_on: 'funding_register', needs_review: false };
  // A business purpose a person set on the operation (lib/transactionClassifications.js) comes next: personal
  // money paid from a company account is never an operating cost. 'operating' sets no class; the category decides.
  const purpose = evidence && typeof evidence.purposeOf === 'function' ? evidence.purposeOf(tx) : null;
  if (purpose && PURPOSE_CLASS[purpose]) return { class: PURPOSE_CLASS[purpose], matched_on: 'business_purpose', needs_review: purpose === 'needs_review' };
  const confirmed = evidence && typeof evidence.categoryOf === 'function' ? GROUP_CLASS[evidence.categoryOf(tx)?.pnl_group] : null;
  if (confirmed && confirmed.types.includes(type)) return { class: confirmed.class, matched_on: 'confirmed_category_group', needs_review: false };

  // ── 5. What the operation is by its type, then the category a person chose ──
  if (type === 'payroll') return { class: 'operating_expense', matched_on: 'type', needs_review: false };
  const byCategory = wordsClass(String((tx && tx.category) || '').trim(), type);
  if (byCategory) return { class: byCategory, matched_on: 'category', needs_review: false };

  // ── 6. The description's wording, last ─────────────────────────────────────
  const s = hay(tx);
  if (!s) return none;
  const byWords = wordsClass(s, type);
  if (byWords) return { class: byWords, matched_on: 'keyword', needs_review: WORDS_NEED_REVIEW.includes(byWords) };
  // Real money, unclear source. Never silently revenue or cost.
  if (type === 'income') return { class: 'unknown', matched_on: 'income_unmatched', needs_review: true };
  if (type === 'expense') return { class: 'unknown', matched_on: 'expense_unmatched', needs_review: true };
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
    unknown: 0, financing: 0, opening_balance: 0, transfer: 0, balance_correction: 0, other: 0, personal: 0,
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
    balance_correction: 'balance_correction', other: 'other', unknown: 'unknown', personal: 'personal',
  };

  for (const t of rows) {
    const { class: cls, needs_review } = classifyTransaction(t, opts.evidence || null);
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
        personal: b.personal,
        total: b.opening_balance + b.financing + b.transfer + b.balance_correction + b.unknown + b.personal,
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
