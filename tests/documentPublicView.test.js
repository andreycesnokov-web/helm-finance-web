// The ai_intake_v2 whitelist: everything the Document Center needs, nothing else.
// Run: node tests/documentPublicView.test.js
const assert = require('node:assert');
const { publicIntakeV2, publicIntakeV3, publicUploadIntent, PUBLIC_INTAKE_V2_FIELDS } = require('../server/lib/documentPublicView');

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

t('the exposed key set is exactly the 22 review fields', () => {
  // 20 from the intake summary, plus `source` and `intent_conflict` added with the
  // OCR/upload-intent work. Pinned on purpose: growing it must be a decision.
  assert.strictEqual(PUBLIC_INTAKE_V2_FIELDS.length, 22);
  assert.ok(PUBLIC_INTAKE_V2_FIELDS.includes('source'));
  assert.ok(PUBLIC_INTAKE_V2_FIELDS.includes('intent_conflict'));
});

t('how a document was read is exposed; what was read is not', () => {
  const p = publicIntakeV2({ ...SUMMARY, source: 'ocr_vision', intent_conflict: true,
    ocr_text: 'KWITANSI PT Sumber Alfaria Trijaya Tbk …', raw_text_excerpt: 'secret' });
  assert.strictEqual(p.source, 'ocr_vision');
  assert.strictEqual(p.intent_conflict, true);
  assert.ok(!('ocr_text' in p), 'the OCR transcript must never reach the client');
  assert.ok(!('raw_text_excerpt' in p));
});

t('the upload intent is exposed as four safe fields, nothing more', () => {
  const p = publicUploadIntent({
    source: 'invoice_upload', label: 'Invoice', suggested_document_type: 'invoice',
    suggested_direction: 'payable', created_at: '2026-09-04T10:00:00.000Z',
    actor_user_id: 950101, storage_path: 'biz/a/f.pdf',
  });
  assert.deepStrictEqual(Object.keys(p).sort(),
    ['created_at', 'label', 'source', 'suggested_direction', 'suggested_document_type']);
  assert.strictEqual(p.source, 'invoice_upload');
  assert.strictEqual(publicUploadIntent(null), null);
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

t('a failed analysis is exposed as a state the user can act on', () => {
  const v = publicIntakeV3({
    analyzed: false, fingerprint: 'abc', schema_version: 'financial_document_extraction_v3',
    model: 'claude-opus-5',
    failure: { reason: 'vision_timeout', retryable: true, user_message: 'Analysis did not finish in time. You can retry it.',
      provider_status: 529, provider_message: 'overloaded_error: server busy', responded_model: 'claude-opus-5' },
    attempts: 2, last_attempt_at: '2026-09-05T09:00:00Z',
  });
  assert.strictEqual(v.analyzed, false);
  assert.strictEqual(v.retryable, true);
  assert.strictEqual(v.failure_reason, 'vision_timeout');
  assert.ok(/retry/i.test(v.message), v.message);
  assert.strictEqual(v.attempts, 2);
});

t('operator diagnostics never reach the client payload', () => {
  const v = publicIntakeV3({
    analyzed: false, model: 'claude-opus-5',
    failure: { reason: 'model_policy_violation', retryable: false, user_message: 'Analysis could not be completed.',
      provider_status: 500, provider_message: 'internal: routed to claude-sonnet-5', responded_model: 'claude-sonnet-5' },
  });
  const json = JSON.stringify(v);
  for (const leak of ['claude', 'opus', 'sonnet', 'provider_message', 'provider_status', 'internal:', 'fingerprint']) {
    assert.ok(!json.toLowerCase().includes(leak), `${leak} leaked into the client payload: ${json}`);
  }
});

t('a successful reading says so', () => {
  assert.strictEqual(publicIntakeV3({ schema_version: 'v3', fields: {} }).analyzed, true);
});

console.log(`\n${pass} passed`);
