// Document Intake Orchestrator V1 — the pipeline every uploaded document goes through.
//
// Deliberately built from SHAPES, not from one sample: a supplier invoice, a customer
// invoice, a faktur pajak, payments in both directions, a receipt, a contract, a bank
// statement, a scan, and documents missing the fields that matter.
//
// Run: node tests/documentIntakeOrchestrator.test.js
const assert = require('node:assert');
const O = require('../server/lib/documentIntakeOrchestrator');
const X = require('../server/lib/documentExtraction');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const US = 'PT Helm Care Indonesia';

// Two arbitrary vendors, so nothing depends on one real company.
const SUPPLIER_INVOICE = `
Invoice
No. Invoice INV-2026-0042
Dari : PT Sumber Makmur Sentosa
Kepada : PT Helm Care Indonesia
Netto 25.000.000
`;
const CUSTOMER_INVOICE = `
Invoice
No. Invoice OUT-2026-0007
Dari : PT Helm Care Indonesia
Kepada : PT Ritel Nusantara Jaya
Netto 8.500.000
`;
const FAKTUR = `
Faktur Pajak
Kode dan Nomor Seri Faktur Pajak: 010.004-26.11223344
Pengusaha Kena Pajak
Nama : PT Sumber Makmur Sentosa
Pembeli Barang Kena Pajak
Nama : PT Helm Care Indonesia
Dasar Pengenaan Pajak 10.000.000
Jumlah PPN 1.100.000
Netto 11.100.000
`;
const OUTGOING_PROOF = `
Bukti Transfer
Dari 111-2223334 / PT HELM CARE INDONESIA
Ke 555-6667778 / PT SUMBER MAKMUR SENTOSA
Amount Rp 25.000.000
Status Successful
Reference No. 20260904111222
`;
const INCOMING_PROOF = `
Bukti Transfer
Dari 999-8887776 / PT RITEL NUSANTARA JAYA
Ke 111-2223334 / PT HELM CARE INDONESIA
Amount Rp 8.500.000
Status Successful
Reference No. 20260904333444
`;
const CONTRACT = `
Perjanjian Kerja Sama
Para Pihak
Pasal 1 Ruang Lingkup
PT Sumber Makmur Sentosa dan PT Helm Care Indonesia
`;
const BANK_STATEMENT = `
Rekening Koran
Mutasi Rekening periode 01/08/2026 - 31/08/2026
Saldo Akhir 152.450.000
`;

const run = (text, extra = {}) => O.processDocument({
  document: { id: 'doc-1' },
  extraction: X.extractFromText(text, extra.extractOpts || {}),
  businessName: US,
  counterparties: extra.counterparties || [],
  existingLinks: extra.existingLinks || {},
  taxRules: extra.taxRules || [],
});

// ── 1 & 2. direction from issuer/recipient ─────────────────────────────────
t('1. a supplier invoice becomes a payable', () => {
  const r = run(SUPPLIER_INVOICE);
  assert.strictEqual(r.document.type, 'invoice');
  assert.strictEqual(r.document.direction, 'payable');
  assert.strictEqual(r.financial_record.suggested_record_type, 'payable');
  assert.strictEqual(r.financial_record.amount, 25000000);
});

t('2. a customer invoice becomes a receivable', () => {
  const r = run(CUSTOMER_INVOICE);
  assert.strictEqual(r.document.direction, 'receivable');
  assert.strictEqual(r.financial_record.suggested_record_type, 'receivable');
  assert.strictEqual(r.financial_record.amount, 8500000);
});

t('direction comes from the parties, not the file name', () => {
  // A file called "customer invoice" that is in fact a bill TO us stays a payable.
  const r = run(SUPPLIER_INVOICE, { extractOpts: { file_name: 'customer-invoice-receivable.pdf' } });
  assert.strictEqual(r.document.direction, 'payable');
});

// ── 3. tax ─────────────────────────────────────────────────────────────────
t('3. a faktur pajak reports PPN and still requires accountant review', () => {
  const r = run(FAKTUR);
  assert.strictEqual(r.document.type, 'faktur_pajak');
  assert.strictEqual(r.tax.ppn_detected, true);
  assert.strictEqual(r.tax.ppn_amount, 1100000);
  assert.strictEqual(r.tax.tax_status, 'tax_detected');
  assert.strictEqual(r.tax.accountant_review_required, true);
  assert.strictEqual(r.tax.withholding_status, 'needs_review');
});

t('17. no verified rule means no withholding is suggested', () => {
  const r = run(FAKTUR, { taxRules: [] });
  assert.strictEqual(r.tax.withholding_status, 'needs_review');
  assert.ok(r.tax.notes.some((n) => /No verified rule/i.test(n)));
});

