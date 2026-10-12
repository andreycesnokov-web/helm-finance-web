'use strict';

const STATUS = Object.freeze({
  insufficient_balance: 409, wallet_balance_negative: 409,
  transaction_version_conflict: 409, business_change_forbidden: 400,
  currency_mismatch: 400, invalid_amount: 400, invalid_amount_precision: 400, wallet_not_found: 404,
  idempotency_key_mismatch: 409,
  idempotency_key_required: 400,
  financial_intent_invalidated: 409,
  legacy_receipt_requires_review: 409,
  legacy_transfer_requires_review: 409,
  invalid_financial_intent: 400,
  debt_metadata_locked: 409,
  transaction_not_found: 404, business_write_forbidden: 403,
  opening_balance_cannot_be_modified: 400, debt_payment_amount_immutable: 400,
  payroll_financial_fields_immutable: 400, transfer_financial_fields_immutable: 400,
  statement_financial_fields_immutable: 400, invalid_transaction_patch: 400,
  invalid_import_provenance: 400, invalid_opening_balance: 400, ledger_isolation_unsupported: 503,
  transfer_already_recorded: 409,
  wallet_name_ambiguous: 409, wallet_legacy_name_locked: 409,
  wallet_metadata_locked: 409, wallet_legacy_binding_requires_review: 409,
  wallet_scope_mismatch: 400, wallet_inactive: 409,
});

// PostgreSQL cancels the entire failed statement/RPC transaction for these SQLSTATEs.
// A transport error has an UNKNOWN outcome: do not assert rollback or auto-retry it.
function databaseFailureBody(error) {
  if (['ECONNRESET','ECONNREFUSED','ETIMEDOUT','PGRST000','PGRST001','PGRST002'].includes(error?.code)
      || /fetch failed|Failed to fetch|Network request failed/i.test(String(error?.message || ''))) {
    return { status: 503, body: { error: 'financial_outcome_unknown', code: 'financial_outcome_unknown',
      message: 'The result could not be confirmed. Refresh the payment or import status before resubmitting; keep the original request key.',
      outcome: 'unknown', automatic_retry: false } };
  }
  const codes = { '40P01': 'financial_conflict', '55P03': 'financial_lock_timeout', '57014': 'financial_request_cancelled', '40001': 'financial_conflict' };
  if (!codes[error?.code]) return null;
  return { status: 409, body: { error: codes[error.code], code: codes[error.code],
    message: 'The operation was cancelled by the database. Refresh the data before trying again.',
    outcome: 'rolled_back', outcome_scope: 'failed_database_transaction', automatic_retry: false } };
}

function balanceFailure(res, error) {
  const conflict = databaseFailureBody(error);
  if (conflict) { res.status(conflict.status).json(conflict.body); return true; }
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
module.exports = { balanceFailure, databaseFailureBody, nativeInputIsExact, STATUS };
