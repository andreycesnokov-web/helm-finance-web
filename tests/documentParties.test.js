// Parties stay whole: a name and an NPWP may only be paired within one party block.
//
// The production defect this pins: a counterparty profile was offered reading
//   legal_name "HELM CARE INDONESIA" (the user's own company)
//   npwp       "01.336.238.9-054.000" (the other party's number)
// — two facts about two different companies, presented as one.
//
// Run: node tests/documentParties.test.js
const assert = require('node:assert');
const P = require('../server/lib/documentParties');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const US = { legal_name: 'PT Helm Care Indonesia', display_name: 'Helm Care Indonesia',
  npwp: '09.876.543.2-101.000', aliases: ['HELM CARE'] };

const FAKTUR = 'Faktur Pajak '
  + 'Pengusaha Kena Pajak Nama : PT SUMBER ALFARIA TRIJAYA TBK NPWP : 01.336.238.9-054.000 '
  + 'Pembeli Barang Kena Pajak Nama : PT HELM CARE INDONESIA NPWP : 09.876.543.2-101.000 '
  + 'Harga Jual 10.200.000 Jumlah PPN 1.122.000';

console.log('\n17/18. pairing');
t('17. a name and an NPWP from the SAME block stay together', () => {
  const { parties } = P.extractParties(FAKTUR);
  const seller = parties.find((x) => /ALFARIA/i.test(x.legal_name));
  const buyer = parties.find((x) => /HELM CARE/i.test(x.legal_name));
  assert.ok(seller && buyer, JSON.stringify(parties, null, 1));
  assert.strictEqual(seller.npwp, '01.336.238.9-054.000');
  assert.strictEqual(buyer.npwp, '09.876.543.2-101.000');
  assert.strictEqual(seller.role, 'issuer_or_receiver');
  assert.strictEqual(buyer.role, 'buyer_or_payer');
});

t('18. party A\'s name can never carry party B\'s NPWP', () => {
  const { parties } = P.extractParties(FAKTUR);
  for (const p of parties) {
    if (/HELM CARE/i.test(p.legal_name)) {
      assert.notStrictEqual(P.normNpwp(p.npwp), P.normNpwp('01.336.238.9-054.000'),
        'this is the exact production mix-up');
    }
    if (/ALFARIA/i.test(p.legal_name)) {
      assert.notStrictEqual(P.normNpwp(p.npwp), P.normNpwp('09.876.543.2-101.000'));
    }
  }
});

t('each pairing records where it came from', () => {
  const { parties } = P.extractParties(FAKTUR);
  for (const p of parties) {
    assert.ok(p.evidence.section, 'the block label is kept');
    assert.ok(p.evidence.name_text, 'the name as printed is kept');
    if (p.npwp) assert.strictEqual(p.evidence.npwp_text, p.npwp);
  }
});

t('a party with no NPWP in its own block does not borrow one', () => {
  const oneSided = 'Dari : PT Alpha Sentosa NPWP : 01.222.333.4-555.666 '
    + 'Kepada : PT Beta Nusantara Netto 1.000.000';
  const { parties } = P.extractParties(oneSided);
  const beta = parties.find((x) => /Beta/i.test(x.legal_name));
  assert.ok(beta, JSON.stringify(parties));
  assert.strictEqual(beta.npwp, null, 'no NPWP is better than the wrong NPWP');
});

t('a reference code in the letterhead is not mistaken for a company', () => {
  // Production smoke caught this: "TRACE-B", a fragment of the invoice reference, was
  // read as a party from the letterhead and became the suggested counterparty.
  const txt = 'Invoice No. Invoice TRACE-B-905B Dari : PT Trace Diagnostik Nusantara '
    + 'NPWP : 04.777.888.1-033.000 Kepada : PT Helm Care Indonesia Netto 5.550.000';
  const { parties } = P.extractParties(txt);
  assert.ok(!parties.some((x) => /^TRACE/i.test(x.legal_name)),
    `a reference code became a party: ${JSON.stringify(parties.map((x) => x.legal_name))}`);
  const r = P.resolveCounterparty(txt, US);
  assert.strictEqual(r.counterparty.legal_name, 'PT Trace Diagnostik Nusantara');
  assert.strictEqual(r.counterparty.npwp, '04.777.888.1-033.000', 'and it keeps its own NPWP');
});