t('19. an under-review rule is quoted with its status and never becomes final', () => {
  const r = run(FAKTUR, { taxRules: [
    { rule_code: 'ID_PPH42_RENT', rate: 0.1, citation: 'PP 34/2017', status: 'under_review', effective_active: false },
  ] });
  assert.strictEqual(r.tax.withholding_status, 'needs_review');
  assert.strictEqual(r.tax.rule_status, 'under_review');
  assert.strictEqual(r.tax.rule_citation, 'PP 34/2017');
  assert.strictEqual(r.tax.withholding_suggestion, null, 'an unverified rule must not produce a number');
  assert.strictEqual(r.tax.accountant_review_required, true);
});

t('18. a verified active rule may suggest, with its citation, review still required', () => {
  const r = run(FAKTUR, { taxRules: [
    { rule_code: 'ID_PPH42_RENT', rate: 0.1, citation: 'PP 34/2017 Pasal 4', status: 'active', effective_active: true },
  ] });
  assert.strictEqual(r.tax.withholding_status, 'suggested');
  assert.strictEqual(r.tax.rule_status, 'active_verified');
  assert.strictEqual(r.tax.withholding_suggestion.rate, 0.1);
  assert.strictEqual(r.tax.accountant_review_required, true, 'even a verified rule keeps the accountant');
});

// ── 4 & 5. payments ────────────────────────────────────────────────────────
t('4. an outgoing payment is recognised from whose account it left', () => {
  const r = run(OUTGOING_PROOF);
  assert.strictEqual(r.document.type, 'payment_proof');
  assert.strictEqual(r.document.direction, 'outgoing_payment');
  assert.strictEqual(r.counterparty.suggested_role, 'vendor');
  assert.strictEqual(r.financial_record.amount, 25000000);
});

t('5. an incoming payment suggests a customer', () => {
  const r = run(INCOMING_PROOF);
  assert.strictEqual(r.document.direction, 'incoming_payment');
  assert.strictEqual(r.counterparty.suggested_role, 'customer');
  assert.strictEqual(r.financial_record.amount, 8500000);
});

t('a payment between two unrelated parties is needs_review, not a guess', () => {
  const r = run(OUTGOING_PROOF.replace('PT HELM CARE INDONESIA', 'PT SOMEONE ELSE'));
  assert.strictEqual(r.document.direction, 'unknown');
  assert.strictEqual(r.status, 'needs_accountant_review');
  assert.ok(r.blockers.some((b) => /Confirm which side is ours/i.test(b)));
});

// ── 6. unreadable ──────────────────────────────────────────────────────────
t('6. a scan with no text is unsupported and invents nothing', () => {
  const r = run('', { extractOpts: { text_available: false, extraction_reason: 'no_embedded_text' } });
  assert.strictEqual(r.status, 'unsupported');
  assert.strictEqual(r.financial_record.amount, null);
  assert.strictEqual(r.financial_record.can_create_draft, false);
  assert.strictEqual(r.counterparty.suggested_counterparty, null);
  assert.ok(r.blockers.some((b) => /OCR\/Vision/i.test(b)));
  // and it is still actionable rather than dead
  assert.ok(r.next_actions.some((a) => a.key === 'enter_manually' && a.enabled));
});

// ── 7 & 8. incomplete ──────────────────────────────────────────────────────
t('7. an invoice with no readable amount cannot draft a payable', () => {
  const r = run(SUPPLIER_INVOICE.replace('Netto 25.000.000', ''));
  assert.strictEqual(r.status, 'needs_missing_fields');
  assert.strictEqual(r.financial_record.can_create_draft, false);
  assert.ok(r.missing_fields.includes('amount') || r.missing_fields.includes('gross_amount'));
  const draft = r.next_actions.find((a) => a.key === 'create_payable_draft');
  assert.ok(draft && draft.enabled === false, 'the draft action must be offered but disabled');
});

t('8. a priced invoice with an unknown counterparty is needs_counterparty', () => {
  const r = run(SUPPLIER_INVOICE, { counterparties: [] });
  assert.strictEqual(r.counterparty.status, 'not_found');
  assert.strictEqual(r.status, 'needs_counterparty');
  assert.strictEqual(r.financial_record.can_create_draft, false, 'no draft before we know who with');
  assert.ok(r.next_actions.some((a) => a.key === 'create_counterparty' && a.enabled));
});

// ── 9, 10, 11, 12. counterparty resolution ─────────────────────────────────
const KNOWN = [{
  id: 'cp-1', legal_name: 'PT Sumber Makmur Sentosa', npwp: '01.222.333.4-555.666',
  bank_accounts: [{ account_number: '555-6667778' }], status: 'active',
}];

