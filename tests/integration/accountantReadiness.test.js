// The AI Accountant readiness card must never contradict the Compliance Documents checklist.
//
// Regression origin: the card read a LOCAL checkbox placeholder, so it said
// "Upload NIB and PKP certificate." while the checklist already showed NIB as uploaded.
// These tests pin the readiness summary to the checklist payload as the single source of truth.
//
//   Run: node --test tests/integration/accountantReadiness.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'accountantReadiness.js')).href;
let buildReadiness;
test.before(async () => { ({ buildReadiness } = await import(MOD)); });

// Minimal checklist payload shaped like GET /api/ai-accountant/required-documents.
const item = (type, label, requirement, status) => ({ type, label, requirement, status });
const checklist = (items, extra = {}) => ({ items, truncated: false, jurisdiction: 'id', ...extra });

const ID_BASE = [
  item('npwp', 'NPWP', 'required', 'missing'),
  item('nib', 'NIB', 'required', 'uploaded'),
  item('akta', 'Akta / Deed', 'required', 'uploaded'),
  item('sk_kemenkumham', 'SK Kemenkumham approval', 'required', 'uploaded'),
];

test('NIB uploaded → readiness never says "Upload NIB"', () => {
  const r = buildReadiness(checklist(ID_BASE), { form: { nib: '1234567890' } });
  assert.strictEqual(r.available, true);
  assert.ok(!/Upload[^,.]*\bNIB\b/i.test(r.next), `leaked "Upload NIB": ${r.next}`);
  assert.match(r.next, /Upload NPWP/i, 'the genuinely missing document is still asked for');
  assert.strictEqual(r.missingDocs, 1);
});

test('NIB document uploaded but the NIB number is empty → "enter your NIB number"', () => {
  const r = buildReadiness(checklist(ID_BASE), { form: { npwp: '01.234', nib: '' } });
  assert.match(r.next, /enter your NIB number/i);
  // "Upload …" must not name NIB inside its own clause.
  assert.ok(!/Upload[^,.]*\bNIB\b/i.test(r.next), `must not ask to upload NIB again: ${r.next}`);
});

// A number is only worth asking for when this jurisdiction actually requires the document.
test('an optional NIB with an empty number does NOT ask for the number', () => {
  const items = [item('nib', 'NIB', 'optional', 'uploaded')];
  const r = buildReadiness(checklist(items, { jurisdiction: 'unknown' }), { form: { nib: '' } });
  assert.ok(!/NIB number/i.test(r.next), r.next);
  assert.strictEqual(r.next, 'Request accountant verification.');
});

test('a not_required NIB/NPWP outside Indonesia does NOT ask for the number', () => {
  const items = [
    item('nib', 'NIB', 'not_required', 'uploaded'),
    item('npwp', 'NPWP', 'not_required', 'uploaded'),
  ];
  const r = buildReadiness(checklist(items, { jurisdiction: 'other' }), { form: { nib: '', npwp: '' } });
  assert.ok(!/NIB number|NPWP number/i.test(r.next), r.next);
  assert.strictEqual(r.missingDocs, 0);
});

test('a conditional_required document with an empty number still asks for the number', () => {
  const items = [item('nib', 'NIB', 'conditional_required', 'uploaded')];
  const r = buildReadiness(checklist(items), { form: { nib: '' } });
  assert.match(r.next, /enter your NIB number/i);
});

test('the readiness card and the checklist agree on which documents are missing', () => {
  const items = [...ID_BASE, item('pkp_certificate', 'PKP certificate', 'required', 'missing')];
  const r = buildReadiness(checklist(items), { form: { nib: '1', npwp: '2' } });
  const fromChecklist = items.filter(i => i.status === 'missing').map(i => i.label);
  assert.strictEqual(r.missingDocs, fromChecklist.length);
  for (const label of fromChecklist) assert.ok(r.next.includes(label), `missing ${label} not surfaced`);
  assert.strictEqual(r.source, 'checklist');
});

test('SK Kemenkumham uploaded satisfies only SK — it does not satisfy NPWP/NIB/PKP', () => {
  const items = [
    item('npwp', 'NPWP', 'required', 'missing'),
    item('nib', 'NIB', 'required', 'missing'),
    item('pkp_certificate', 'PKP certificate', 'required', 'missing'),
    item('sk_kemenkumham', 'SK Kemenkumham approval', 'required', 'uploaded'),
  ];
  const r = buildReadiness(checklist(items), { form: {} });
  assert.strictEqual(r.missingDocs, 3);
  for (const l of ['NPWP', 'NIB', 'PKP certificate']) assert.ok(r.next.includes(l));
  assert.ok(!r.next.includes('SK Kemenkumham'), 'an uploaded SK must not be reported as missing');
});

