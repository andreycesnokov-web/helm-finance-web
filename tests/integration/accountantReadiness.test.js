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

// ── PKP status: "Non-PKP" is an ANSWER, not a gap ───────────────────────────
// Regression: after setting PKP status to Non-PKP the UI still said "Upload PKP certificate",
// showed PKP effective date as Missing, and warned "without confirmed PKP status".
let pkpStatusOf, isFieldNotRequired;
test.before(async () => { ({ pkpStatusOf, isFieldNotRequired } = await import(MOD)); });

const PKP_REQUIRED = [item('pkp_certificate', 'PKP certificate', 'required', 'missing')];
const PKP_NOT_REQUIRED = [item('pkp_certificate', 'PKP certificate', 'not_required', 'not_required')];
const PKP_OPTIONAL = [item('pkp_certificate', 'PKP certificate', 'optional', 'missing')];

test('PKP registered → the PKP certificate is asked for', () => {
  const form = { pkp_status: 'pkp_registered' };
  const r = buildReadiness(checklist(PKP_REQUIRED), { form });
  assert.strictEqual(r.missingDocs, 1);
  assert.match(r.next, /Upload PKP certificate/i);
  const a = buildDocumentActions(checklist(PKP_REQUIRED), { form });
  assert.deepStrictEqual(a.actions.map(x => x.doc_type), ['pkp_certificate']);
});

test('Non-PKP → no "Upload PKP certificate" anywhere', () => {
  const form = { pkp_status: 'non_pkp' };
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED), { form });
  assert.strictEqual(r.missingDocs, 0, 'a not_required document is not missing');
  assert.ok(!/PKP certificate/i.test(r.next), `readiness still asks for it: ${r.next}`);
  const a = buildDocumentActions(checklist(PKP_NOT_REQUIRED), { form });
  assert.strictEqual(a.actions.length, 0, 'the Workbench must show no PKP action');
});

test('Non-PKP → PKP-only profile fields are not required, not "missing"', () => {
  const form = { pkp_status: 'non_pkp' };
  assert.strictEqual(isFieldNotRequired(form, 'pkp_effective_date'), true);
  assert.strictEqual(isFieldNotRequired(form, 'vat_status'), true);
  // Fields unrelated to PKP are unaffected.
  assert.strictEqual(isFieldNotRequired(form, 'npwp'), false);
  assert.strictEqual(isFieldNotRequired(form, 'financial_year_start'), false);
});

test('PKP registered or unknown → the PKP effective date still applies', () => {
  for (const pkp_status of ['pkp_registered', 'unknown', '', undefined]) {
    assert.strictEqual(isFieldNotRequired({ pkp_status }, 'pkp_effective_date'), false,
      `pkp_status=${pkp_status}`);
  }
});

test('a foreign-owned Non-PKP company gets an advisory, not an "unconfirmed" warning', () => {
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED),
    { form: { foreign_owned: 'yes', pkp_status: 'non_pkp', legal_entity_type: 'PT PMA' } });
  const flags = r.riskFlags.map(f => f.message).join(' | ');
  assert.ok(!/without confirmed PKP status/i.test(flags), `stale warning: ${flags}`);
  assert.match(flags, /marked Non-PKP/i);
  assert.match(flags, /Confirm with an accountant if VAT\/PPN registration is required/i);
});

test('a foreign-owned company with an UNSET PKP status is still flagged', () => {
  for (const pkp_status of ['unknown', '', undefined]) {
    const r = buildReadiness(checklist(PKP_OPTIONAL), { form: { foreign_owned: 'yes', pkp_status } });
    assert.match(r.riskFlags.map(f => f.message).join(' | '), /without a confirmed PKP status/i, `pkp_status=${pkp_status}`);
  }
});

test('a foreign-owned PKP-registered company raises no PKP flag at all', () => {
  const r = buildReadiness(checklist(PKP_REQUIRED), { form: { foreign_owned: 'yes', pkp_status: 'pkp_registered' } });
  const msgs = r.riskFlags.map(f => f.message).join(' | ');
  assert.ok(!/PKP/i.test(msgs), msgs);
});

