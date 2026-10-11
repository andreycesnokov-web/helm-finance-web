'use strict';

const STATUS = Object.freeze({
  insufficient_balance: 409, wallet_balance_negative: 409,
  transaction_version_conflict: 409, business_change_forbidden: 400,
  currency_mismatch: 400, invalid_amount: 400, invalid_amount_precision: 400, wallet_not_found: 404,
  idempotency_key_mismatch: 409,
  transaction_not_found: 404, business_write_forbidden: 403,
  opening_balance_cannot_be_modified: 400, debt_payment_amount_immutable: 400,
  payroll_financial_fields_immutable: 400, transfer_financial_fields_immutable: 400,
  statement_financial_fields_immutable: 400, invalid_transaction_patch: 400,
  invalid_import_provenance: 400, invalid_opening_balance: 400, ledger_isolation_unsupported: 503,
  transfer_already_recorded: 409,
});

function balanceFailure(res, error) {
  const message = String(error?.message || '');
  const code = error?.code === '23505' && message.includes('transactions_transfer_leg_unique')
    ? 'transfer_already_recorded' : message.split(':', 1)[0];
  if (!STATUS[code]) return false;
  res.status(STATUS[code]).json({ error: code, message });
  return true;
}
// The existing FX boundary uses Number. Do not silently change a supplied
// decimal string or an integer beyond JS's exact range before reaching SQL.
function nativeInputIsExact(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) return false;
  if (typeof value === 'number') return true;
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d{1,18})?$/.test(value.trim())) return false;
  try { return require('./transactionClass').cmpDec(value.trim(), String(n)) === 0; }
  catch { return false; }
}
module.exports = { balanceFailure, nativeInputIsExact, STATUS };
