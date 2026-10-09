// General tax deadlines (PMK 81/2024) for the advisory tax calendar, nil returns, and the
// "tax printed on a document" checks. No network. Run: node tests/taxDeadlines.test.js
const assert = require('node:assert');
const T = require('../server/lib/taxDeadlines');
const ID = require('../server/lib/documentIdentify');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };

console.log('\ndeadlines — PMK 81/2024 general rule, always advisory');
t('PPh 21 June 2026: pay by 15 July, report by 20 July', () => {
  const d = T.deadlinesFor('ID_PPH21_MONTHLY', '2026-06');
  assert.strictEqual(d.pay_by, '2026-07-15'); assert.strictEqual(d.file_by, '2026-07-20'); assert.strictEqual(d.verified, false);
});
t('PPN February: end of March (month length respected)', () => {
  assert.strictEqual(T.deadlinesFor('ID_PPN_MONTHLY', '2026-02').file_by, '2026-03-31');
  assert.strictEqual(T.deadlinesFor('ID_PPN_MONTHLY', '2026-01').file_by, '2026-02-28');
});
t('December period rolls into the next year', () => {
  assert.strictEqual(T.deadlinesFor('ID_PPH21_MONTHLY', '2026-12').pay_by, '2027-01-15');
});
t('PPh Badan: end of the 4th month after the financial year', () => {
  assert.strictEqual(T.deadlinesFor('ID_PPH_BADAN_ANNUAL', '2025').file_by, '2026-04-30');
});
t('financial year stored as a full date (HCI: 2026-12-22) is read as month-day', () => {
  assert.deepStrictEqual(T.monthDay('2026-12-22', [12, 31]), [12, 22]);
  assert.strictEqual(T.deadlinesFor('ID_PPH_BADAN_ANNUAL', '2025', { financial_year_end: '2026-12-22' }).file_by, '2026-04-30');
});
t('unknown rule or bad period → null', () => {
  assert.strictEqual(T.deadlinesFor('ID_SOMETHING', '2026-06'), null);
  assert.strictEqual(T.deadlinesFor('ID_PPH21_MONTHLY', 'June'), null);
});

console.log('\napplicability');
t('PPN only for a PKP company (pkp_status wins over the older vat_status)', () => {
  assert.strictEqual(T.appliesTo('ID_PPN_MONTHLY', { pkp_status: 'non_pkp', vat_status: 'pkp' }), false);
  assert.strictEqual(T.appliesTo('ID_PPN_MONTHLY', { pkp_status: 'pkp' }), true);
});
t('PPh 21 not for a company without employees', () => {
  assert.strictEqual(T.appliesTo('ID_PPH21_MONTHLY', { employee_status: 'none' }), false);
  assert.strictEqual(T.appliesTo('ID_PPH21_MONTHLY', { employee_status: 'has_employees' }), true);
  assert.strictEqual(T.appliesTo('ID_PPH21_MONTHLY', null), false, 'unknown → asked, not guessed');
  assert.strictEqual(T.appliesTo('ID_PPH_BADAN_ANNUAL', null), true, 'every PT files the annual return');
  assert.strictEqual(T.appliesTo('ID_PPN_MONTHLY', null), false);
});
t('company without a profile (Helm Care Pay): only the annual PT return; employees and PKP are asked, not guessed', () => {
  assert.strictEqual(T.appliesTo('ID_PPH21_MONTHLY', null), false);
  assert.strictEqual(T.appliesTo('ID_PPN_MONTHLY', null), false);
  assert.strictEqual(T.appliesTo('ID_PPH_BADAN_ANNUAL', null), true);
  const rows = T.advisoryCalendar([{ rule_code: 'ID_PPH21_MONTHLY' }, { rule_code: 'ID_PPN_MONTHLY' }, { rule_code: 'ID_PPH_BADAN_ANNUAL' }], null, new Date('2026-10-09T00:00:00Z'));
  assert.deepStrictEqual([...new Set(rows.map((r) => r.rule_code))], ['ID_PPH_BADAN_ANNUAL']);
});
t('advisory calendar: 3 months back to 2 ahead, sorted by due date', () => {
  const rows = T.advisoryCalendar([{ rule_code: 'ID_PPH21_MONTHLY', title: 'PPh 21' }], { employee_status: 'has_employees' }, new Date('2026-10-09T00:00:00Z'));
  assert.deepStrictEqual(rows.map((r) => r.period), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].due_date <= r.due_date));
});

