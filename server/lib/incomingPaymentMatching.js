// Incoming payment → match candidate scoring (pure, deterministic, unit-tested; no I/O).
//
// Proposes which receivable or ledger transaction a receipt might correspond to. Everything
// here is a SUGGESTION with a stated reason. Per D6 the engine computes and explains; a human
// decides. Nothing in this module accepts a match, books revenue, settles a debt, or touches
// a transaction — it returns scored proposals and nothing else.
//
// Deterministic only: no AI, no fuzzy learning, no hidden weights. A reviewer must be able to
// read `reasons` and see exactly why a candidate was offered.
//
// Targets are receivables (`debts.type='receivable'`) and `transactions`. There is no invoice
// target: `invoices` is unapplied in production and the engine must not depend on it.

// Weights sum to 1.0. Amount dominates because it is the only near-objective signal; a name
// or reference agreeing is corroboration, not proof.
const WEIGHTS = { amount: 0.5, date: 0.2, reference: 0.2, currency: 0.1 };

// Below this a proposal is noise and is not offered at all. A reviewer shown twenty weak
// candidates stops reading them.
const MIN_SCORE = 0.35;
const MAX_CANDIDATES = 10;

// A payment may legitimately differ from the amount owed (partial payment, gateway fee,
// rounding), so amount similarity is graded rather than exact-or-nothing.
const AMOUNT_EXACT_TOLERANCE = 0.005;   // half a cent — floats never enter this comparison
const DATE_FULL_MATCH_DAYS = 1;
const DATE_MAX_DAYS = 30;

const toCents = (n) => Math.round(Number(n) * 100);
const isNum = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));

