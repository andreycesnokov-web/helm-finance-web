// Remaining balance with withholdings (DECISIONS.md "Final decisions", item 5; batch 10).
//
// A withholding (e.g. PPh 23 a customer deducts from our invoice, or one we deduct from a
// supplier) is recorded as a withholding_record (migration 031) and allocated to the bill
// through debt_settlement_allocations with settlement_source_type = 'withholding_record'.
//
//   remaining = amount − paid_amount − Σ allocations of type 'withholding_record'
//
// `transaction` allocations are NOT subtracted: they are an audit trail of money already in
// paid_amount (see PROPOSALS F-01). Migration 031 is not changed.
//
// This is shared Business logic (computeDebtStatus, /api/debts/:id/pay): not behind the v2
// flag. A bill with no withholding is calculated exactly as before (tests/debtWithholding.test.js).
'use strict';

// Exact text from DECISIONS.md, final decisions item 5.
const GUARD_MESSAGE = 'This invoice already has payment records in the settlement log; record the withholding with the accountant.';
const WAITING = 'waiting_slip';
const SLIP_RECEIVED = 'slip_received';
const TAX_TYPES = ['pph_23', 'pph_4_2', 'pph_21', 'pph_26', 'pph_22', 'other'];
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo', 'accountant'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const canRecordWithholding = (role) => EDIT_ROLES.includes(role);

/**
 * Status and amounts for one bill — the body of computeDebtStatus.
 * `debt.withholding_allocated` (attached by attachWithholdings) is 0/absent for a bill with
 * no withholding, which reproduces the previous formula exactly.
 */
function debtStatusOf(debt, now = new Date()) {
  const effectiveAmount = Number(debt.original_amount || debt.amount || 0);
  const paidAmount      = Number(debt.paid_amount     || 0);
  const withheld        = Math.max(0, num(debt.withholding_allocated));
  const remaining       = Math.max(0, effectiveAmount - paidAmount - withheld);
  const dueDate         = debt.due_date ? new Date(debt.due_date) : null;
  const daysOverdue     = dueDate ? Math.floor((now - dueDate) / 86400000) : 0;

  let status;
  if (debt.status === 'cancelled')                    status = 'cancelled';
  else if (debt.is_settled || remaining <= 0)         status = 'paid';
  else if (paidAmount > 0 || withheld > 0)            status = 'partial';
  else if (dueDate && now > dueDate)                  status = 'overdue';
  else                                                status = 'open';

  const out = {
    ...debt,
    original_amount: effectiveAmount,
    paid_amount:     paidAmount,
    remaining_amount: remaining,
    status,
    days_overdue: status === 'overdue' ? daysOverdue : 0,
  };
  if (withheld > 0) {
    out.withholding_allocated = withheld;
    // "Waiting for the customer's tax slip" — from withholding_records.status. Never overdue.
    out.withholding_waiting_slip = !!debt.withholding_waiting_slip;
  }
  return out;
}

/** remaining = amount − paid − withholding allocations (used by /api/debts/:id/pay too). */
function remainingOf(debt) {
  return Math.max(0, Number(debt.original_amount || debt.amount || 0) - Number(debt.paid_amount || 0) - Math.max(0, num(debt.withholding_allocated)));
}

/**
 * allocations (debt_settlement_allocations, any type) + their withholding_records →
 * { [debt_id]: { amount, waiting_slip } }. Only 'withholding_record' allocations count.
 */
function withholdingByDebt(allocations = [], records = []) {
  const recById = Object.fromEntries((records || []).map((r) => [String(r.id), r]));
  const out = {};
  for (const a of allocations || []) {
    if (!a || a.settlement_source_type !== 'withholding_record' || a.debt_id == null) continue;
    const k = String(a.debt_id);
    const e = (out[k] ||= { amount: 0, waiting_slip: false });
    e.amount += num(a.allocated_amount);
    const r = recById[String(a.withholding_record_id)];
    if (r && !r.bukti_potong_document_id) e.waiting_slip = true;
  }
  return out;
}

/** Copy the per-debt withholding onto the rows (before computeDebtStatus). */
function attachWithholdings(debts = [], byDebt = {}) {
  return (debts || []).map((d) => {
    const w = d && byDebt[String(d.id)];
    return w ? { ...d, withholding_allocated: w.amount, withholding_waiting_slip: w.waiting_slip } : d;
  });
}

/** Validate POST /api/debts/:id/withholding. */
function withholdingFromBody(b = {}, debt = {}) {
  const amount = typeof b.amount === 'number' || (typeof b.amount === 'string' && /^\s*\d+(\.\d{1,2})?\s*$/.test(b.amount)) ? Number(b.amount) : NaN;
  if (!(amount > 0)) return { error: 'invalid_amount' };
  const taxType = b.tax_type == null || b.tax_type === '' ? 'pph_23' : b.tax_type;
  if (!TAX_TYPES.includes(taxType)) return { error: 'invalid_tax_type', allowed: TAX_TYPES };
  let slip = null;
  if (b.bukti_potong_document_id != null && b.bukti_potong_document_id !== '') {
    if (typeof b.bukti_potong_document_id !== 'string' || !UUID_RE.test(b.bukti_potong_document_id)) return { error: 'invalid_bukti_potong_document_id' };
    slip = b.bukti_potong_document_id;
  }
  if (!debt || !['receivable', 'payable'].includes(debt.type)) return { error: 'not_a_bill_or_invoice' };
  if (debt.status === 'cancelled' || ['pending_approval', 'rejected'].includes(debt.approval_status)) return { error: 'debt_not_open' };
  const rem = remainingOf(debt);
  if (amount > rem + 0.005) return { error: 'exceeds_remaining', remaining: rem };
  return { amount: Math.round(amount * 100) / 100, taxType, slip, status: slip ? SLIP_RECEIVED : WAITING };
}

/** The 031 guard's rejection (fn_debt_settlement_guard raises 'over-allocation: …'). */
const isGuardRejection = (err) => /over-allocation/i.test(String(err?.message || ''));

module.exports = {
  GUARD_MESSAGE, WAITING, SLIP_RECEIVED, TAX_TYPES, EDIT_ROLES,
  canRecordWithholding, debtStatusOf, remainingOf, withholdingByDebt, attachWithholdings, withholdingFromBody, isGuardRejection,
};