t('9. a known counterparty matched by NPWP unlocks the draft', () => {
  const withNpwp = SUPPLIER_INVOICE.replace('Dari : PT Sumber Makmur Sentosa',
    'Dari : PT Sumber Makmur Sentosa\nNPWP : 01.222.333.4-555.666');
  const r = run(withNpwp, { counterparties: KNOWN });
  assert.strictEqual(r.counterparty.status, 'matched');
  assert.strictEqual(r.counterparty.matched_counterparty_id, 'cp-1');
  assert.strictEqual(r.status, 'ready_to_confirm');
  assert.strictEqual(r.financial_record.can_create_draft, true);
});

t('10. a payment proof matches the counterparty by bank account', () => {
  const r = run(OUTGOING_PROOF, { counterparties: KNOWN });
  assert.strictEqual(r.counterparty.status, 'matched');
  assert.strictEqual(r.counterparty.matched_counterparty_id, 'cp-1');
});

t('11. a name-only match never auto-links, and blocks the draft', () => {
  const r = run(SUPPLIER_INVOICE, { counterparties: KNOWN });
  assert.strictEqual(r.counterparty.status, 'possible_match');
  assert.strictEqual(r.counterparty.matched_counterparty_id, null);
  assert.strictEqual(r.status, 'needs_counterparty');
  assert.strictEqual(r.financial_record.can_create_draft, false);
  assert.ok(r.next_actions.some((a) => a.key === 'review_counterparty_match'));
});

t('12. a counterparty suggestion is only ever a suggestion', () => {
  const r = run(SUPPLIER_INVOICE, { counterparties: [] });
  assert.ok(r.counterparty.suggested_counterparty);
  assert.strictEqual(r.requires_confirmation, true);
  // nothing in the result claims anything was made
  assert.strictEqual(r.financial_record.can_create_draft, false);
});

// ── supporting documents ───────────────────────────────────────────────────
t('a contract is supporting evidence, never a payable', () => {
  const r = run(CONTRACT);
  assert.strictEqual(r.document.type, 'contract');
  assert.strictEqual(r.document.direction, 'supporting_document');
  assert.strictEqual(r.financial_record.suggested_record_type, 'supporting_document');
  assert.strictEqual(r.financial_record.can_create_draft, false);
  assert.strictEqual(r.status, 'ready_to_confirm');
});

t('a bank statement is supporting evidence too', () => {
  const r = run(BANK_STATEMENT);
  assert.strictEqual(r.document.type, 'bank_statement');
  assert.strictEqual(r.financial_record.suggested_record_type, 'supporting_document');
});

t('an unrecognised document goes to accountant review, claiming nothing', () => {
  const r = run('Some prose with no financial vocabulary whatsoever.');
  assert.strictEqual(r.document.type, 'unknown');
  assert.strictEqual(r.status, 'needs_accountant_review');
  assert.strictEqual(r.financial_record.suggested_record_type, 'none');
  assert.strictEqual(r.financial_record.can_create_draft, false);
});

// ── linked and idempotency ─────────────────────────────────────────────────
t('a document already linked to a record reports linked', () => {
  const r = run(SUPPLIER_INVOICE, { counterparties: KNOWN, existingLinks: { debt_ids: [42] } });
  assert.strictEqual(r.status, 'linked');
});

t('22. repeated processing is stable', () => {
  const a = run(FAKTUR, { counterparties: KNOWN });
  const b = run(FAKTUR, { counterparties: KNOWN });
  assert.deepStrictEqual(a, b, 'the pipeline must be deterministic');
  assert.ok(O.sameIntake(O.toStoredIntake(a), O.toStoredIntake(b)),
    'the stored summary must be identical apart from the timestamp');
});

t('the stored summary carries no financial record, only review state', () => {
  const stored = O.toStoredIntake(run(SUPPLIER_INVOICE, { counterparties: KNOWN }));
  assert.strictEqual(stored.version, 'intake-v1');
  assert.ok('status' in stored && 'suggested_record_type' in stored);
  for (const forbidden of ['debt_id', 'transaction_id', 'counterparty_created', 'paid']) {
    assert.ok(!(forbidden in stored), `stored intake must not contain ${forbidden}`);
  }
});

t('every status returned is from the closed set', () => {
  for (const text of [SUPPLIER_INVOICE, CUSTOMER_INVOICE, FAKTUR, OUTGOING_PROOF,
    INCOMING_PROOF, CONTRACT, BANK_STATEMENT, 'nothing here']) {
    const r = run(text);
    assert.ok(O.STATUSES.includes(r.status), `${r.status} is not a known status`);
  }
});

t('no result ever claims to have created anything', () => {
  for (const text of [SUPPLIER_INVOICE, FAKTUR, OUTGOING_PROOF, CONTRACT]) {
    const r = run(text, { counterparties: KNOWN });
    assert.strictEqual(r.requires_confirmation, true);
    assert.strictEqual(typeof r.financial_record.can_create_draft, 'boolean');
    assert.strictEqual(r.tax.accountant_review_required, true);
  }
});

console.log(`\n${pass} passed`);
