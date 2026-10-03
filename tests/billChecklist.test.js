// Bill checklist (Design v2 P-05, option B). Pure validation and shaping.
// Run: node tests/billChecklist.test.js
const assert = require('node:assert');
const C = require('../server/lib/billChecklist');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nBill checklist');

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

t('option B: the slip cannot be written through the checklist', () => {
  assert.strictEqual(C.checklistPatchFromBody({ withholding_slip_document_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { userId: 1 }).error, 'no_checklist_fields');
  assert.ok(!C.COLUMNS.includes('withholding_slip_document_id'));
});

t('a non-boolean check flag and an empty body are rejected', () => {
  assert.strictEqual(C.checklistPatchFromBody({ accountant_checked: 'yes' }, { userId: 1 }).error, 'invalid_accountant_checked');
  assert.strictEqual(C.checklistPatchFromBody({}, { userId: 1 }).error, 'no_checklist_fields');
  assert.strictEqual(C.checklistPatchFromBody({ status: 'paid', approval_status: 'approved' }, { userId: 1 }).error, 'no_checklist_fields', 'cannot be used to settle or approve');
});

t('POST /api/debts body loses the checklist fields, keeps the rest', () => {
  const out = C.withoutChecklistFields({ amount: 5, counterparty: 'X', accountant_checked_at: 'now', accountant_checked_by: 1 });
  assert.deepStrictEqual(out, { amount: 5, counterparty: 'X' });
});

t('slips by debt: from withholding_records, first slip wins, records kept', () => {
  const m = C.slipsByDebt([
    { id: 'w1', debt_id: 7, status: 'suggested', withholding_amount: 10, bukti_potong_document_id: null },
    { id: 'w2', debt_id: 7, status: 'reported', withholding_amount: 5, bukti_potong_document_id: 'doc9' },
    { id: 'w3', debt_id: 8, status: 'suggested', bukti_potong_document_id: null },
    { id: 'w4', debt_id: null, bukti_potong_document_id: 'docX' },
  ]);
  assert.deepStrictEqual(Object.keys(m).sort(), ['7', '8']);
  assert.strictEqual(m['7'].slip_document_id, 'doc9');
  assert.strictEqual(m['7'].records.length, 2);
  assert.strictEqual(m['8'].slip_document_id, null);
  assert.deepStrictEqual(C.slipsByDebt(null), {});
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
