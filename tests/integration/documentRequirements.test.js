// Backend regression: the legal-entity document required by requirementsFor() is
// ENTITY-SPECIFIC.
//
// Origin: one broad `/pt|cv|yayasan|firma/` test made the PT-specific "SK Kemenkumham
// approval" (Keputusan Menteri Hukum … Pengesahan Pendirian Badan Hukum Perseroan Terbatas)
// required for a CV and a Yayasan too. A CV is REGISTERED in AHU rather than approved as a
// badan hukum, so asking it for a PT approval decision is simply wrong.
//
// The stored doc_type stays `sk_kemenkumham` for every entity — presentation varies, taxonomy
// does not, so no migration and no CHECK-constraint change is involved. These tests pin both.
//
//   Run: node --test tests/integration/documentRequirements.test.js
const test = require('node:test');
const assert = require('node:assert');
const di = require('../../server/lib/documentIntake');

const legalEntityRow = (legal_entity_type) =>
  di.requirementsFor({ country: 'Indonesia', legal_entity_type })
    .find(i => i.type === 'sk_kemenkumham');

const PT_WORDING = /Perseroan Terbatas/i;

test('PT and PT PMA receive the PT-specific SK Kemenkumham document', () => {
  for (const entity of ['PT PMA', 'PT Local', 'pt pma']) {
    const r = legalEntityRow(entity);
    assert.strictEqual(r.requirement, 'required', entity);
    assert.strictEqual(r.label, 'SK Kemenkumham approval', entity);
    assert.match(r.reason, /Ministry decision/i, entity);
    assert.match(r.reason, new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), entity);
  }
});

test('a CV never receives Perseroan Terbatas wording', () => {
  const r = legalEntityRow('CV');
  assert.ok(!PT_WORDING.test(r.label), 'PT wording leaked into a CV label');
  assert.ok(!PT_WORDING.test(r.reason), 'PT wording leaked into a CV reason');
  assert.ok(!/SK Kemenkumham/i.test(r.label), 'a CV must not be asked for a PT decision letter');
});

test('a CV receives AHU / Surat Keterangan Terdaftar wording', () => {
  const r = legalEntityRow('CV');
  assert.strictEqual(r.requirement, 'required');
  assert.match(r.label, /AHU CV registration/i);
  assert.match(r.reason, /Surat Keterangan Terdaftar/);
  assert.match(r.reason, /registered in AHU/i);
});

test('a Yayasan never receives Perseroan Terbatas wording', () => {
  const r = legalEntityRow('Yayasan');
  assert.ok(!PT_WORDING.test(r.label + r.reason), 'PT wording leaked into a Yayasan row');
  assert.ok(!/SK Kemenkumham/i.test(r.label));
});

test('Yayasan, Firma and other forms use neutral AHU wording that asks for confirmation', () => {
  for (const entity of ['Yayasan', 'Firma']) {
    const r = legalEntityRow(entity);
    assert.strictEqual(r.requirement, 'required', entity);
    assert.match(r.label, /AHU legal entity approval \/ registration/i, entity);
    // Where the exact official title is not confirmed in code we say so rather than guess.
    assert.match(r.reason, /Confirm the exact document with your notary/i, entity);
    assert.match(r.reason, new RegExp(entity, 'i'), entity);
  }
});

test('a non-incorporated profile keeps the document optional, still without PT wording', () => {
  for (const entity of ['Individual / Freelancer', '']) {
    const r = legalEntityRow(entity);
    assert.strictEqual(r.requirement, 'optional', entity || '(unset)');
    assert.ok(!PT_WORDING.test(r.label + r.reason), entity || '(unset)');
  }
});

test('every entity keeps the SAME doc_type — no new taxonomy, no migration', () => {
  for (const entity of ['PT PMA', 'PT Local', 'CV', 'Yayasan', 'Firma', 'Individual / Freelancer']) {
    const r = legalEntityRow(entity);
    assert.strictEqual(r.type, 'sk_kemenkumham', entity);
    assert.ok(di.isIntakeType(r.type), `${entity}: doc_type must stay a known intake type`);
    // …and it must still map to a CHECK-valid financial_documents.document_type.
    assert.ok(['other', 'bank_document', 'filing_confirmation', 'tax_billing', 'payment_proof',
      'vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong'].includes(di.mapsTo(r.type)), entity);
  }
});

test('entity wording does not survive a non-Indonesian jurisdiction as a requirement', () => {
  const r = di.requirementsFor({ country: 'Singapore', legal_entity_type: 'PT PMA' })
    .find(i => i.type === 'sk_kemenkumham');
  assert.strictEqual(r.requirement, 'not_required');
  assert.match(r.reason, /Indonesia/);
});

test('the checklist carries the entity-specific label through to the rendered item', () => {
  const docs = [];
  const cv = di.buildChecklist({ country: 'Indonesia', legal_entity_type: 'CV' }, docs);
  const row = cv.items.find(i => i.type === 'sk_kemenkumham');
  assert.match(row.label, /AHU CV registration/i);
  assert.ok(!PT_WORDING.test(JSON.stringify(row)), 'PT wording reached a CV checklist row');

  const pt = di.buildChecklist({ country: 'Indonesia', legal_entity_type: 'PT PMA' }, docs);
  assert.strictEqual(pt.items.find(i => i.type === 'sk_kemenkumham').label, 'SK Kemenkumham approval');
});

test('no requirement reason claims legal validity or compliance', () => {
  for (const entity of ['PT PMA', 'CV', 'Yayasan', 'Firma']) {
    const s = JSON.stringify(di.requirementsFor({ country: 'Indonesia', legal_entity_type: entity }));
    for (const bad of [/fully compliant/i, /legally valid/i, /\bcertified\b/i, /guarantee/i, /100%/])
      assert.ok(!bad.test(s), `${entity}: forbidden wording ${bad}`);
  }
});

// ── PKP status drives the PKP certificate requirement (backend source of truth) ──
const pkpRow = (pkp_status) =>
  di.requirementsFor({ country: 'Indonesia', legal_entity_type: 'PT PMA', pkp_status })
    .find(i => i.type === 'pkp_certificate');

test('PKP registered → the PKP certificate is required', () => {
  const r = pkpRow('pkp_registered');
  assert.strictEqual(r.requirement, 'required');
  assert.match(r.reason, /PKP-registered/i);
});

test('Non-PKP → the PKP certificate is NOT required', () => {
  const r = pkpRow('non_pkp');
  assert.strictEqual(r.requirement, 'not_required');
  assert.match(r.reason, /not PKP/i);
});

test('unknown or unset PKP → optional, never a confident requirement', () => {
  for (const v of ['unknown', '', undefined, null]) {
    const r = pkpRow(v);
    assert.strictEqual(r.requirement, 'optional', `pkp_status=${v}`);
    assert.match(r.reason, /Set PKP status/i, `pkp_status=${v}`);
  }
});

test('the Non-PKP verdict survives into the rendered checklist', () => {
  const cl = di.buildChecklist({ country: 'Indonesia', legal_entity_type: 'PT PMA', pkp_status: 'non_pkp' }, []);
  const row = cl.items.find(i => i.type === 'pkp_certificate');
  assert.strictEqual(row.requirement, 'not_required');
  assert.strictEqual(row.status, 'not_required', 'a not_required document is never "missing"');
  assert.strictEqual(cl.counts.missing, cl.items.filter(i => i.status === 'missing').length);
  assert.ok(!cl.items.some(i => i.type === 'pkp_certificate' && i.status === 'missing'));
});
