// AI Accountant document intake — Phase 1 logic tests.
//
// Covers the promises that matter for safety:
//   * a strong file-name match auto-classifies; anything weaker needs review;
//   * an uncertain match NEVER marks a compliance requirement satisfied;
//   * manual correction wins and is recorded as manually_confirmed;
//   * the checklist follows the saved profile (PKP / employees), never assumptions;
//   * intake types map onto the CHECK-valid financial_documents.document_type values, so no
//     migration is needed.
//
//   Run: node --test tests/integration/documentIntake.test.js
const test = require('node:test');
const assert = require('node:assert');
const di = require('../../server/lib/documentIntake');

// The CHECK list from migration 031 — every mapping MUST land inside it.
const CHECK_VALID = [
  'vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong', 'tax_billing',
  'payment_proof', 'filing_confirmation', 'bank_document', 'other',
];

const docOf = (file_name, intake) => ({ id: file_name, file_name, intake: { label: '', area: '', ...intake } });

// ── classification ──────────────────────────────────────────────────────────
test('strong file-name match auto-classifies with high confidence', () => {
  for (const [name, expected] of [
    ['NPWP.pdf', 'npwp'],
    ['npwp-company-2026.pdf', 'npwp'],
    ['NIB_1234567890.pdf', 'nib'],
    ['SK-Kemenkumham-AHU.pdf', 'sk_kemenkumham'],
    ['Akta Pendirian notaris.pdf', 'akta'],
    ['SPPKP-pkp-certificate.pdf', 'pkp_certificate'],
    ['BPJS-kesehatan-2026.pdf', 'bpjs_document'],
    ['bukti-bayar-ntpn.pdf', 'tax_payment_proof'],
    ['SPT-tahunan-2025.pdf', 'tax_report'],
    ['payroll-slip-gaji-jan.pdf', 'payroll_document'],
    ['rekening-koran-bca.pdf', 'bank_statement'],
  ]) {
    const r = di.classify({ file_name: name, mime_type: 'application/pdf' });
    assert.strictEqual(r.doc_type, expected, `${name} → ${expected}`);
    assert.strictEqual(r.confidence, 'high', `${name} should be high confidence`);
    assert.strictEqual(r.classification_status, 'auto_classified');
  }
});

test('weak/suggestive names classify but require review', () => {
  for (const [name, expected] of [['invoice-0012.pdf', 'invoice'], ['kwitansi.jpg', 'receipt'], ['contract-vendor.pdf', 'contract']]) {
    const r = di.classify({ file_name: name, mime_type: 'application/pdf' });
    assert.strictEqual(r.doc_type, expected);
    assert.strictEqual(r.confidence, 'medium');
    assert.strictEqual(r.classification_status, 'needs_review', 'a suggestive name must not auto-confirm');
  }
});

test('unknown file name is unknown + needs_review (never guessed)', () => {
  const r = di.classify({ file_name: 'scan_20260817_final.pdf', mime_type: 'application/pdf' });
  assert.strictEqual(r.doc_type, 'unknown');
  assert.strictEqual(r.confidence, 'unknown');
  assert.strictEqual(r.classification_status, 'needs_review');
});

test('MIME alone is only a low-confidence hint', () => {
  const r = di.classify({ file_name: 'export.csv', mime_type: 'text/csv' });
  assert.strictEqual(r.confidence, 'low');
  assert.strictEqual(r.classification_status, 'needs_review');
});

test('missing input does not throw', () => {
  assert.strictEqual(di.classify().doc_type, 'unknown');
  assert.strictEqual(di.classify({}).classification_status, 'needs_review');
});

// ── storage compatibility (no migration) ────────────────────────────────────
test('every intake type maps to a CHECK-valid document_type', () => {
  for (const t of di.INTAKE_TYPES) {
    assert.ok(CHECK_VALID.includes(t.maps_to), `${t.type} maps to invalid document_type "${t.maps_to}"`);
  }
  assert.strictEqual(di.mapsTo('npwp'), 'other');
  assert.strictEqual(di.mapsTo('bank_statement'), 'bank_document');
});

// ── checklist ───────────────────────────────────────────────────────────────
test('checklist: NPWP is missing with no documents, uploaded once confirmed', () => {
  const ID = { country: 'Indonesia' };
  const empty = di.buildChecklist(ID, []);
  const npwpMissing = empty.items.find(i => i.type === 'npwp');
  assert.strictEqual(npwpMissing.requirement, 'required');
  assert.strictEqual(npwpMissing.status, 'missing');

  const withDoc = di.buildChecklist(ID, [docOf('NPWP.pdf', { doc_type: 'npwp', confidence: 'high', classification_status: 'manually_confirmed' })]);
  assert.strictEqual(withDoc.items.find(i => i.type === 'npwp').status, 'uploaded');
});

test('checklist: high-confidence auto-classified document counts as uploaded', () => {
  const c = di.buildChecklist({ country: 'Indonesia' }, [docOf('NIB_123.pdf', { doc_type: 'nib', confidence: 'high', classification_status: 'auto_classified' })]);
  assert.strictEqual(c.items.find(i => i.type === 'nib').status, 'uploaded');
});