function normalizeText(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Amount score.
 *
 * A receipt is compared against BOTH the gross and the net, because which one corresponds to
 * the amount owed depends on who absorbs the gateway fee — and we do not know that yet.
 * The better of the two wins, and the reason records which matched.
 */
function scoreAmount(payment, targetAmount) {
  // `comparable` distinguishes "the amounts disagree" from "there was no amount to compare".
  // The first is disqualifying; the second is merely uninformative.
  if (!isNum(targetAmount)) return { score: 0, reason: null, comparable: false };
  const target = toCents(targetAmount);
  if (target <= 0) return { score: 0, reason: null, comparable: false };

  const options = [
    { label: 'gross', cents: isNum(payment.gross_amount) ? toCents(payment.gross_amount) : null },
    { label: 'net', cents: isNum(payment.net_amount) ? toCents(payment.net_amount) : null },
  ].filter((o) => o.cents !== null);
  if (!options.length) return { score: 0, reason: null, comparable: false };

  let best = { score: 0, reason: null, comparable: true };
  for (const o of options) {
    const diff = Math.abs(o.cents - target);
    let score = 0;
    if (diff <= toCents(AMOUNT_EXACT_TOLERANCE)) score = 1;
    else {
      // Relative difference, so a 1,000 rupiah gap matters more on a small receipt.
      const rel = diff / target;
      if (rel <= 0.01) score = 0.9;
      else if (rel <= 0.05) score = 0.7;
      else if (rel <= 0.15) score = 0.4;
      else score = 0;
    }
    if (score > best.score) {
      best = { score, comparable: true, reason: score === 1
        ? { key: 'amount_exact', detail: `${o.label} amount matches exactly` }
        : { key: 'amount_close', detail: `${o.label} amount within ${(diff / target * 100).toFixed(1)}%` } };
    }
  }
  return best;
}

/** Date proximity. Money usually arrives near the date it is owed, but not always. */
function scoreDate(paymentDate, targetDate) {
  if (!paymentDate || !targetDate) return { score: 0, reason: null };
  const a = new Date(paymentDate), b = new Date(targetDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return { score: 0, reason: null };
  const days = Math.abs(a - b) / 86400000;
  if (days <= DATE_FULL_MATCH_DAYS) return { score: 1, reason: { key: 'date_same', detail: 'within a day' } };
  if (days > DATE_MAX_DAYS) return { score: 0, reason: null };
  const score = Math.max(0, 1 - (days - DATE_FULL_MATCH_DAYS) / (DATE_MAX_DAYS - DATE_FULL_MATCH_DAYS));
  return { score: Math.round(score * 100) / 100, reason: { key: 'date_near', detail: `${Math.round(days)} days apart` } };
}

/**
 * Payer / reference agreement.
 *
 * Exact reference equality is the strongest non-amount signal. Name agreement is weaker and
 * requires a whole-token match — substring matching would make "PT Maju" match "PT Maju Jaya
 * Abadi", which are different customers.
 */
function scoreReference(payment, target) {
  const payRef = normalizeText(payment.payer_reference);
  const tgtRef = normalizeText(target.reference);
  if (payRef && tgtRef && payRef === tgtRef) {
    return { score: 1, reason: { key: 'reference_exact', detail: 'reference matches' } };
  }

  const payName = normalizeText(payment.payer_name);
  const tgtName = normalizeText(target.counterparty);
  if (payName && tgtName) {
    if (payName === tgtName) return { score: 1, reason: { key: 'payer_exact', detail: 'payer name matches' } };
    const payTokens = new Set(payName.split(' ').filter((t) => t.length > 2));
    const tgtTokens = tgtName.split(' ').filter((t) => t.length > 2);
    if (tgtTokens.length && payTokens.size) {
      const hits = tgtTokens.filter((t) => payTokens.has(t)).length;
      const ratio = hits / tgtTokens.length;
      if (ratio >= 0.5) {
        return { score: Math.round(ratio * 100) / 100,
                 reason: { key: 'payer_partial', detail: `payer name overlaps (${hits}/${tgtTokens.length} words)` } };
      }
    }
  }

  // A description mentioning the counterparty is weak corroboration, never a match on its own.
  const desc = normalizeText(payment.description);
  if (desc && tgtName && tgtName.length > 3 && desc.includes(tgtName)) {
    return { score: 0.5, reason: { key: 'description_mentions', detail: 'description mentions the counterparty' } };
  }
  return { score: 0, reason: null };
}

function scoreCurrency(payment, target) {
  if (!payment.currency || !target.currency) return { score: 0.5, reason: null };  // unknown: neutral
  if (String(payment.currency).toUpperCase() === String(target.currency).toUpperCase()) {
    return { score: 1, reason: null };                                             // expected, not noteworthy
  }
  return { score: 0, reason: { key: 'currency_differs', detail: 'currency does not match' } };
}

/**
 * Normalise a receivable into the shape the scorer compares against.
 *
 * Column names are the REAL `debts` columns (see migrations 006/015 and the insert at
 * server/index.js). `remaining_amount` is what is still owed and is the right comparison
 * target: matching a partial payment against the original amount would score it as a
 * mismatch. `debts` has no `reference` column, so `notes` is the only free-text field a
 * payer reference could agree with.
 */
function receivableTarget(debt) {
  const outstanding = isNum(debt.remaining_amount) ? debt.remaining_amount
    : (isNum(debt.amount) ? debt.amount : debt.original_amount);
  return {
    type: 'debt', id: debt.id, business_id: debt.business_id,
    amount: outstanding,
    date: debt.due_date || debt.created_at || null,
    counterparty: debt.counterparty || null,
    reference: debt.notes || null,
    currency: debt.currency || null,
  };
}

/**
 * Normalise a ledger transaction into the same shape.
 *
 * `transactions` has no reference column at all, so reference agreement can never fire for a
 * transaction target — only payer-name and description agreement can. Stating that here
 * rather than reading a column that does not exist, which would silently evaluate to
 * undefined and look like a working comparison.
 */
function transactionTarget(tx) {
  return {
    type: 'transaction', id: tx.id, business_id: tx.business_id,
    amount: isNum(tx.amount_idr) ? tx.amount_idr : tx.amount_original,
    date: tx.transaction_date || tx.created_at || null,
    counterparty: tx.counterparty_name || null,
    reference: null,
    currency: tx.currency_original || null,
  };
}

/**
 * Score one payment against one normalised target.
 * Returns { score, reasons } — score 0..1, reasons an explainable list.
 */
function scoreTarget(payment, target) {
  const amount = scoreAmount(payment, target.amount);
  const date = scoreDate(payment.transaction_at || payment.settled_at, target.date);
  const reference = scoreReference(payment, target);
  const currency = scoreCurrency(payment, target);

  // A currency mismatch is disqualifying, not a small deduction: money in one currency is not
  // payment of a debt in another.
  if (currency.score === 0 && currency.reason) return { score: 0, reasons: [currency.reason] };

  // So is an amount that simply does not correspond. Amount is the only near-objective signal
  // here; when it is comparable and disagrees outright, a matching name and date are
  // coincidence, not evidence — proposing on them would offer a 1,000,000 receipt as payment
  // of a 17 receivable because the customer's name lined up.
  if (amount.comparable && amount.score === 0) {
    return { score: 0, reasons: [{ key: 'amount_mismatch', detail: 'amount does not correspond' }] };
  }

  const score = amount.score * WEIGHTS.amount
    + date.score * WEIGHTS.date
    + reference.score * WEIGHTS.reference
    + currency.score * WEIGHTS.currency;

  const reasons = [amount.reason, date.reason, reference.reason, currency.reason].filter(Boolean);
  return { score: Math.round(score * 10000) / 10000, reasons };
}

/**
 * Build candidate proposals for one payment.
 *
 * @param payment      an incoming_payments row
 * @param candidates   { debts: [...], transactions: [...] }
 * @returns array of { target_type, target_debt_id?, target_transaction_id?, score, match_reasons }
 *          sorted best-first, capped, and filtered to MIN_SCORE.
 */
function buildCandidates(payment, { debts = [], transactions = [] } = {}) {
  if (!payment || !payment.business_id) return [];
  const out = [];

  const consider = (target) => {
    // Tenancy is re-checked here even though the caller queries by business: a matching engine
    // that trusts its input is one bad query away from attributing one company's money to
    // another company's receivable.
    if (!target.id || target.business_id !== payment.business_id) return;
    const { score, reasons } = scoreTarget(payment, target);
    if (score < MIN_SCORE) return;
    out.push({
      target_type: target.type,
      ...(target.type === 'debt' ? { target_debt_id: target.id } : { target_transaction_id: target.id }),
      score,
      match_reasons: reasons,
    });
  };

  for (const d of debts) {
    // Receivables only: a payable is money we owe, and incoming money never settles one here.
    if (d.type !== 'receivable') continue;
    if (d.status === 'paid' || d.is_settled === true) continue;
    consider(receivableTarget(d));
  }
  for (const t of transactions) {
    // Only cash-in rows can correspond to money arriving.
    if (t.type !== 'income') continue;
    consider(transactionTarget(t));
  }

  return out.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

module.exports = {
  WEIGHTS, MIN_SCORE, MAX_CANDIDATES,
  scoreAmount, scoreDate, scoreReference, scoreTarget,
  receivableTarget, transactionTarget, buildCandidates,
};
