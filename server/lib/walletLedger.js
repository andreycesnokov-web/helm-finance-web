'use strict';
// Wallet ledger: one balance formula for every place that shows or checks a balance,
// all rows fetched (PostgREST caps a select at max_rows = 1000), and the rule that a
// manual outflow may not take a money account below zero.
//
// The rule covers what a person records by hand — paying a bill, an expense, a transfer
// out. A bank statement import is the bank's own record and is never blocked: if it
// would show a negative balance, the ledger is missing earlier rows, which is exactly
// what the user needs to see.

const TX = require('./transactionClass');

const PAGE = 1000;

// Accounts that may legitimately run below zero (credit lines, cards). None of the
// business wallet types are like that today; the list is the single switch.
const MAY_GO_NEGATIVE = Object.freeze(['card', 'credit_card', 'credit_line', 'overdraft']);

/** Every row of a query, page by page. `build()` must return a fresh query each call. */
async function fetchAllRows(build) {
  const first = build();
  if (typeof first.range !== 'function') {        // in-memory test doubles have no paging
    const { data, error } = await first;
    if (error) throw error;
    return data || [];
  }
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const q = from === 0 ? first : build();
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const belongsTo = (t, w) => t.wallet_id === w.id || (!t.wallet_id && t.source === w.name);

/** Signed amount a transaction moves on its wallet (wallet currency). */
function signedAmount(t) {
  const amt = Number(t.amount_original ?? t.amount_idr ?? 0);
  if (TX.CASH_IN_LEGACY.includes(t.type))  return amt;
  if (TX.CASH_OUT_LEGACY.includes(t.type)) return -amt;
  if (t.type === 'correction')             return amt;   // signed delta
  return 0;
}

function ledgerBalance(txs, wallet) {
  return (txs || []).filter((t) => belongsTo(t, wallet)).reduce((s, t) => s + signedAmount(t), 0);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * null when the outflow is allowed, otherwise the refusal body.
 * `balance` is the wallet's ledger balance before the outflow, in wallet currency.
 */
function outflowRefusal({ wallet, balance, amount }) {
  if (!wallet || MAY_GO_NEGATIVE.includes(String(wallet.type || '').toLowerCase())) return null;
  const amt = Number(amount);
  if (!(amt > 0)) return null;
  const before = round2(Number(balance) || 0);
  const after = round2(before - amt);
  if (after >= 0) return null;
  return {
    error: before < 0 ? 'wallet_balance_negative' : 'insufficient_balance',
    message: before < 0
      ? `${wallet.name} already shows a negative balance (${before}). Records are missing — import the bank statement or add the missing income first.`
      : `${wallet.name} has ${before}; a payment of ${amt} would take it to ${after}. Choose another account or record the incoming money first.`,
    wallet_id: wallet.id,
    wallet_name: wallet.name,
    currency: wallet.currency || null,
    balance: before,
    amount: amt,
    balance_after: after,
    shortfall: round2(-after),
  };
}

module.exports = { PAGE, MAY_GO_NEGATIVE, fetchAllRows, belongsTo, signedAmount, ledgerBalance, outflowRefusal };
