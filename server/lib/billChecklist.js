// Bill document checklist (Design v2 P-05; migration 061).
//
// Two marks a person sets on a bill:
//   withholding_slip_document_id  the bukti potong, a financial_documents row of the SAME
//                                 business (also enforced by a trigger in 061)
//   accountant_checked_at / _by   "an accountant has checked this bill"
//
// "Nothing closes on its own": setting either never pays, settles, approves or files
// anything. Pure — validation and shaping only. Tested in tests/billChecklist.test.js.
'use strict';

const COLUMNS = ['withholding_slip_document_id', 'accountant_checked_at', 'accountant_checked_by'];
// The accountant role and above. Manager / employee / auditor cannot mark a bill checked.
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo', 'accountant'];
// Document types that can be a withholding slip.
const SLIP_TYPES = ['bukti_potong'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const canEditChecklist = (role) => EDIT_ROLES.includes(role);

/**
 * Validate a PATCH body: { withholding_slip_document_id?: uuid|null, accountant_checked?: boolean }.
 * @returns {{ patch: object, slipId?: string|null, error?: string }}
 *   slipId is set when the caller must verify that document belongs to the business.
 */
function checklistPatchFromBody(b = {}, { userId, now = new Date() } = {}) {
  const patch = {};
  let slipId;
  if (b.withholding_slip_document_id !== undefined) {
    const v = b.withholding_slip_document_id;
    if (v === null || v === '') { patch.withholding_slip_document_id = null; slipId = null; }
    else if (typeof v === 'string' && UUID_RE.test(v)) { patch.withholding_slip_document_id = v; slipId = v; }
    else return { patch: {}, error: 'invalid_withholding_slip_document_id' };
  }
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
  return { patch, slipId };
}

/** A slip document is acceptable when it is this business's, not archived, and a slip type. */
function slipProblem(doc, businessId) {
  if (!doc || String(doc.business_id) !== String(businessId)) return 'document_not_found_in_this_business';
  if (doc.archived_at) return 'document_archived';
  if (!SLIP_TYPES.includes(doc.document_type)) return 'document_is_not_a_withholding_slip';
  return null;
}

/** Strip the checklist columns from a body that is spread into an insert (POST /api/debts). */
function withoutChecklistFields(body = {}) {
  const out = { ...(body || {}) };
  for (const k of COLUMNS) delete out[k];
  return out;
}

module.exports = { COLUMNS, EDIT_ROLES, SLIP_TYPES, canEditChecklist, checklistPatchFromBody, slipProblem, withoutChecklistFields };
