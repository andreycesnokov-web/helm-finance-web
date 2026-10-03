// Bill document checklist (Design v2 P-05). Pure validation and shaping.
// Run: node tests/billChecklist.test.js
const assert = require('node:assert');
const C = require('../server/lib/billChecklist');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nBill checklist');
const BIZ = '11111111-1111-4111-8111-111111111111';
const DOC = 'aaaaaaaa-0000-4000-8000-0000000000d1';

t('accountant role and above may edit; manager / employee / auditor may not', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo', 'accountant']) assert.ok(C.canEditChecklist(r), r);
  for (const r of ['manager', 'employee', 'auditor', null]) assert.ok(!C.canEditChecklist(r), String(r));
});

t('mark checked stores who and when; unmark clears both', () => {
  const now = new Date('2026-10-03T08:00:00Z');
  assert.deepStrictEqual(C.checklistPatchFromBody({ accountant_checked: true }, { userId: 77, now }).patch,
    { accountant_checked_at: '2026-10-03T08:00:00.000Z', accountant_checked_by: 77 });
  assert.deepStrictEqual(C.checklistPatchFromBody({ accountant_checked: false }, { userId: 77 }).patch,
    { accountant_checked_at: null, accountant_checked_by: null });
});

t('who is always the authenticated actor, never the body', () => {
  const p = C.checklistPatchFromBody({ accountant_checked: true, accountant_checked_by: 1, accountant_checked_at: '2020-01-01' }, { userId: 77 }).patch;
  assert.strictEqual(p.accountant_checked_by, 77);
  assert.notStrictEqual(p.accountant_checked_at, '2020-01-01');
  assert.strictEqual(C.checklistPatchFromBody({ accountant_checked: true }, {}).error, 'actor_required');
});

t('slip id must be a uuid; null clears; caller is told to verify it', () => {
  const r = C.checklistPatchFromBody({ withholding_slip_document_id: DOC }, { userId: 1 });
  assert.deepStrictEqual([r.patch, r.slipId], [{ withholding_slip_document_id: DOC }, DOC]);
  const c = C.checklistPatchFromBody({ withholding_slip_document_id: null }, { userId: 1 });
  assert.deepStrictEqual([c.patch, c.slipId], [{ withholding_slip_document_id: null }, null]);
  for (const bad of ['x', 123, "'; drop table debts; --", {}]) assert.strictEqual(C.checklistPatchFromBody({ withholding_slip_document_id: bad }).error, 'invalid_withholding_slip_document_id');
});

t('a non-boolean check flag and an empty body are rejected', () => {
  assert.strictEqual(C.checklistPatchFromBody({ accountant_checked: 'yes' }, { userId: 1 }).error, 'invalid_accountant_checked');
  assert.strictEqual(C.checklistPatchFromBody({}, { userId: 1 }).error, 'no_checklist_fields');
  assert.strictEqual(C.checklistPatchFromBody({ status: 'paid', approval_status: 'approved' }, { userId: 1 }).error, 'no_checklist_fields', 'cannot be used to settle or approve');
});

t('slip document: same business, not archived, a bukti potong', () => {
  assert.strictEqual(C.slipProblem({ business_id: BIZ, document_type: 'bukti_potong' }, BIZ), null);
  assert.strictEqual(C.slipProblem({ business_id: 'other', document_type: 'bukti_potong' }, BIZ), 'document_not_found_in_this_business');
  assert.strictEqual(C.slipProblem(null, BIZ), 'document_not_found_in_this_business');
  assert.strictEqual(C.slipProblem({ business_id: BIZ, document_type: 'bukti_potong', archived_at: '2026-01-01' }, BIZ), 'document_archived');
  assert.strictEqual(C.slipProblem({ business_id: BIZ, document_type: 'vendor_invoice' }, BIZ), 'document_is_not_a_withholding_slip');
});

t('POST /api/debts body loses the checklist fields, keeps the rest', () => {
  const out = C.withoutChecklistFields({ amount: 5, counterparty: 'X', withholding_slip_document_id: DOC, accountant_checked_at: 'now', accountant_checked_by: 1 });
  assert.deepStrictEqual(out, { amount: 5, counterparty: 'X' });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