test('checklist: a LOW/medium confidence document stays needs_review, never uploaded', () => {
  for (const conf of ['low', 'medium', 'unknown']) {
    const c = di.buildChecklist({ country: 'Indonesia' }, [docOf('scan.pdf', { doc_type: 'npwp', confidence: conf, classification_status: 'needs_review' })]);
    const npwp = c.items.find(i => i.type === 'npwp');
    assert.strictEqual(npwp.status, 'needs_review', `${conf} confidence must not satisfy a requirement`);
    assert.notStrictEqual(npwp.status, 'uploaded');
  }
});

test('checklist: PKP certificate follows the saved PKP status', () => {
  const req = di.buildChecklist({ country: 'Indonesia', pkp_status: 'pkp_registered' }, []).items.find(i => i.type === 'pkp_certificate');
  assert.strictEqual(req.requirement, 'required');
  assert.strictEqual(req.status, 'missing');

  const notReq = di.buildChecklist({ country: 'Indonesia', pkp_status: 'non_pkp' }, []).items.find(i => i.type === 'pkp_certificate');
  assert.strictEqual(notReq.requirement, 'not_required');
  assert.strictEqual(notReq.status, 'not_required');

  const unknown = di.buildChecklist({ country: 'Indonesia' }, []).items.find(i => i.type === 'pkp_certificate');
  assert.strictEqual(unknown.requirement, 'optional', 'unknown PKP status must not be reported as required');
});

test('unset employee status is optional, never reported as "no employees"', () => {
  const c = di.buildChecklist({ country: 'Indonesia' }, []);
  for (const t of ['payroll_document', 'bpjs_document']) {
    const item = c.items.find(i => i.type === t);
    assert.strictEqual(item.requirement, 'optional', `${t} must not be decided without employee status`);
    assert.doesNotMatch(item.reason, /states there are no employees/i,
      'must not claim the profile says something it never said');
    assert.match(item.reason, /Set employee status/i);
  }
});

test('checklist: payroll/BPJS required only when the profile says there are employees', () => {
  const withEmp = di.buildChecklist({ country: 'Indonesia', employee_status: 'has_employees' }, []);
  for (const t of ['payroll_document', 'bpjs_document']) {
    const item = withEmp.items.find(i => i.type === t);
    assert.strictEqual(item.requirement, 'conditional_required');
    assert.strictEqual(item.status, 'missing');
  }
  const noEmp = di.buildChecklist({ country: 'Indonesia', employee_status: 'none' }, []);
  for (const t of ['payroll_document', 'bpjs_document']) {
    assert.strictEqual(noEmp.items.find(i => i.type === t).status, 'not_required');
  }
});

test('checklist: deed/Kemenkumham required for incorporated entities only', () => {
  const pt = di.buildChecklist({ country: 'Indonesia', legal_entity_type: 'PT PMA' }, []);
  assert.strictEqual(pt.items.find(i => i.type === 'akta').requirement, 'required');
  assert.strictEqual(pt.items.find(i => i.type === 'sk_kemenkumham').requirement, 'required');

  const indiv = di.buildChecklist({ country: 'Indonesia', legal_entity_type: 'Individual / Freelancer' }, []);
  assert.strictEqual(indiv.items.find(i => i.type === 'akta').requirement, 'optional');
});

test('checklist is labelled preliminary and carries a disclaimer', () => {
  const c = di.buildChecklist({}, []);
  assert.match(c.label, /preliminary/i);
  assert.match(c.disclaimer, /does not verify|preliminary/i);
  assert.ok(/licensed professional/i.test(c.disclaimer), 'must point at a licensed professional');
});

test('checklist counts add up to the number of items', () => {
  const c = di.buildChecklist({ country: 'Indonesia', employee_status: 'has_employees', pkp_status: 'pkp_registered' }, []);
  const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, c.items.length);
});

// ── stored vs derived intake ────────────────────────────────────────────────
test('readIntake prefers persisted metadata over a filename guess', () => {
  const doc = { extracted_json: { ai_intake: { doc_type: 'akta', confidence: 'high', classification_status: 'manually_confirmed' } } };
  const intake = di.readIntake(doc, { file_name: 'NPWP.pdf' });
  assert.strictEqual(intake.doc_type, 'akta', 'a human confirmation must win over the file name');
  assert.strictEqual(intake.classification_status, 'manually_confirmed');
  assert.strictEqual(intake.persisted, true);
});

test('readIntake derives from the file name when nothing is stored', () => {
  const intake = di.readIntake({ extracted_json: null }, { file_name: 'NPWP.pdf', mime_type: 'application/pdf' });
  assert.strictEqual(intake.doc_type, 'npwp');
  assert.strictEqual(intake.persisted, false);
  assert.strictEqual(intake.label, 'NPWP');
});

test('readIntake ignores a stored type that is not in the taxonomy', () => {
  const intake = di.readIntake({ extracted_json: { ai_intake: { doc_type: 'not_a_real_type' } } }, { file_name: 'NIB.pdf' });
  assert.strictEqual(intake.doc_type, 'nib', 'unknown stored type falls back to derivation');
});

