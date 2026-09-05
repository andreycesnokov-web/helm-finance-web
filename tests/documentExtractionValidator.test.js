// The validator: accept, warn, require confirmation, reject — and never invent.
// Run: node tests/documentExtractionValidator.test.js
const assert = require('node:assert');
const { validateExtraction, assessIndonesianVat, STATUS } = require('../server/lib/documentExtractionValidator');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const BUSINESS = { legal_name: 'PT Helm Care Indonesia', display_name: 'Helm Care Indonesia',
  npwp: '09.876.543.2-101.000', aliases: ['HELM CARE'] };

const ev = (page, text, section) => [{ page, printed_text: text, section }];
const f = (value, evidence = [], confidence = 0.95) => ({ value, confidence, evidence });
const amt = (value, evidence = [], calculated = false) => ({ value, calculated, confidence: 0.95, evidence });
const dt = (value, printed, evidence = []) => ({ value, printed_text: printed, confidence: 0.95, evidence });

const supplier = {
  party_id: 'party_1', role: 'supplier',
  legal_name: f('PT SUMBER ALFARIA TRIJAYA TBK', ev(1, 'PT SUMBER ALFARIA TRIJAYA TBK', 'issuer_header')),
  npwp: { value: '01.336.238.9-054.000', normalized_value: '013362389054000', confidence: 0.96,
    evidence: ev(1, 'NPWP: 01.336.238.9-054.000', 'issuer_header') },
  address: f(null), bank_accounts: [],
};
const us = {
  party_id: 'party_2', role: 'buyer',
  legal_name: f('PT HELM CARE INDONESIA', ev(1, 'PT HELM CARE INDONESIA', 'buyer_header')),
  npwp: { value: '09.876.543.2-101.000', normalized_value: '098765432101000', confidence: 0.96,
    evidence: ev(1, 'NPWP: 09.876.543.2-101.000', 'buyer_header') },
  address: f(null), bank_accounts: [],
};

const base = (over = {}) => ({
  schema_version: 'financial_document_extraction_v3',
  document_type: f('faktur_pajak', ev(1, 'Faktur Pajak', 'title')),
  document_number: f('X2610001139'),
  parties: [supplier, us],
  current_business_party_id: 'party_2',
  counterparty_candidate_party_id: 'party_1',
  relationship_confidence: 0.97,
  dates: {
    document_date: dt('2026-08-04', '04 Agustus 2026', ev(1, 'Tanggal: 04 Agustus 2026')),
    due_date: dt(null, null), payment_date: dt(null, null),
  },
  amounts: {
    currency: 'IDR',
    dpp: amt(10200000, ev(1, 'Dasar Pengenaan Pajak 10.200.000')),
    ppn: amt(1122000, ev(1, 'Jumlah PPN 1.122.000')),
    total: amt(11322000, ev(1, 'Netto 11.322.000')),
  },
  warnings: [], pages_analyzed: [1], page_count: 1, analysis_complete: true,
  ...over,
});

const ctx = { business: BUSINESS, pagesProvided: 1, uploadedAt: '2026-09-05T08:00:00Z' };

console.log('\nThe good case');
t('a clean faktur pajak validates and keeps every relationship', () => {
  const r = validateExtraction(base(), ctx);
  assert.strictEqual(r.status, STATUS.OK, JSON.stringify(r.checks.filter((c) => !c.pass)));
  assert.strictEqual(r.counterparty_status, 'ok');
  assert.strictEqual(r.can_create_counterparty, true);
  // 7/8 — the counterparty is the supplier, carrying the SUPPLIER's npwp
  assert.strictEqual(r.normalized.counterparty.legal_name, 'PT SUMBER ALFARIA TRIJAYA TBK');
  assert.strictEqual(r.normalized.counterparty.npwp, '01.336.238.9-054.000');
  assert.notStrictEqual(r.normalized.counterparty.npwp, '09.876.543.2-101.000');
  // 17 — three distinct money fields
  assert.strictEqual(r.normalized.dpp, 10200000);
  assert.strictEqual(r.normalized.ppn, 1122000);
  assert.strictEqual(r.normalized.total, 11322000);
});

