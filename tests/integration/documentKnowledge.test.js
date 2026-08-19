// AI Accountant — Document Knowledge Base + checklist grouping (Phase 1).
//
// A flat "3 documents missing" list cannot tell an owner whether a document is a company
// foundation document or a payroll formality. These tests pin the grouping, the priority
// vocabulary, the short "minimum company pack", and the honesty rules: the knowledge base
// explains documents, it NEVER decides that one is required (the backend checklist does) and
// never claims a document is officially valid.
//
//   Run: node --test tests/integration/documentKnowledge.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const KB_MOD = pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'documentKnowledge.js')).href;
const RD_MOD = pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'accountantReadiness.js')).href;
let KB, buildDocumentActions;
test.before(async () => {
  KB = await import(KB_MOD);
  ({ buildDocumentActions } = await import(RD_MOD));
});

const item = (type, label, requirement, status) => ({ type, label, requirement, status, reason: 'because' });
const checklist = (items, extra = {}) => ({ items, truncated: false, jurisdiction: 'id',
  disclaimer: 'Preliminary only. …', ...extra });

// The owner's real production state.
const OWNER_STATE = [
  item('npwp', 'NPWP', 'required', 'uploaded'),
  item('nib', 'NIB', 'required', 'uploaded'),
  item('akta', 'Akta / Deed', 'required', 'uploaded'),
  item('sk_kemenkumham', 'SK Kemenkumham approval', 'required', 'uploaded'),
  item('pkp_certificate', 'PKP certificate', 'required', 'missing'),
  item('kpp_registration', 'KPP registration', 'optional', 'optional'),
  item('payroll_document', 'Payroll document', 'conditional_required', 'missing'),
  item('bpjs_document', 'BPJS document', 'conditional_required', 'missing'),
  item('bank_statement', 'Bank statement', 'optional', 'needs_review'),
];

// ── knowledge base coverage ─────────────────────────────────────────────────
test('every required document type has complete knowledge metadata', () => {
  const REQUIRED_TYPES = ['npwp', 'nib', 'akta', 'sk_kemenkumham', 'pkp_certificate',
    'kpp_registration', 'oss_license', 'payroll_document', 'bpjs_document', 'bank_statement',
    'tax_report', 'tax_payment_proof', 'contract', 'invoice', 'receipt'];
  const FIELDS = ['display_label', 'official_indonesian_name', 'aliases',
    'plain_language_description', 'why_needed', 'when_required', 'where_to_get',
    'confirms_profile_fields', 'group'];
  for (const t of REQUIRED_TYPES) {
    const k = KB.knowledgeFor(t);
    assert.ok(k, `missing knowledge for ${t}`);
    for (const f of FIELDS) assert.ok(k[f] !== undefined && k[f] !== '', `${t}.${f} is empty`);
    assert.ok(KB.GROUP_ORDER.includes(k.group), `${t} has an unknown group ${k.group}`);
  }
});

test('the Indonesian official names the owner asked for are present', () => {
  assert.match(KB.knowledgeFor('npwp').official_indonesian_name, /Nomor Pokok Wajib Pajak/);
  assert.match(KB.knowledgeFor('nib').official_indonesian_name, /Nomor Induk Berusaha/);
  assert.match(KB.knowledgeFor('pkp_certificate').official_indonesian_name, /Pengusaha Kena Pajak|SPPKP/);
  assert.match(KB.knowledgeFor('sk_kemenkumham').official_indonesian_name,
    /Keputusan Menteri Hukum.*Pengesahan Pendirian Badan Hukum/);
  assert.match(KB.knowledgeFor('bpjs_document').official_indonesian_name, /BPJS Ketenagakerjaan/);
  // Where to get it, for the same set.
  assert.match(KB.knowledgeFor('npwp').where_to_get, /DJP|Coretax|tax office/i);
  assert.match(KB.knowledgeFor('nib').where_to_get, /OSS/);
  assert.match(KB.knowledgeFor('sk_kemenkumham').where_to_get, /notary|AHU/i);
});

test('the knowledge base never claims official validity or compliance', () => {
  const s = JSON.stringify(KB.DOCUMENT_KNOWLEDGE) + KB.DISCLAIMER;
  for (const bad of [/fully compliant/i, /legally valid/i, /\bcertified\b/i, /guarantee/i, /100%/])
    assert.ok(!bad.test(s), `knowledge base uses forbidden wording: ${bad}`);
  assert.match(KB.DISCLAIMER, /not legal or tax advice/i);
  assert.match(KB.DISCLAIMER, /does not verify/i);
});

// ── grouping ────────────────────────────────────────────────────────────────
test('the checklist is grouped into the four purpose sections, in order', () => {
  const g = KB.groupChecklist(checklist(OWNER_STATE));
  assert.strictEqual(g.available, true);
  assert.deepStrictEqual(g.groups.map(x => x.key),
    ['identity', 'tax_registration', 'payroll', 'operational']);
  assert.deepStrictEqual(g.groups[0].items.map(i => i.type),
    ['npwp', 'nib', 'akta', 'sk_kemenkumham']);
  assert.deepStrictEqual(g.groups[2].items.map(i => i.type), ['payroll_document', 'bpjs_document']);
});

test('payroll documents are labelled as payroll compliance, not company identity', () => {
  const g = KB.groupChecklist(checklist(OWNER_STATE));
  const payroll = g.groups.find(x => x.key === 'payroll').items;
  for (const i of payroll) {
    assert.strictEqual(i.priority, 'payroll_required');
    assert.match(i.priority_label, /payroll compliance/i);
    assert.ok(!/identity/i.test(i.priority_label), 'payroll must not read as company identity');
  }
  const identity = g.groups.find(x => x.key === 'identity').items;
  for (const i of identity) assert.strictEqual(i.priority, 'core_required');
});

