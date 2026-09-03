// AI Tax Split V1 — pure calculation tests.
// Run: node tests/taxSplit.test.js
const assert = require('node:assert');
const { buildTaxSplit, detectTreatment, TREATMENTS, REVIEW_STATES } = require('../server/lib/taxSplit');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

// ── the acceptance-criteria case ───────────────────────────────────────────
t('rent: gross 10,000,000 → withhold 1,000,000, pay vendor 9,000,000', () => {
  const r = buildTaxSplit({
    invoice_number: 'INV-001', vendor_name: 'PT ABC Properti',
    description: 'Office rent September 2026', invoice_date: '2026-09-01',
    gross_amount: 10000000, currency: 'IDR',
  });
  assert.strictEqual(r.detected_payment_type, 'rent_land_building');
  assert.strictEqual(r.confidence_score, 'High');
  assert.strictEqual(r.tax_rate, 0.10);
  assert.strictEqual(r.gross_amount, 10000000);
  assert.strictEqual(r.tax_payment_amount, 1000000);
  assert.strictEqual(r.vendor_payment_amount, 9000000);
  assert.strictEqual(r.payment_instruction.pay_vendor, 9000000);
  assert.strictEqual(r.payment_instruction.pay_tax_to_djp, 1000000);
  // vendor net + withheld must close back to gross
  assert.strictEqual(r.reconciliation.settlement, 10000000);
  assert.strictEqual(r.reconciliation.balanced, true);
});

t('rent: Indonesian wording detected (sewa gedung)', () => {
  const r = buildTaxSplit({ vendor_name: 'PT Sewa', description: 'Sewa gedung kantor', gross_amount: 5000000 });
  assert.strictEqual(r.detected_payment_type, 'rent_land_building');
  assert.strictEqual(r.tax_payment_amount, 500000);
  assert.strictEqual(r.vendor_payment_amount, 4500000);
});

// ── the safety cases: no silent auto-calculation ───────────────────────────
for (const [desc, key] of [
  ['Consulting service fee for August', 'service_fee'],
  ['Purchase of machine for production line', 'equipment_capex'],
  ['Miscellaneous charge', 'unknown'],
]) {
  t(`${key}: never auto-calculates a split`, () => {
    const r = buildTaxSplit({ vendor_name: 'PT X', description: desc, gross_amount: 10000000 });
    assert.strictEqual(r.detected_payment_type, key);
    assert.strictEqual(r.auto_calculated, false);
    assert.strictEqual(r.tax_rate, null);
    assert.strictEqual(r.tax_payment_amount, null);
    assert.strictEqual(r.vendor_payment_amount, null);
    assert.strictEqual(r.tax_base, 'needs_reviewer');
    assert.strictEqual(r.status, 'needs_accountant_review');
    assert.strictEqual(r.payment_instruction.pay_vendor, null);
    assert.ok(r.review_reasons.length > 0, 'must explain why review is needed');
  });
}

// ── invariants that must hold for EVERY result ─────────────────────────────
t('every treatment: review required, never legally verified, never active', () => {
  for (const key of Object.keys(TREATMENTS)) {
    const r = buildTaxSplit({ vendor_name: 'V', description: 'x', gross_amount: 1000 }, { treatment_key: key });
    assert.strictEqual(r.accountant_review_required, true, key);
    assert.strictEqual(r.legal_verified, false, key);
    assert.strictEqual(r.active, false, key);
    assert.ok(r.disclaimer.includes('reviewed by your accountant'), key);
  }
});

t('only rent auto-calculates — the catalog cannot silently grow a rate', () => {
  const auto = Object.values(TREATMENTS).filter((x) => x.auto_calculate);
  assert.strictEqual(auto.length, 1);
  assert.strictEqual(auto[0].key, 'rent_land_building');
  assert.ok(auto[0].source_ids.length > 0, 'an auto-calculating treatment must cite sources');
  assert.strictEqual(auto[0].kb_status, 'under_review');
});

t('missing gross: reports missing_data and computes nothing', () => {
  const r = buildTaxSplit({ vendor_name: 'PT ABC', description: 'Office rent' });
  assert.strictEqual(r.status, 'missing_data');
  assert.strictEqual(r.tax_payment_amount, null);
  assert.ok(r.missing_data.includes('gross amount'));
});

t('empty invoice: falls back to unknown, never throws', () => {
  const r = buildTaxSplit({});
  assert.strictEqual(r.detected_payment_type, 'unknown');
  assert.strictEqual(r.auto_calculated, false);
  assert.ok(r.missing_data.length >= 3);
});

t('user override downgrades confidence and is recorded', () => {
  const r = buildTaxSplit(
    { vendor_name: 'PT ABC', description: 'Office rent', gross_amount: 10000000 },
    { treatment_key: 'service_fee' });
  assert.strictEqual(r.detected_payment_type, 'service_fee');
  assert.strictEqual(r.detection.overridden_by_user, true);
  assert.strictEqual(r.confidence_score, 'Needs accountant review');
  assert.strictEqual(r.auto_calculated, false);
});

t('equipment carries the Company Asset hook', () => {
  const r = buildTaxSplit({ vendor_name: 'PT X', description: 'Hardware purchase', gross_amount: 1 });
  assert.strictEqual(r.asset_hook, true);
});

t('rent split never loses money to rounding', () => {
  for (const g of [1, 7, 333, 1234567, 999999999]) {
    const r = buildTaxSplit({ vendor_name: 'V', description: 'sewa', gross_amount: g });
    assert.strictEqual(r.tax_payment_amount + r.vendor_payment_amount, g, `gross ${g}`);
  }
});

t('detection reports what it matched on', () => {
  const d1 = detectTreatment({ description: 'Office rent', vendor_name: 'PT Q' });
  assert.strictEqual(d1.matched_on, 'description');
  const d2 = detectTreatment({ description: 'Monthly charge', vendor_name: 'PT Sewa Gedung' });
  assert.strictEqual(d2.matched_on, 'vendor_name');
  assert.strictEqual(d2.confidence, 'Medium', 'vendor-name-only match must not be High');
});

t('review flow vocabulary is complete', () => {
  for (const s of ['ai_suggested', 'owner_confirmed', 'sent_to_accountant_review',
                   'accountant_approved', 'accountant_edited', 'rejected_needs_more_info']) {
    assert.ok(REVIEW_STATES.includes(s), s);
  }
});

console.log(`\n${pass} passed`);