console.log('\n3/12. the business is never its own counterparty');
t('3/12. a self-match is a blocker, whatever the model concluded', () => {
  const r = validateExtraction(base({ counterparty_candidate_party_id: 'party_2' }), ctx);
  assert.strictEqual(r.counterparty_status, 'self_match');
  assert.strictEqual(r.can_create_counterparty, false);
  assert.strictEqual(r.can_create_financial_record, false);
  assert.ok(r.blockers.some((b) => /your own company/i.test(b)), r.blockers.join(' | '));
  assert.strictEqual(r.normalized.counterparty, null, 'no profile may be offered');
});

t('11. matching on NPWP alone catches a differently-spelled self-match', () => {
  const twin = { ...supplier, party_id: 'party_3',
    legal_name: f('SOME OTHER TRADING NAME', ev(1, 'SOME OTHER TRADING NAME', 'header')),
    npwp: { value: '09.876.543.2-101.000', normalized_value: '098765432101000', confidence: 0.9,
      evidence: ev(1, 'NPWP: 09.876.543.2-101.000', 'header') } };
  const r = validateExtraction(base({ parties: [twin, us], counterparty_candidate_party_id: 'party_3' }), ctx);
  assert.strictEqual(r.counterparty_status, 'self_match', 'the tax number is decisive');
});

t('10. an alias identifies the business too', () => {
  const aliasParty = { ...supplier, party_id: 'party_4',
    legal_name: f('HELM CARE', ev(1, 'HELM CARE', 'header')), npwp: { value: null, normalized_value: null, confidence: 0, evidence: [] } };
  const r = validateExtraction(base({ parties: [aliasParty, us], counterparty_candidate_party_id: 'party_4' }), ctx);
  assert.strictEqual(r.counterparty_status, 'self_match');
});

console.log('\n4/8. cross-party pairing');
t('4/8. a name and an NPWP read from different places is flagged', () => {
  const mixed = { ...supplier,
    npwp: { value: '01.336.238.9-054.000', normalized_value: '013362389054000', confidence: 0.5,
      evidence: ev(2, 'NPWP: 01.336.238.9-054.000', 'buyer_header') } };  // other page AND other section
  const r = validateExtraction(base({ parties: [mixed, us] }), ctx);
  assert.strictEqual(r.status, STATUS.NEEDS_REVIEW);
  assert.ok(r.warnings.some((w) => /different\s+places/i.test(w)), r.warnings.join(' | '));
});

t('an implausible NPWP is reported rather than used silently', () => {
  const bad = { ...supplier, npwp: { value: '123', normalized_value: '123', confidence: 0.4, evidence: ev(1, 'NPWP: 123', 'issuer_header') } };
  const r = validateExtraction(base({ parties: [bad, us] }), ctx);
  assert.ok(r.warnings.some((w) => /valid tax number/i.test(w)), r.warnings.join(' | '));
});

console.log('\n14/15/16. dates');
t('14/15. the three dates stay separate', () => {
  const r = validateExtraction(base({ dates: {
    document_date: dt('2026-08-04', '04 Agustus 2026', ev(1, 'Tanggal')),
    due_date: dt('2026-09-03', '03 September 2026', ev(1, 'Jatuh Tempo')),
    payment_date: dt(null, null),
  } }), ctx);
  assert.strictEqual(r.normalized.document_date, '2026-08-04');
  assert.strictEqual(r.normalized.due_date, '2026-09-03');
  assert.strictEqual(r.normalized.payment_date, null);
});