test('unknown PKP produces no confident certificate requirement of our own', () => {
  // The backend marks it optional; the UI must not promote that to a demand.
  const form = { pkp_status: 'unknown' };
  const r = buildReadiness(checklist(PKP_OPTIONAL), { form });
  assert.strictEqual(r.missingDocs, 0);
  assert.ok(!/Upload PKP certificate/i.test(r.next));
  assert.strictEqual(buildDocumentActions(checklist(PKP_OPTIONAL), { form }).actions.length, 0);
});

test('pkpStatusOf normalises the stated status', () => {
  assert.strictEqual(pkpStatusOf({ pkp_status: 'pkp_registered' }), 'pkp_registered');
  assert.strictEqual(pkpStatusOf({ pkp_status: 'non_pkp' }), 'non_pkp');
  assert.strictEqual(pkpStatusOf({ pkp_status: 'NON_PKP' }), 'non_pkp');
  assert.strictEqual(pkpStatusOf({ pkp_status: 'unknown' }), 'unknown');
  assert.strictEqual(pkpStatusOf({}), 'unknown');
});

// ── severity: an advisory is not an error ───────────────────────────────────
let SEVERITY, applicableMissingFields;
test.before(async () => { ({ SEVERITY, applicableMissingFields } = await import(MOD)); });

const flagFor = (form) => buildReadiness(checklist(PKP_NOT_REQUIRED), { form });

test('the foreign-owned Non-PKP message is an ADVISORY, not a risk', () => {
  const r = flagFor({ foreign_owned: 'yes', pkp_status: 'non_pkp' });
  assert.strictEqual(r.riskFlags.length, 1);
  assert.strictEqual(r.riskFlags[0].severity, SEVERITY.ADVISORY);
  assert.strictEqual(r.riskFlags[0].severity, 'advisory');
  assert.match(r.riskFlags[0].message, /marked Non-PKP/i);
  assert.strictEqual(r.riskCount, 0, 'an advisory must not count as a risk');
});

test('the advisory copy does not claim Non-PKP is legally correct', () => {
  const msg = flagFor({ foreign_owned: 'yes', pkp_status: 'non_pkp' }).riskFlags[0].message;
  for (const bad of [/correct/i, /legally/i, /compliant/i, /\bvalid\b/i, /no action needed/i])
    assert.ok(!bad.test(msg), `advisory overclaims: ${msg}`);
  assert.match(msg, /Confirm with an accountant/i);
});

test('an unset or unknown PKP status is still a RISK, not an advisory', () => {
  for (const pkp_status of ['unknown', '', undefined]) {
    const r = buildReadiness(checklist(PKP_OPTIONAL), { form: { foreign_owned: 'yes', pkp_status } });
    assert.strictEqual(r.riskFlags[0].severity, SEVERITY.RISK, `pkp_status=${pkp_status}`);
    assert.strictEqual(r.riskCount, 1, `pkp_status=${pkp_status}`);
  }
});

test('the BPJS gap remains a risk', () => {
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED),
    { form: { pkp_status: 'non_pkp', employee_status: 'has_employees' } });
  const bpjs = r.riskFlags.find(f => /BPJS/.test(f.message));
  assert.strictEqual(bpjs.severity, SEVERITY.RISK);
});

// ── vat_status consistency: the badge and readiness must agree ──────────────
test('Non-PKP: a backend "vat_status" gap is suppressed, not counted', () => {
  const form = { pkp_status: 'non_pkp' };
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED), { form, missingFields: ['vat_status'] });
  assert.strictEqual(r.verificationGaps, 0, 'a not-required field is not a gap');
  assert.deepStrictEqual(r.suppressedFields, ['vat_status']);
  assert.ok(!/vat status/i.test(r.next), `readiness still asks for it: ${r.next}`);
  assert.strictEqual(r.next, 'Request accountant verification.');
});

test('Non-PKP: the field badge and readiness agree on vat_status', () => {
  const form = { pkp_status: 'non_pkp' };
  // What the badge says…
  assert.strictEqual(isFieldNotRequired(form, 'vat_status'), true);
  // …and what readiness counts must be the same answer.
  assert.strictEqual(applicableMissingFields(form, ['vat_status']).length, 0);
});

test('Non-PKP: unrelated missing fields are still reported', () => {
  const form = { pkp_status: 'non_pkp' };
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED),
    { form, missingFields: ['vat_status', 'financial_year_start'] });
  assert.strictEqual(r.verificationGaps, 1, 'only the PKP-only field is suppressed');
  assert.match(r.next, /complete financial year start in the profile/i);
});

