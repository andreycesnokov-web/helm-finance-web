// Bill document checklist (Design v2 P-05; migration 061, option B).
//
// One mark a person sets on a bill: accountant_checked_at / _by — "an accountant has
// checked this bill". The withholding slip is NOT stored on the bill: it lives only in
// withholding_records.bukti_potong_document_id (migration 031) and is read from there
// (slipsByDebt below).
//
// "Nothing closes on its own": setting the mark never pays, settles, approves or files
// anything. Pure — validation and shaping only. Tested in tests/billChecklist.test.js.
'use strict';

const COLUMNS = ['accountant_checked_at', 'accountant_checked_by'];
// The accountant role and above. Manager / employee / auditor cannot mark a bill checked.
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo', 'accountant'];

const canEditChecklist = (role) => EDIT_ROLES.includes(role);

/**
 * Validate a PATCH body: { accountant_checked: boolean }.
 * @returns {{ patch: object, error?: string }}
 */
function checklistPatchFromBody(b = {}, { userId, now = new Date() } = {}) {
  const patch = {};
  if (b.accountant_checked !== undefined) {
    if (typeof b.accountant_checked !== 'boolean') return { patch: {}, error: 'invalid_accountant_checked' };
    if (b.accountant_checked) {
      if (userId == null) return { patch: {}, error: 'actor_required' };
      patch.accountant_checked_at = new Date(now).toISOString();
      patch.accountant_checked_by = userId;
    } else {
      patch.accountant_checked_at = null;
      patch.accountant_checked_by = null;
    }
  }
  if (!Object.keys(patch).length) return { patch: {}, error: 'no_checklist_fields' };
  return { patch };
}

/** Strip the checklist columns from a body that is spread into an insert (POST /api/debts). */
function withoutChecklistFields(body = {}) {
  const out = { ...(body || {}) };
  for (const k of COLUMNS) delete out[k];
  return out;
}

/**
 * withholding_records rows (031) → { [debt_id]: { records, slip_document_id } }.
 * A bill has its slip when any of its records carries a bukti potong.
 */
function slipsByDebt(rows = []) {
  const out = {};
  for (const r of rows || []) {
    if (r == null || r.debt_id == null) continue;
    const k = String(r.debt_id);
    const e = (out[k] ||= { records: [], slip_document_id: null });
    e.records.push({ id: r.id, status: r.status || null, withholding_amount: r.withholding_amount ?? null,
      tax_type: r.tax_type || null, bukti_potong_document_id: r.bukti_potong_document_id || null });
    if (r.bukti_potong_document_id && !e.slip_document_id) e.slip_document_id = r.bukti_potong_document_id;
  }
  return out;
}

module.exports = { COLUMNS, EDIT_ROLES, canEditChecklist, checklistPatchFromBody, withoutChecklistFields, slipsByDebt };