t('16. a document date equal to the upload date with no printed text is challenged', () => {
  const r = validateExtraction(base({ dates: {
    document_date: dt('2026-09-05', null, []),      // = uploadedAt, and nothing printed
    due_date: dt(null, null), payment_date: dt(null, null),
  } }), ctx);
  assert.ok(r.warnings.some((w) => /matches the upload date/i.test(w)), r.warnings.join(' | '));
});

t('7. a due date before the document date is a contradiction, not a correction', () => {
  const r = validateExtraction(base({ dates: {
    document_date: dt('2026-08-04', '04 Agustus 2026'),
    due_date: dt('2026-07-01', '01 Juli 2026'), payment_date: dt(null, null),
  } }), ctx);
  assert.ok(r.warnings.some((w) => /before the document date/i.test(w)), r.warnings.join(' | '));
  // and neither date was rewritten
  assert.strictEqual(r.normalized.document_date, '2026-08-04');
  assert.strictEqual(r.normalized.due_date, '2026-07-01');
});

console.log('\n10/17/18. money');
t('10. arithmetic is checked and reported, never repaired', () => {
  const r = validateExtraction(base({ amounts: {
    currency: 'IDR', dpp: amt(10200000, ev(1, 'DPP')), ppn: amt(1122000, ev(1, 'PPN')),
    total: amt(99999999, ev(1, 'Total')),
  } }), ctx);
  assert.ok(r.warnings.some((w) => /does not equal the total/i.test(w)), r.warnings.join(' | '));
  assert.strictEqual(r.normalized.total, 99999999, 'the printed total is preserved, not corrected');
  assert.strictEqual(r.normalized.dpp, 10200000);
});

t('18. a PPN the model admits it calculated is not presented as printed', () => {
  const r = validateExtraction(base({ amounts: {
    currency: 'IDR', dpp: amt(null), ppn: amt(1122000, [], true), total: amt(11322000, ev(1, 'Total')),
  } }), ctx);
  assert.ok(r.warnings.some((w) => /calculated, not read/i.test(w)), r.warnings.join(' | '));
});

t('a PPN with no evidence at all is challenged', () => {
  const r = validateExtraction(base({ amounts: {
    currency: 'IDR', dpp: amt(null), ppn: amt(1122000, []), total: amt(11322000, ev(1, 'Total')),
  } }), ctx);
  assert.ok(r.warnings.some((w) => /no evidence of where it was printed/i.test(w)), r.warnings.join(' | '));
});

t('8. an unsupported currency is reported', () => {
  const r = validateExtraction(base({ amounts: { currency: 'XBT', dpp: amt(null), ppn: amt(null), total: amt(1, ev(1, 'x')) } }), ctx);
  assert.ok(r.warnings.some((w) => /not supported/i.test(w)), r.warnings.join(' | '));
});

t('9. a negative amount is reported', () => {
  const r = validateExtraction(base({ amounts: { currency: 'IDR', dpp: amt(-5, ev(1, 'x')), ppn: amt(null), total: amt(10, ev(1, 'y')) } }), ctx);
  assert.ok(r.warnings.some((w) => /cannot be negative/i.test(w)), r.warnings.join(' | '));
});

console.log('\n11/19/20. what may follow');
t('19. a receipt never permits a financial record', () => {
  for (const type of ['receipt', 'kwitansi', 'payment_proof']) {
    const r = validateExtraction(base({ document_type: f(type, ev(1, type)) }), ctx);
    assert.strictEqual(r.can_create_financial_record, false, `${type} must not draft a record`);
    assert.ok(r.warnings.some((w) => /already moved/i.test(w)), `${type}: ${r.warnings.join(' | ')}`);
  }
});

t('20. no counterparty means no financial record', () => {
  const r = validateExtraction(base({ counterparty_candidate_party_id: null }), ctx);
  assert.strictEqual(r.can_create_financial_record, false);
  assert.ok(r.blockers.some((b) => /counterparty is not resolved/i.test(b)), r.blockers.join(' | '));
});

