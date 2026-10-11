// Invoice Payment Matching V1 — settlement maths, matching and closeout rules.
// Driven by the real Circleka / Helm Care sample.
// Run: node tests/invoiceSettlement.test.js
const assert = require('node:assert');
const S = require('../server/lib/invoiceSettlement');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

// ── the sample ─────────────────────────────────────────────────────────────
const INVOICE_RAW = {
  invoice_number: 'X2610001139',
  vendor_name: 'PT Circleka Indonesia Utama',
  buyer_name: 'PT Helm Care Indonesia',
  description: 'Rent space / placement of Helm Care machines in 36 Circle K stores',
  invoice_date: '2026-04-15', period_start: '2026-04-15', period_end: '2026-07-14',
  base_amount: 'Rp129.600.000', tax_type: 'PPN', tax_amount: 'Rp14.256.000',
  total_amount: 'Rp143.856.000', currency: 'IDR',
};
const PROOF_RAW = {
  bank_name: 'BCA', transfer_date: '2026-09-04T09:35:02',
  from_account_number: '772-1538064', from_account_name: 'HELM CARE INDONESIA PT',
  to_account_number: '075-3020192', to_account_name: 'CIRCLEKA INDONESIA UTAMA',
  amount: 'Rp29.600.000', status: 'Successful',
  reference_number: '26090400308936', currency: 'IDR',
};
const BUSINESS = 'PT Helm Care Indonesia';

// ── 1. invoice extraction ──────────────────────────────────────────────────
t('1. invoice sample: DPP 129,600,000 · PPN 14,256,000 · total 143,856,000', () => {
  const inv = S.normalizeInvoice(INVOICE_RAW);
  assert.strictEqual(inv.base_amount, 129600000);
  assert.strictEqual(inv.tax_amount, 14256000);
  assert.strictEqual(inv.total_amount, 143856000);
  assert.strictEqual(inv.invoice_number, 'X2610001139');
  assert.strictEqual(inv.currency, 'IDR');
  assert.strictEqual(inv.needs_review, false);
  // base + tax must reconcile to the stated total
  assert.strictEqual(S.round2(inv.base_amount + inv.tax_amount), inv.total_amount);
});

t('Indonesian and anglo amount formats both parse, decimals respected', () => {
  assert.strictEqual(S.parseAmount('Rp129.600.000'), 129600000);
  assert.strictEqual(S.parseAmount('129,600,000'), 129600000);
  assert.strictEqual(S.parseAmount('143.856.000,50'), 143856000.5);
  assert.strictEqual(S.parseAmount('1,234.56'), 1234.56);
  assert.strictEqual(S.parseAmount(''), null);
  assert.strictEqual(S.parseAmount('not a number'), null);
});

t('a total contradicting base + tax is flagged, never averaged', () => {
  const inv = S.normalizeInvoice({ ...INVOICE_RAW, total_amount: 'Rp999.999.999' });
  assert.ok(inv.warnings.some((w) => /does not equal base/i.test(w)));
  assert.strictEqual(inv.needs_review, true);
});

// ── 2. payment proof extraction ────────────────────────────────────────────
t('2. proof sample: amount 29,600,000 · Successful · ref 26090400308936', () => {
  const p = S.normalizePaymentProof(PROOF_RAW);
  assert.strictEqual(p.amount, 29600000);
  assert.strictEqual(p.status, 'Successful');
  assert.strictEqual(p.reference_number, '26090400308936');
  assert.strictEqual(p.bank_name, 'BCA');
  assert.strictEqual(p.settled_ok, true);
  assert.strictEqual(p.needs_review, false);
});

t('a pending or failed transfer can never settle anything', () => {
  const p = S.normalizePaymentProof({ ...PROOF_RAW, status: 'Pending' });
  assert.strictEqual(p.settled_ok, false);
  assert.strictEqual(p.needs_review, true);
  const m = S.matchPaymentToInvoice(p, S.normalizeInvoice(INVOICE_RAW), { outstanding: 143856000 });
  assert.ok(m.blockers.some((b) => /Pending/.test(b)));
  assert.strictEqual(m.matched, false);
});

// ── direction ──────────────────────────────────────────────────────────────
t('direction is payable — decided by issuer/buyer, not by what the user calls it', () => {
  const d = S.classifyDirection({
    issuer_name: 'PT Circleka Indonesia Utama',
    recipient_name: 'PT Helm Care Indonesia',
    business_name: BUSINESS,
  });
  assert.strictEqual(d.direction, 'payable');
  assert.strictEqual(d.confidence, 'High');
  assert.ok(/owes the money/.test(d.reason));
});

t('direction flips correctly when this business is the issuer', () => {
  const d = S.classifyDirection({
    issuer_name: 'PT Helm Care Indonesia', recipient_name: 'PT Circleka Indonesia Utama',
    business_name: BUSINESS,
  });
  assert.strictEqual(d.direction, 'receivable');
});