console.log('\nnil returns (dormant periods)');
t('PPh 21: December always filed, other months only when salaries were paid', () => {
  assert.strictEqual(T.nilRule('ID_PPH21_MONTHLY', '2026-12'), 'required');
  assert.strictEqual(T.nilRule('ID_PPH21_MONTHLY', '2026-05'), 'not_required_without_payments');
});
t('PPN and the annual return: a nil return is required', () => {
  assert.strictEqual(T.nilRule('ID_PPN_MONTHLY', '2026-05'), 'required');
  assert.strictEqual(T.nilRule('ID_PPH_BADAN_ANNUAL', '2025'), 'required');
});

console.log('\ntaxes printed on a document');
const SHEET = 'Gaji perbulan\tGaji bulan ini\tPPh 21\n8121827\t8121827\t121827\n52448095\t52448095\t1948095';
t('payroll total found in the cells (tabs and newlines never join two numbers)', () => {
  assert.ok(ID.printedIn(SHEET, 1948095)); assert.ok(ID.printedIn(SHEET, 52448095));
  assert.ok(!ID.printedIn('52448095\t1948095', 524480951948095));
});
t('Indonesian, international and spaced formats', () => {
  assert.ok(ID.printedIn('PPh 21 Rp 1.948.095,00', 1948095));
  assert.ok(ID.printedIn('PPh 21 IDR 1,948,095.00', 1948095));
  assert.ok(ID.printedIn('PPh 21 1 948 095', 1948095));
  assert.ok(!ID.printedIn('total 1948096', 1948095));
});
const X = ID.normalize({ period: '2026-06', taxes: [
  { tax: 'pph21', role: 'company_pays', amount: '1948095', period: '2026-06', what: 'w' },
  { tax: 'pph21', role: 'company_pays', amount: '2000000', period: '2026-07' },
  { tax: 'pph23', role: 'company_withholds', amount: '', period: '2026-06' },
  { tax: 'ppn', role: 'creditable', amount: '1100000', period: '2026-06' },
  { tax: 'vat_magic', role: 'pay_now', amount: 'abc' },
] }, ['payroll_document']);
const F = ID.taxFindings(X, { text: SHEET, read: 'sheet_cells' });
t('a printed amount is kept and marked printed; PPh 21 goes to the calendar rule', () => {
  assert.strictEqual(F[0].amount, 1948095); assert.strictEqual(F[0].amount_source, 'printed');
  assert.strictEqual(F[0].rule_code, 'ID_PPH21_MONTHLY'); assert.strictEqual(F[0].amount_to_obligation, true);
});
t('an amount NOT in the text is dropped (the model may read, never compute)', () => {
  assert.strictEqual(F[1].amount, null); assert.strictEqual(F[1].amount_source, 'not_found_in_text');
});
t('PPh 23 has no calendar rule; PPN links but never sets the month amount', () => {
  assert.strictEqual(F[2].rule_code, null);
  assert.strictEqual(F[3].rule_code, 'ID_PPN_MONTHLY'); assert.strictEqual(F[3].amount_to_obligation, false);
});
t('unknown tax / role are normalised, not trusted', () => {
  assert.strictEqual(F[4].tax, 'other'); assert.strictEqual(F[4].role, 'info'); assert.strictEqual(F[4].amount, null);
});
t('a scan has no text to check: the amount is kept but marked as read from the image', () => {
  const s = ID.taxFindings(X, { text: '', read: 'file_to_model' });
  assert.strictEqual(s[0].amount, 1948095); assert.strictEqual(s[0].amount_source, 'read_from_image');
});

console.log('\nserver wiring');
const fs = require('node:fs');
const server = fs.readFileSync(require('node:path').join(__dirname, '..', 'server', 'index.js'), 'utf8');
const body = (route) => { const i = server.indexOf(route); assert.ok(i > 0, route); return server.slice(i, server.indexOf('\napp.', i + 10)); };
t('tax-obligation: role-checked, amount from the stored reading (not the client), confirmed / paid kept, linked, no money', () => {
  const b = body("app.post('/api/documents/:id/tax-obligation'");
  for (const x of ['canManageDocuments', 'canViewBusinessFinance', 'hasDocumentsAccess', 'loadDocumentScoped', 'ai_identify', 'CONFIRMED_AMOUNT', "'paid'", "linkDocument(biz, doc, 'compliance'", 'source_verification_required: true'])
    assert.ok(b.includes(x), x);
  assert.ok(!/req\.body[^\n]*amount/.test(b), 'amount must not come from the request');
  assert.ok(!/from\('transactions'\)|from\('debts'\)/.test(b), 'no money records touched');
});
t('tax-calendar is read-only', () => {
  const b = body("app.get('/api/accountant/tax-calendar'");
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(b));
  assert.ok(b.includes('nil_return') && b.includes('nil_rule') && b.includes('verified'));
});
t('calendar regeneration no longer resets an amount someone recorded', () => {
  assert.ok(server.includes('toUpsert.map(({ amount_status, ...g })'));
});

console.log(`\nTAX DEADLINES: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
