// The ai_intake_v2 whitelist: everything the Document Center needs, nothing else.
// Run: node tests/documentPublicView.test.js
const assert = require('node:assert');
const { publicIntakeV2, PUBLIC_INTAKE_V2_FIELDS } = require('../server/lib/documentPublicView');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

// A realistic stored summary, as toStoredIntake() writes it.
const SUMMARY = {
  version: 'intake-v1',
  status: 'needs_counterparty',
  document_type: 'invoice',
  confidence: 'high',
  direction: 'payable',
  business_meaning: 'A supplier invoice — money this business owes.',
  counterparty_status: 'not_found',
  matched_counterparty_id: null,
  suggested_record_type: 'payable',
  amount: 13320000,
  currency: 'IDR',
  ppn_detected: true,
  ppn_amount: 1320000,
  tax_status: 'tax_detected',
  withholding_status: 'needs_rule',
  accountant_review_required: true,
  missing_fields: ['counterparty'],
  blockers: [],
  next_action_keys: ['create_counterparty', 'save_document_only'],
  processed_at: '2026-09-04T09:00:00.000Z',
};

t('1. every review field the UI needs survives the whitelist', () => {
  const p = publicIntakeV2(SUMMARY);
  for (const k of Object.keys(SUMMARY)) {
    assert.deepStrictEqual(p[k], SUMMARY[k], `${k} must be exposed unchanged`);
  }
});

t('2. anything not named is dropped — including future additions', () => {
  const p = publicIntakeV2({
    ...SUMMARY,
    raw_text: 'PT Nusantara Teknik Mandiri, invoice total 13.320.000',
    text_excerpt: 'Dari : PT ...',
    storage_path: 'biz/abc/secret.pdf',
    signed_url: 'https://storage/…?token=…',
    file_sha256: 'deadbeef',
    business_id: 'uuid',
    created_by_user_id: 42,
    internal_reasoning: 'matched on label "Netto"',
    some_future_field: { anything: true },
  });
  for (const leak of ['raw_text', 'text_excerpt', 'storage_path', 'signed_url', 'file_sha256',
    'business_id', 'created_by_user_id', 'internal_reasoning', 'some_future_field']) {
    assert.ok(!(leak in p), `${leak} must not be exposed`);
  }
  assert.deepStrictEqual(Object.keys(p).sort(), PUBLIC_INTAKE_V2_FIELDS.slice().sort());
});

t('the exposed key set is exactly the 20 review fields', () => {
  assert.strictEqual(PUBLIC_INTAKE_V2_FIELDS.length, 20);
});

t('no summary means null, not an empty shell', () => {
  assert.strictEqual(publicIntakeV2(null), null);
  assert.strictEqual(publicIntakeV2(undefined), null);
  assert.strictEqual(publicIntakeV2('nope'), null);
});

t('values are coerced, so a malformed summary cannot inject a shape', () => {
  const p = publicIntakeV2({
    status: { $ne: null }, amount: 'not-a-number', ppn_detected: 'yes',
    missing_fields: 'counterparty', next_action_keys: [1, 2, { k: 'v' }],
  });
  assert.strictEqual(p.status, null, 'a non-string status is dropped');
  assert.strictEqual(p.amount, null, 'a non-numeric amount is dropped');
  assert.strictEqual(p.ppn_detected, true, 'a truthy flag becomes a real boolean');
  assert.deepStrictEqual(p.missing_fields, [], 'a non-array list becomes an empty list');
  assert.deepStrictEqual(p.next_action_keys, [], 'non-string entries are dropped');
});

t('lists are capped and entries bounded', () => {
  const p = publicIntakeV2({
    blockers: Array.from({ length: 50 }, (_, i) => `b${i}`),
    missing_fields: ['x'.repeat(5000)],
  });
  assert.strictEqual(p.blockers.length, 20);
  assert.strictEqual(p.missing_fields[0].length, 200);
});

console.log(`\n${pass} passed`);