t('direction is unknown when neither party is this business', () => {
  const d = S.classifyDirection({ issuer_name: 'PT A', recipient_name: 'PT B', business_name: BUSINESS });
  assert.strictEqual(d.direction, 'unknown');
});

// ── 3 & 4. partial settlement ──────────────────────────────────────────────
t('3. partial: total 143,856,000 − paid 29,600,000 = 114,256,000 partially_paid', () => {
  const s = S.settlementOf({
    invoice_total: 143856000, base_amount: 129600000, tax_amount: 14256000,
    allocations: [{ allocated_amount: 29600000 }],
  });
  assert.strictEqual(s.invoice_total, 143856000);
  assert.strictEqual(s.paid_amount, 29600000);
  assert.strictEqual(s.remaining_amount, 114256000);
  assert.strictEqual(s.status, 'partially_paid');
  assert.strictEqual(s.payment_count, 1);
});

t('4. base-only view is context: base remaining 100,000,000', () => {
  const s = S.settlementOf({
    invoice_total: 143856000, base_amount: 129600000,
    allocations: [{ allocated_amount: 29600000 }],
  });
  assert.strictEqual(s.base_view.base_amount, 129600000);
  assert.strictEqual(s.base_view.paid_against_base, 29600000);
  assert.strictEqual(s.base_view.base_remaining, 100000000);
  // and it must NOT be what closeout measures against
  assert.strictEqual(s.remaining_amount, 114256000);
  assert.ok(/Context only/.test(s.base_view.note));
});

t('multiple payments accumulate to paid', () => {
  const allocations = [{ allocated_amount: 29600000 }, { allocated_amount: 50000000 }, { allocated_amount: 64256000 }];
  const s = S.settlementOf({ invoice_total: 143856000, allocations });
  assert.strictEqual(s.paid_amount, 143856000);
  assert.strictEqual(s.remaining_amount, 0);
  assert.strictEqual(s.status, 'paid');
  assert.strictEqual(s.payment_count, 3);
});

t('status ladder: unpaid / partially_paid / paid / overpaid', () => {
  const at = (paid) => S.settlementOf({ invoice_total: 1000, allocations: paid ? [{ allocated_amount: paid }] : [] }).status;
  assert.strictEqual(at(0), 'unpaid');
  assert.strictEqual(at(400), 'partially_paid');
  assert.strictEqual(at(1000), 'paid');
  assert.strictEqual(at(1500), 'overpaid');
  const over = S.settlementOf({ invoice_total: 1000, allocations: [{ allocated_amount: 1500 }] });
  assert.strictEqual(over.over_paid_amount, 500);
  assert.ok(over.blockers.length > 0);
});

// ── matching ───────────────────────────────────────────────────────────────
t('the sample payment matches the sample invoice with High confidence', () => {
  const inv = S.normalizeInvoice(INVOICE_RAW);
  const p = S.normalizePaymentProof(PROOF_RAW);
  const m = S.matchPaymentToInvoice(p, inv, { outstanding: 143856000, business_name: BUSINESS });
  assert.strictEqual(m.confidence, 'High');
  assert.strictEqual(m.matched, true);
  assert.strictEqual(m.suggested_allocation, 29600000);
  assert.strictEqual(m.requires_confirmation, true, 'a match is a suggestion, never an action');
  assert.ok(m.reasons.some((r) => /matches the invoice vendor/i.test(r)));
});

t('a payment larger than the outstanding balance is blocked', () => {
  const inv = S.normalizeInvoice(INVOICE_RAW);
  const p = S.normalizePaymentProof({ ...PROOF_RAW, amount: 200000000 });
  const m = S.matchPaymentToInvoice(p, inv, { outstanding: 143856000, business_name: BUSINESS });
  assert.strictEqual(m.matched, false);
  assert.ok(m.blockers.some((b) => /larger than the outstanding/i.test(b)));
});

t('a currency mismatch and a pre-invoice date are blockers', () => {
  const inv = S.normalizeInvoice(INVOICE_RAW);
  const usd = S.matchPaymentToInvoice(S.normalizePaymentProof({ ...PROOF_RAW, currency: 'USD' }), inv, { outstanding: 143856000 });
  assert.ok(usd.blockers.some((b) => /USD/.test(b)));
  const early = S.matchPaymentToInvoice(S.normalizePaymentProof({ ...PROOF_RAW, transfer_date: '2026-01-01' }), inv, { outstanding: 143856000 });
  assert.ok(early.blockers.some((b) => /before the invoice/i.test(b)));
});