t('no amount means no financial record', () => {
  const r = validateExtraction(base({ amounts: { currency: 'IDR', dpp: amt(null), ppn: amt(null), total: amt(null) } }), ctx);
  assert.strictEqual(r.can_create_financial_record, false);
  assert.ok(r.blockers.some((b) => /No amount/i.test(b)), r.blockers.join(' | '));
});

console.log('\nPartial and malformed');
t('15. a partly-read document needs review', () => {
  const r = validateExtraction(base({ analysis_complete: false }), ctx);
  assert.strictEqual(r.status, STATUS.NEEDS_REVIEW);
  assert.ok(r.warnings.some((w) => /only partly analysed/i.test(w)), r.warnings.join(' | '));
});

t('fewer pages read than provided is reported', () => {
  const r = validateExtraction(base({ pages_analyzed: [1] }), { ...ctx, pagesProvided: 4 });
  assert.ok(r.warnings.some((w) => /1 of 4 pages/i.test(w)), r.warnings.join(' | '));
});

t('6. a malformed extraction is rejected, not patched', () => {
  for (const bad of [null, undefined, 'nope', 42]) {
    const r = validateExtraction(bad, ctx);
    assert.strictEqual(r.status, STATUS.REJECTED);
    assert.strictEqual(r.can_create_financial_record, false);
    assert.strictEqual(r.normalized, null);
  }
});

t('the validator never adds an accounting fact of its own', () => {
  const sparse = base({ amounts: { currency: 'IDR', dpp: amt(null), ppn: amt(null), total: amt(null) },
    dates: { document_date: dt(null, null), due_date: dt(null, null), payment_date: dt(null, null) } });
  const r = validateExtraction(sparse, ctx);
  for (const k of ['dpp', 'ppn', 'total', 'document_date', 'due_date', 'payment_date']) {
    assert.strictEqual(r.normalized[k], null, `${k} must stay null — the validator invents nothing`);
  }
});

console.log('\nIndonesian VAT — DPP Nilai Lain 11/12');

// The reference document. The commercial base is 10,200,000; the taxable base is
// deliberately smaller. DPP + PPN is 10,472,000, which is NOT the 11,322,000 payable —
// and that is correct, not a discrepancy.
const nilaiLain = (over = {}) => base({
  amounts: {
    currency: 'IDR',
    subtotal: amt(10200000, ev(1, 'Harga Jual 10.200.000')),
    dpp_nilai_lain: amt(9350000, ev(1, 'DPP Nilai Lain 9.350.000')),
    dpp: amt(9350000, ev(1, 'Dasar Pengenaan Pajak 9.350.000')),
    ppn: amt(1122000, ev(1, 'PPN 12% 1.122.000')),
    total: amt(11322000, ev(1, 'Jumlah 11.322.000')),
    ...(over.amounts || {}),
  },
});

t('the reference faktur is NOT reported as a discrepancy', () => {
  const r = validateExtraction(nilaiLain(), ctx);
  const consistency = r.checks.find((c) => c.id === 'amount.consistency');
  assert.ok(consistency, 'the consistency check should still run');
  assert.strictEqual(consistency.pass, true, consistency.detail || '');
  assert.ok(!r.warnings.some((w) => /does not equal the total/i.test(w)),
    `no discrepancy may be raised: ${r.warnings.join(' | ')}`);
  assert.strictEqual(r.tax_shape, 'nilai_lain_11_12');
});

t('the printed figures survive unchanged — nothing is recomputed', () => {
  const r = validateExtraction(nilaiLain(), ctx);
  assert.strictEqual(r.normalized.subtotal, 10200000);
  assert.strictEqual(r.normalized.dpp_nilai_lain, 9350000);
  assert.strictEqual(r.normalized.ppn, 1122000);
  assert.strictEqual(r.normalized.total, 11322000);
});