test('PKP registered with no PKP certificate → PKP certificate reported missing', () => {
  const items = [...ID_BASE.filter(i => i.type !== 'npwp'),
    item('npwp', 'NPWP', 'required', 'uploaded'),
    item('pkp_certificate', 'PKP certificate', 'required', 'missing')];
  const r = buildReadiness(checklist(items), { form: { npwp: '1', nib: '2', pkp_status: 'pkp_registered' } });
  assert.match(r.next, /Upload PKP certificate/i);
});

test('has employees with no payroll/BPJS → both reported missing', () => {
  const items = [...ID_BASE.map(i => ({ ...i, status: 'uploaded' })),
    item('payroll_document', 'Payroll document', 'conditional_required', 'missing'),
    item('bpjs_document', 'BPJS document', 'conditional_required', 'missing')];
  const r = buildReadiness(checklist(items), { form: { npwp: '1', nib: '2', employee_status: 'has_employees', bpjs_registered: true } });
  assert.strictEqual(r.missingDocs, 2);
  assert.ok(r.next.includes('Payroll document') && r.next.includes('BPJS document'));
});

test('an unconfirmed match asks for confirmation, not for another upload', () => {
  const items = [item('nib', 'NIB', 'required', 'needs_review')];
  const r = buildReadiness(checklist(items), { form: { nib: '1' } });
  assert.strictEqual(r.missingDocs, 0);
  assert.strictEqual(r.needsConfirmation, 1);
  assert.match(r.next, /confirm the document type for NIB/i);
  assert.ok(!/Upload NIB/i.test(r.next));
});

test('optional and not_required items are never reported as missing', () => {
  const items = [
    item('oss_license', 'OSS / business licence', 'optional', 'optional'),
    item('npwp', 'NPWP', 'not_required', 'not_required'),
  ];
  const r = buildReadiness(checklist(items), { form: {} });
  assert.strictEqual(r.missingDocs, 0);
  assert.strictEqual(r.next, 'Request accountant verification.');
});

test('no checklist → no confident counts and no contradicting fallback', () => {
  const r = buildReadiness(null, { form: {} });
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.missingDocs, null);
  assert.strictEqual(r.source, 'unavailable');
  assert.ok(!/Upload/i.test(r.next), 'must not guess which documents are missing');
});

test('a truncated checklist yields no confident "missing" claim', () => {
  const r = buildReadiness(checklist(ID_BASE, { truncated: true }), { form: {} });
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.missingDocs, null);
  assert.strictEqual(r.source, 'truncated');
});

test('no official-validation language is produced', () => {
  const r = buildReadiness(checklist(ID_BASE), { form: {} });
  assert.ok(!/valid|verified|certified|compliant|guarantee/i.test(r.next), r.next);
});

test('profile gaps are surfaced only once the documents are handled', () => {
  const items = ID_BASE.map(i => ({ ...i, status: 'uploaded' }));
  const r = buildReadiness(checklist(items), { form: { npwp: '1', nib: '2' }, missingFields: ['financial_year_start'] });
  assert.match(r.next, /complete financial year start in the profile/i);
  assert.strictEqual(r.verificationGaps, 1);
});

// ── Workbench pending actions (same payload as the Compliance Documents checklist) ──
// Regression: the Workbench rendered a hardcoded "NPWP, NIB, PKP certificate" line, so it kept
// asking for documents the checklist already showed as uploaded.
let buildDocumentActions;
test.before(async () => { ({ buildDocumentActions } = await import(MOD)); });

const labelsOf = (r) => r.actions.map(a => a.label).join(' | ');

test('uploaded NPWP and NIB produce no upload action', () => {
  const items = [
    item('npwp', 'NPWP', 'required', 'uploaded'),
    item('nib', 'NIB', 'required', 'uploaded'),
    item('akta', 'Akta / Deed', 'required', 'uploaded'),
    item('sk_kemenkumham', 'SK Kemenkumham approval', 'required', 'uploaded'),
  ];
  const r = buildDocumentActions(checklist(items), { form: { npwp: '01.234', nib: '9123' } });
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.actions.length, 0, labelsOf(r));
  assert.ok(!/Upload NPWP|Upload NIB/i.test(labelsOf(r)));
});