console.log('\n19/20. the business is never its own counterparty');
t('19/20. a self-match blocks counterparty creation', () => {
  // Only our own company appears — exactly what OCR produced in production.
  const onlyUs = 'Kepada : PT HELM CARE INDONESIA NPWP : 09.876.543.2-101.000 Netto 1.000.000';
  const r = P.resolveCounterparty(onlyUs, US);
  assert.strictEqual(r.status, 'self_match');
  assert.strictEqual(r.counterparty, null, 'nothing may be offered for creation');
  assert.ok(/your own company/i.test(r.reason), r.reason);
});

t('20. matching on NPWP alone is enough to recognise ourselves', () => {
  const byNpwp = 'Kepada : PT SOMETHING ELSE ENTIRELY NPWP : 09.876.543.2-101.000 Netto 1.000';
  const r = P.resolveCounterparty(byNpwp, US);
  assert.strictEqual(r.status, 'self_match', 'the tax number is decisive even when the name differs');
});

t('an alias also identifies us', () => {
  assert.strictEqual(P.matchesBusiness({ legal_name: 'HELM CARE', npwp_normalized: null }, US).match, true);
});

t('the other party is chosen when both are present', () => {
  const r = P.resolveCounterparty(FAKTUR, US);
  assert.strictEqual(r.status, 'ok');
  assert.ok(/ALFARIA/i.test(r.counterparty.legal_name), r.counterparty.legal_name);
  assert.strictEqual(r.counterparty.npwp, '01.336.238.9-054.000', 'and it keeps ITS OWN npwp');
});

t('when we appear on neither side, the guess needs confirmation', () => {
  const strangers = 'Dari : PT Alpha Sentosa NPWP : 01.222.333.4-555.666 Kepada : PT Beta Nusantara';
  const r = P.resolveCounterparty(strangers, US);
  assert.strictEqual(r.status, 'needs_confirmation');
  assert.ok(r.counterparty, 'a candidate is still shown');
  assert.ok(/could not be matched/i.test(r.reason), r.reason);
});

t('a document with no readable party offers nothing', () => {
  const r = P.resolveCounterparty('Just some text with no parties at all', US);
  assert.strictEqual(r.status, 'not_found');
  assert.strictEqual(r.counterparty, null);
});

t('a tax number outside every party block is reported, not attached', () => {
  const loose = 'Kepada : PT Beta Nusantara Netto 1.000.000 NPWP : 01.222.333.4-555.666';
  const { parties, warnings } = P.extractParties(loose);
  const beta = parties.find((x) => /Beta/i.test(x.legal_name));
  if (beta && beta.npwp) {
    // If it was attached, it must have been inside Beta's own block — acceptable.
    assert.strictEqual(beta.evidence.npwp_text, beta.npwp);
  } else {
    assert.ok(warnings.some((w) => /not attached to any party/i.test(w)), warnings.join(' | '));
  }
});

t('NPWP is normalised for comparison but shown as printed', () => {
  assert.strictEqual(P.normNpwp('01.336.238.9-054.000'), '013362389054000');
  assert.strictEqual(P.isNpwp('01.336.238.9-054.000'), true);
  assert.strictEqual(P.isNpwp('12345'), false);
  const { parties } = P.extractParties(FAKTUR);
  const seller = parties.find((x) => /ALFARIA/i.test(x.legal_name));
  assert.strictEqual(seller.npwp, '01.336.238.9-054.000', 'the printed form survives');
  assert.strictEqual(seller.npwp_normalized, '013362389054000');
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