test('priority is derived from the BACKEND requirement, never invented', () => {
  const notRequired = KB.priorityOf(item('npwp', 'NPWP', 'not_required', 'not_required'));
  assert.strictEqual(notRequired, 'not_required');
  const optionalPkp = KB.priorityOf(item('pkp_certificate', 'PKP certificate', 'optional', 'optional'));
  assert.strictEqual(optionalPkp, 'optional');
  const requiredPkp = KB.priorityOf(item('pkp_certificate', 'PKP certificate', 'required', 'missing'));
  assert.strictEqual(requiredPkp, 'conditional_required');
});

// ── minimum company pack ────────────────────────────────────────────────────
test('the owner profile shows the minimum company pack 4 of 5, PKP outstanding', () => {
  const g = KB.groupChecklist(checklist(OWNER_STATE));
  assert.strictEqual(g.pack.total, 5, 'NPWP, NIB, Akta, SK, PKP certificate');
  assert.strictEqual(g.pack.satisfied, 4);
  assert.strictEqual(g.pack.complete, false);
  assert.deepStrictEqual(g.pack.outstanding.map(i => i.type), ['pkp_certificate']);
});

test('payroll is reported separately from the company pack', () => {
  const g = KB.groupChecklist(checklist(OWNER_STATE));
  assert.ok(!g.pack.items.some(i => i.group === 'payroll'), 'payroll must not be in the company pack');
  assert.strictEqual(g.payroll.applies, true);
  assert.deepStrictEqual(g.payroll.outstanding.map(i => i.type), ['payroll_document', 'bpjs_document']);
});

test('optional documents are not part of the minimum company pack', () => {
  const g = KB.groupChecklist(checklist(OWNER_STATE));
  const packTypes = g.pack.items.map(i => i.type);
  assert.ok(!packTypes.includes('bank_statement'), 'an optional bank statement is not in the pack');
  assert.ok(!packTypes.includes('kpp_registration'), 'an optional KPP registration is not in the pack');
});

test('with no employees the payroll section does not apply', () => {
  const items = OWNER_STATE.map(i => (i.type === 'payroll_document' || i.type === 'bpjs_document')
    ? { ...i, requirement: 'not_required', status: 'not_required' } : i);
  const g = KB.groupChecklist(checklist(items));
  assert.strictEqual(g.payroll.applies, false);
  assert.strictEqual(g.payroll.outstanding.length, 0);
});

test('an all-uploaded pack reports complete without claiming compliance', () => {
  const items = OWNER_STATE.map(i => KB.isMinimumPack(i) ? { ...i, status: 'uploaded' } : i);
  const g = KB.groupChecklist(checklist(items));
  assert.strictEqual(g.pack.complete, true);
  assert.match(g.disclaimer, /Preliminary/i);
});

test('no checklist → no grouping and no invented pack', () => {
  const g = KB.groupChecklist(null);
  assert.strictEqual(g.available, false);
  assert.strictEqual(g.groups.length, 0);
  assert.strictEqual(g.pack.total, 0);
  assert.strictEqual(g.pack.complete, false);
});

// ── Workbench actions must match the grouping ───────────────────────────────
test('Workbench actions match the checklist grouping and ordering', () => {
  const r = buildDocumentActions(checklist(OWNER_STATE), { form: { npwp: '01.2', nib: '91' } });
  // PKP (tax registration) first, then the two payroll documents.
  assert.deepStrictEqual(r.actions.map(a => a.doc_type),
    ['pkp_certificate', 'payroll_document', 'bpjs_document']);
  assert.deepStrictEqual(r.actions.map(a => a.group),
    ['tax_registration', 'payroll', 'payroll']);
});

test('Workbench copy distinguishes tax registration from payroll compliance', () => {
  const r = buildDocumentActions(checklist(OWNER_STATE), { form: { npwp: '1', nib: '2' } });
  const pkp = r.actions.find(a => a.doc_type === 'pkp_certificate');
  const bpjs = r.actions.find(a => a.doc_type === 'bpjs_document');
  assert.match(pkp.sub, /tax registration/i);
  assert.match(bpjs.sub, /payroll compliance/i);
  assert.ok(!/identity/i.test(bpjs.sub), 'BPJS must not read as a foundation document');
});

test('optional and not_required documents create no urgent pending action', () => {
  const r = buildDocumentActions(checklist(OWNER_STATE), { form: { npwp: '1', nib: '2' } });
  const types = r.actions.map(a => a.doc_type);
  assert.ok(!types.includes('bank_statement'), 'an optional needs_review document is not urgent');
  assert.ok(!types.includes('kpp_registration'));
  assert.ok(r.actions.every(a => KB.isUrgent({ type: a.doc_type, requirement: 'required' })));
});

test('an uploaded core document never produces an action', () => {
  const r = buildDocumentActions(checklist(OWNER_STATE), { form: { npwp: '1', nib: '2' } });
  const labels = r.actions.map(a => a.label).join(' | ');
  for (const l of ['Upload NPWP', 'Upload NIB', 'Upload Akta', 'Upload SK Kemenkumham'])
    assert.ok(!labels.includes(l), `stale action: ${l}`);
});

test('no action copy claims validity or compliance', () => {
  const r = buildDocumentActions(checklist(OWNER_STATE), { form: {} });
  const s = JSON.stringify(r.actions);
  for (const bad of [/fully compliant/i, /legally valid/i, /\bcertified\b/i, /guarantee/i, /100%/])
    assert.ok(!bad.test(s), `forbidden wording ${bad}`);
});