test('PKP registered: vat_status is still a real gap', () => {
  const r = buildReadiness(checklist(PKP_REQUIRED),
    { form: { pkp_status: 'pkp_registered' }, missingFields: ['vat_status'] });
  assert.strictEqual(r.verificationGaps, 1);
  assert.deepStrictEqual(r.suppressedFields, []);
});

test('unknown/unset PKP: vat_status is NOT suppressed', () => {
  for (const pkp_status of ['unknown', '', undefined]) {
    const form = { pkp_status };
    assert.strictEqual(isFieldNotRequired(form, 'vat_status'), false, `pkp_status=${pkp_status}`);
    const r = buildReadiness(checklist(PKP_OPTIONAL), { form, missingFields: ['vat_status'] });
    assert.strictEqual(r.verificationGaps, 1, `pkp_status=${pkp_status}`);
  }
});

test('applicableMissingFields is defensive about odd input', () => {
  assert.deepStrictEqual(applicableMissingFields({}, undefined), []);
  assert.deepStrictEqual(applicableMissingFields({}, null), []);
  assert.deepStrictEqual(applicableMissingFields({ pkp_status: 'non_pkp' }, ['npwp']), ['npwp']);
});

// ── Workbench "What to prepare" must use the FILTERED missing list ──────────
// Regression: the card read state.applicability.missing_profile_fields directly, so a Non-PKP
// company whose only backend gap was vat_status still saw "Finish your tax profile…" while the
// field badge said Not required and verification gaps were 0.
const fs = require('node:fs');
const WORKBENCH_SRC = path.join(__dirname, '..', '..', 'client', 'src', 'pages', 'business', 'AccountantPremium.jsx');

// The card is inline JSX, so its INPUT is what a unit test can pin.
const prepareNeeded = (form, backendMissing) =>
  applicableMissingFields(form, backendMissing).length > 0;

test('Non-PKP with only vat_status missing → no "Finish your tax profile"', () => {
  const form = { pkp_status: 'non_pkp' };
  assert.strictEqual(prepareNeeded(form, ['vat_status']), false);
  // …and the other two surfaces agree, which is the point.
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED), { form, missingFields: ['vat_status'] });
  assert.strictEqual(r.verificationGaps, 0);
  assert.strictEqual(buildDocumentActions(checklist(PKP_NOT_REQUIRED), { form }).actions.length, 0);
});

test('Non-PKP with an unrelated missing field → profile guidance is still shown', () => {
  const form = { pkp_status: 'non_pkp' };
  assert.strictEqual(prepareNeeded(form, ['vat_status', 'financial_year_start']), true);
  const r = buildReadiness(checklist(PKP_NOT_REQUIRED),
    { form, missingFields: ['vat_status', 'financial_year_start'] });
  assert.strictEqual(r.verificationGaps, 1);
});

test('PKP registered with vat_status missing → profile guidance is still shown', () => {
  assert.strictEqual(prepareNeeded({ pkp_status: 'pkp_registered' }, ['vat_status']), true);
});

test('unknown/unset PKP with vat_status missing → NOT suppressed', () => {
  for (const pkp_status of ['unknown', '', undefined])
    assert.strictEqual(prepareNeeded({ pkp_status }, ['vat_status']), true, `pkp_status=${pkp_status}`);
});

test('the Workbench source no longer reads the raw backend missing list for display', () => {
  const src = fs.readFileSync(WORKBENCH_SRC, 'utf8');
  // One derivation only: the filtered `missing`. Any other read of the raw field would be a
  // second, contradicting source of truth.
  const rawReads = src.split('\n').filter(l => l.includes('missing_profile_fields'));
  for (const line of rawReads) {
    const ok = line.includes('applicableMissingFields') || /missing_profile_fields: \[\]/.test(line);
    assert.ok(ok, `raw missing_profile_fields used for display: ${line.trim()}`);
  }
  assert.ok(src.includes('applicableMissingFields('), 'the filter must be used');
  assert.ok(!/What to prepare[\s\S]{0,200}state\.applicability\?\.missing_profile_fields/.test(src),
    '"What to prepare" must not read the raw list');
});