t('the arithmetic is stated back to the user rather than hidden', () => {
  const r = validateExtraction(nilaiLain(), ctx);
  const note = r.warnings.find((w) => /reduced taxable base/i.test(w));
  assert.ok(note, `the user must be told what was checked: ${r.warnings.join(' | ')}`);
  for (const n of ['10200000', '9350000', '1122000', '11322000']) {
    assert.ok(note.includes(n), `the note should show ${n}: ${note}`);
  }
});

t('the note stays an arithmetic observation, never a tax determination', () => {
  // The KB holds this construction as an UNREVIEWED candidate with an unread amendment.
  // The validator may say the numbers agree; it may not endorse a rate or state liability.
  const note = validateExtraction(nilaiLain(), ctx).warnings.find((w) => /taxable base/i.test(w));
  assert.ok(/not a tax determination/i.test(note), note);
  for (const forbidden of [/tax owed/i, /you owe/i, /must pay/i, /correct rate/i, /approved/i]) {
    assert.ok(!forbidden.test(note), `the note must not assert ${forbidden}: ${note}`);
  }
});

t('the 11/12 rule is NOT applied to an ordinary faktur', () => {
  const r = validateExtraction(base({
    amounts: { currency: 'IDR', subtotal: amt(25000000), dpp: amt(25000000),
      ppn: amt(2750000), total: amt(27750000) },
  }), ctx);
  assert.strictEqual(r.tax_shape, 'standard');
  assert.strictEqual(r.checks.find((c) => c.id === 'amount.consistency').pass, true);
});

t('the rule cannot excuse figures that genuinely do not add up', () => {
  // 9,000,000 is neither 10,200,000 x 11/12 nor a base for a 1,122,000 PPN at 12%.
  const r = validateExtraction(nilaiLain({ amounts: { dpp_nilai_lain: amt(9000000), dpp: amt(9000000) } }), ctx);
  assert.strictEqual(r.tax_shape, 'standard');
  assert.ok(r.warnings.some((w) => /does not equal the total/i.test(w)),
    'a real discrepancy must still be raised');
});

t('a taxable base equal to the commercial base is an ordinary faktur, not this shape', () => {
  assert.strictEqual(assessIndonesianVat({
    subtotal: 9350000, dpp: 9350000, nilaiLain: 9350000, ppn: 1122000, total: 10472000,
  }).shape, 'standard');
});

t('a faktur that prints no total is still recognised — real ones often do not', () => {
  // The actual customer faktur pajak checked on 2026-09-05 prints Harga Jual, DPP Nilai
  // Lain and PPN and stops. Requiring a grand total would leave the commonest real shape
  // unexplained, so the total is checked when present and not required when absent.
  const real = assessIndonesianVat({
    subtotal: 10200000, dpp: 9350000, nilaiLain: 9350000, ppn: 1122000, total: null,
  });
  assert.strictEqual(real.shape, 'nilai_lain_11_12');
  assert.ok(!/payable/.test(real.note), 'a total nobody printed must not appear in the note');
});

t('a printed total that contradicts the figures still refuses the rule', () => {
  assert.strictEqual(assessIndonesianVat({
    subtotal: 10200000, dpp: 9350000, nilaiLain: 9350000, ppn: 1122000, total: 99999999,
  }).shape, 'standard');
});

t('figures too incomplete to check fall back to the ordinary check', () => {
  const full = { subtotal: 10200000, dpp: 9350000, nilaiLain: 9350000, ppn: 1122000, total: 11322000 };
  // no PPN: there is no second identity to test
  assert.strictEqual(assessIndonesianVat({ ...full, ppn: null }).shape, 'standard');
  // no subtotal and no total: the commercial base cannot be established at all
  assert.strictEqual(assessIndonesianVat({ ...full, subtotal: null, total: null }).shape, 'standard');
});

t('the taxable base may be carried in dpp alone, as most fakturs print it', () => {
  assert.strictEqual(assessIndonesianVat({
    subtotal: 10200000, dpp: 9350000, nilaiLain: null, ppn: 1122000, total: 11322000,
  }).shape, 'nilai_lain_11_12');
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