test('the hardcoded NPWP/NIB/PKP wording can never be produced', () => {
  const items = [item('npwp', 'NPWP', 'required', 'uploaded'), item('nib', 'NIB', 'required', 'uploaded')];
  const r = buildDocumentActions(checklist(items), { form: { npwp: '1', nib: '2' } });
  assert.ok(!JSON.stringify(r).includes('NPWP, NIB, PKP certificate'));
});

test('NIB uploaded but the NIB number is empty → an "enter number" action, not an upload', () => {
  const items = [item('nib', 'NIB', 'required', 'uploaded')];
  const r = buildDocumentActions(checklist(items), { form: { nib: '' } });
  assert.strictEqual(r.actions.length, 1);
  assert.strictEqual(r.actions[0].type, 'number');
  assert.match(r.actions[0].label, /Enter your NIB number/i);
});

test('a missing PKP certificate produces an upload action', () => {
  const items = [
    item('npwp', 'NPWP', 'required', 'uploaded'),
    item('pkp_certificate', 'PKP certificate', 'required', 'missing'),
  ];
  const r = buildDocumentActions(checklist(items), { form: { npwp: '1' } });
  assert.strictEqual(r.actions.length, 1);
  assert.strictEqual(r.actions[0].type, 'upload');
  assert.match(r.actions[0].label, /Upload PKP certificate/i);
});

test('declared employees with no payroll/BPJS produce upload actions', () => {
  const items = [
    item('payroll_document', 'Payroll document', 'conditional_required', 'missing'),
    item('bpjs_document', 'BPJS document', 'conditional_required', 'missing'),
  ];
  const r = buildDocumentActions(checklist(items), { form: { employee_status: 'has_employees' } });
  assert.strictEqual(r.actions.length, 2);
  assert.ok(r.actions.every(a => a.type === 'upload'));
  assert.match(labelsOf(r), /Payroll document/);
  assert.match(labelsOf(r), /BPJS document/);
});

test('a needs_review document produces a confirm action, not an upload', () => {
  const items = [item('akta', 'Akta / Deed', 'required', 'needs_review')];
  const r = buildDocumentActions(checklist(items), { form: {} });
  assert.strictEqual(r.actions.length, 1);
  assert.strictEqual(r.actions[0].type, 'confirm');
  assert.match(r.actions[0].label, /Confirm document type/i);
  assert.ok(!/Upload/i.test(labelsOf(r)));
});

test('optional and not_required documents never produce an action', () => {
  const items = [
    item('oss_license', 'OSS / business licence', 'optional', 'optional'),
    item('npwp', 'NPWP', 'not_required', 'not_required'),
    item('nib', 'NIB', 'not_required', 'uploaded'),          // uploaded, number blank, not required
    item('kpp_registration', 'KPP registration', 'optional', 'missing'),
  ];
  const r = buildDocumentActions(checklist(items, { jurisdiction: 'other' }), { form: { nib: '' } });
  assert.strictEqual(r.actions.length, 0, labelsOf(r));
});

test('no checklist → no invented document actions', () => {
  const r = buildDocumentActions(null, { form: {} });
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.actions.length, 0);
  assert.strictEqual(r.reason, 'unavailable');
});

test('a truncated checklist produces no confident upload actions', () => {
  const items = [item('npwp', 'NPWP', 'required', 'needs_review')];
  const r = buildDocumentActions(checklist(items, { truncated: true }), { form: {} });
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.actions.length, 0);
  assert.strictEqual(r.reason, 'truncated');
});

test('the Workbench actions agree with the readiness summary on the same payload', () => {
  const items = [
    item('npwp', 'NPWP', 'required', 'uploaded'),
    item('nib', 'NIB', 'required', 'uploaded'),
    item('pkp_certificate', 'PKP certificate', 'required', 'missing'),
  ];
  const form = { npwp: '01.234', nib: '' };
  const actions = buildDocumentActions(checklist(items), { form });
  const readiness = buildReadiness(checklist(items), { form });
  assert.strictEqual(actions.actions.filter(a => a.type === 'upload').length, readiness.missingDocs);
  assert.match(readiness.next, /Upload PKP certificate/i);
  assert.match(labelsOf(actions), /Upload PKP certificate/i);
  // Both surfaces ask for the NIB number, neither asks to upload NIB again.
  assert.match(labelsOf(actions), /Enter your NIB number/i);
  assert.match(readiness.next, /enter your NIB number/i);
});