// ── 5. duplicate protection ────────────────────────────────────────────────
t('5. the same bank reference is detected as a duplicate', () => {
  const p = S.normalizePaymentProof(PROOF_RAW);
  const first = S.findDuplicateProof(p, []);
  assert.strictEqual(first.duplicate, false);
  const again = S.findDuplicateProof(p, [p]);
  assert.strictEqual(again.duplicate, true);
  assert.ok(/already been recorded/.test(again.reason));
  assert.strictEqual(S.duplicateKeyOf(p), 'BCA:26090400308936');
});

t('a proof with no reference cannot be auto-deduplicated, and says so', () => {
  const p = S.normalizePaymentProof({ ...PROOF_RAW, reference_number: null });
  const r = S.findDuplicateProof(p, [p]);
  assert.strictEqual(r.duplicate, false);
  assert.ok(/cannot be detected automatically/.test(r.reason));
});

// ── 6 & 7. closeout ────────────────────────────────────────────────────────
const DOCS_COMPLETE = { invoice: true, tax_invoice: true, payment_proof: true, accountant_confirmation: true };

t('7. a partially paid invoice CANNOT be closed', () => {
  const s = S.settlementOf({ invoice_total: 143856000, allocations: [{ allocated_amount: 29600000 }] });
  const c = S.closeoutState({ settlement: s, documents: DOCS_COMPLETE, accountant_review: 'accountant_approved', has_tax: true });
  assert.strictEqual(c.can_close, false);
  assert.strictEqual(c.state, 'Partially paid');
  assert.ok(c.blockers.some((b) => /Cannot close yet. Remaining balance: 114256000/.test(b)));
});

t('6. a fully paid invoice closes ONLY when documents and review are complete', () => {
  const s = S.settlementOf({ invoice_total: 143856000, allocations: [{ allocated_amount: 143856000 }] });

  const noDocs = S.closeoutState({ settlement: s, documents: { invoice: true, payment_proof: true }, accountant_review: 'accountant_approved', has_tax: true });
  assert.strictEqual(noDocs.can_close, false);
  assert.strictEqual(noDocs.state, 'Fully paid — documents incomplete');
  assert.ok(noDocs.missing_documents.includes('Faktur Pajak'));

  const noReview = S.closeoutState({ settlement: s, documents: DOCS_COMPLETE, accountant_review: null, has_tax: true });
  assert.strictEqual(noReview.can_close, false);
  assert.ok(noReview.blockers.some((b) => /Accountant review is not complete/.test(b)));

  const ready = S.closeoutState({ settlement: s, documents: DOCS_COMPLETE, accountant_review: 'accountant_approved', has_tax: true });
  assert.strictEqual(ready.can_close, true);
  assert.strictEqual(ready.state, 'Closed / accountant confirmed');
});

t('payment alone never opens the gate — money, documents and review are separate', () => {
  const s = S.settlementOf({ invoice_total: 1000, allocations: [{ allocated_amount: 1000 }] });
  const c = S.closeoutState({ settlement: s, documents: {}, accountant_review: null });
  assert.strictEqual(c.can_close, false);
  assert.ok(c.blockers.length >= 2, 'both documents and review must block');
});

t('faktur pajak is required only when the invoice carries tax', () => {
  const s = S.settlementOf({ invoice_total: 1000, allocations: [{ allocated_amount: 1000 }] });
  const noTax = S.closeoutState({ settlement: s, has_tax: false,
    documents: { invoice: true, payment_proof: true, accountant_confirmation: true },
    accountant_review: 'accountant_approved' });
  assert.strictEqual(noTax.can_close, true, 'no PPN means no faktur required');
});

t('a suspected duplicate blocks closing', () => {
  const s = S.settlementOf({ invoice_total: 1000, allocations: [{ allocated_amount: 1000 }] });
  const c = S.closeoutState({ settlement: s, documents: DOCS_COMPLETE,
    accountant_review: 'accountant_approved', duplicates: [{ reference_number: 'X' }] });
  assert.strictEqual(c.can_close, false);
  assert.ok(c.blockers.some((b) => /duplicate/i.test(b)));
});

// ── 10. unclear data ───────────────────────────────────────────────────────
t('10. a missing invoice total requires review and can never auto-close', () => {
  const s = S.settlementOf({ invoice_total: null, allocations: [{ allocated_amount: 29600000 }] });
  assert.strictEqual(s.status, 'needs_review');
  assert.strictEqual(s.remaining_amount, null);
  const c = S.closeoutState({ settlement: s, documents: DOCS_COMPLETE, accountant_review: 'accountant_approved' });
  assert.strictEqual(c.can_close, false);
  assert.strictEqual(c.state, 'Needs review');
});

t('an invoice missing required fields is needs_review', () => {
  const inv = S.normalizeInvoice({ vendor_name: 'PT X' });
  assert.strictEqual(inv.needs_review, true);
  assert.ok(inv.missing.includes('invoice_number'));
  assert.ok(inv.missing.includes('total_amount'));
});

console.log(`\n${pass} passed`);
