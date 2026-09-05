// The validator: accept, warn, require confirmation, reject — and never invent.
// Run: node tests/documentExtractionValidator.test.js
const assert = require('node:assert');
const { validateExtraction, STATUS } = require('../server/lib/documentExtractionValidator');

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

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