test('intakePatch records manual confirmation and preserves sibling keys', () => {
  const patch = di.intakePatch({ notes: 'keep me', extraction: { x: 1 } }, { doc_type: 'npwp', actorUserId: 42 });
  assert.strictEqual(patch.notes, 'keep me', 'must not drop existing extracted_json keys');
  assert.deepStrictEqual(patch.extraction, { x: 1 });
  assert.strictEqual(patch.ai_intake.doc_type, 'npwp');
  assert.strictEqual(patch.ai_intake.classification_status, 'manually_confirmed');
  assert.strictEqual(patch.ai_intake.confidence, 'high');
  assert.strictEqual(patch.ai_intake.confirmed_by_user_id, 42);
  assert.ok(patch.ai_intake.confirmed_at, 'timestamp recorded');
});

test('manual correction flips a needs_review document to uploaded in the checklist', () => {
  const before = di.buildChecklist({ country: 'Indonesia' }, [docOf('scan.pdf', { doc_type: 'npwp', confidence: 'low', classification_status: 'needs_review' })]);
  assert.strictEqual(before.items.find(i => i.type === 'npwp').status, 'needs_review');

  const patch = di.intakePatch(null, { doc_type: 'npwp', actorUserId: 1 });
  const corrected = di.readIntake({ extracted_json: patch }, { file_name: 'scan.pdf' });
  const after = di.buildChecklist({ country: 'Indonesia' }, [{ id: 'd1', file_name: 'scan.pdf', intake: corrected }]);
  assert.strictEqual(after.items.find(i => i.type === 'npwp').status, 'uploaded');
});

// ── jurisdiction awareness (P0 fix) ─────────────────────────────────────────
test('Indonesia profile requires NPWP and NIB', () => {
  const c = di.buildChecklist({ country: 'Indonesia' }, []);
  for (const t of ['npwp', 'nib']) {
    assert.strictEqual(c.items.find(i => i.type === t).requirement, 'required');
  }
  assert.strictEqual(c.jurisdiction, 'id');
});

test('non-Indonesia profile does NOT require Indonesian documents', () => {
  for (const country of ['Singapore', 'Other', 'Malaysia']) {
    const c = di.buildChecklist({ country }, []);
    assert.strictEqual(c.jurisdiction, 'other', country);
    for (const t of ['npwp', 'nib', 'bpjs_document', 'kpp_registration']) {
      const item = c.items.find(i => i.type === t);
      assert.strictEqual(item.requirement, 'not_required', `${t} must not be required in ${country}`);
      assert.strictEqual(item.status, 'not_required');
      assert.match(item.reason, /Indonesian requirement|only covers Indonesia/i);
    }
    assert.ok(c.warnings.some(w => /only covers Indonesia/i.test(w)), 'must warn that coverage is Indonesia-only');
  }
});

test('unknown jurisdiction is optional + warned, never "required"', () => {
  const c = di.buildChecklist({}, []);
  assert.strictEqual(c.jurisdiction, 'unknown');
  for (const t of ['npwp', 'nib']) {
    const item = c.items.find(i => i.type === t);
    assert.strictEqual(item.requirement, 'optional', `${t} must not be claimed required without a country`);
    assert.match(item.reason, /Set country\/jurisdiction/i);
  }
  assert.ok(c.warnings.some(w => /Country\/jurisdiction is not set/i.test(w)));
});

test('jurisdictionOf recognises Indonesia via country or jurisdiction field', () => {
  assert.strictEqual(di.jurisdictionOf({ country: 'Indonesia' }), 'id');
  assert.strictEqual(di.jurisdictionOf({ jurisdiction: 'ID' }), 'id');
  assert.strictEqual(di.jurisdictionOf({ country: 'Singapore' }), 'other');
  assert.strictEqual(di.jurisdictionOf({}), 'unknown');
});

// ── truncation (P0 fix) ─────────────────────────────────────────────────────
test('truncated document set never yields a confident "missing"', () => {
  const full = di.buildChecklist({ country: 'Indonesia' }, [], { truncated: false });
  assert.strictEqual(full.items.find(i => i.type === 'npwp').status, 'missing');

  const cut = di.buildChecklist({ country: 'Indonesia' }, [], { truncated: true });
  const npwp = cut.items.find(i => i.type === 'npwp');
  assert.strictEqual(npwp.status, 'needs_review', 'a partial set cannot prove a document is absent');
  assert.notStrictEqual(npwp.status, 'missing');
  assert.strictEqual(cut.truncated, true);
  assert.ok(cut.warnings.some(w => /outside this set|most recent documents/i.test(w)));
});

test('truncation does not downgrade an already-satisfied requirement', () => {
  const c = di.buildChecklist({ country: 'Indonesia' },
    [docOf('NPWP.pdf', { doc_type: 'npwp', confidence: 'high', classification_status: 'manually_confirmed' })],
    { truncated: true });
  assert.strictEqual(c.items.find(i => i.type === 'npwp').status, 'uploaded');
});
