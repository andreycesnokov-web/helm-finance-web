// Telling a document's dates apart: issued, due, paid.
// Run: node tests/documentDates.test.js
const assert = require('node:assert');
const D = require('../server/lib/documentDates');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

console.log('\n11/12. roles');
t('11. an invoice issue date is read as document_date', () => {
  const r = D.extractDates('Invoice INV-2026-001 Tanggal : 15 Agustus 2026 Netto 5.000.000',
    { document_type: 'invoice' });
  assert.strictEqual(r.document_date.value, '2026-08-15');
  assert.strictEqual(r.document_date.status, 'detected');
});

t('12. a due date is NOT mistaken for the document date', () => {
  const r = D.extractDates(
    'Invoice INV-2026-001 Tanggal : 15 Agustus 2026 Jatuh Tempo : 14 September 2026',
    { document_type: 'invoice' });
  assert.strictEqual(r.document_date.value, '2026-08-15');
  assert.strictEqual(r.due_date.value, '2026-09-14');
  assert.notStrictEqual(r.document_date.value, r.due_date.value);
});

t('a due date alone does not become the document date', () => {
  const r = D.extractDates('Invoice INV-9 Jatuh Tempo : 14 September 2026', { document_type: 'invoice' });
  assert.strictEqual(r.due_date.value, '2026-09-14');
  assert.strictEqual(r.document_date.status, 'not_found',
    'a payment deadline is not an issue date');
});

t('13. a receipt payment date is its own field', () => {
  const r = D.extractDates(
    'KWITANSI Sudah terima dari PT X Tanggal Transfer : 04 September 2026 Jumlah Rp 1.000.000',
    { document_type: 'receipt' });
  assert.strictEqual(r.payment_date.value, '2026-09-04');
});

t('an invoice has no payment date to find — that is not a failure', () => {
  const r = D.extractDates('Invoice Tanggal : 15 Agustus 2026', { document_type: 'invoice' });
  assert.strictEqual(r.payment_date.status, 'not_applicable');
  assert.ok(/does not record a payment date/i.test(r.payment_date.note), r.payment_date.note);
});

console.log('\n14. Indonesian formats');
t('14. every required format parses', () => {
  const cases = [
    ['Tanggal : 04/08/2026', '2026-08-04'],
    ['Tanggal : 04-08-2026', '2026-08-04'],
    ['Tanggal : 4 Agustus 2026', '2026-08-04'],
    ['Tanggal : 04 Aug 2026', '2026-08-04'],
    ['Tanggal : 2026-08-04', '2026-08-04'],
    ['Tanggal : 25 Desember 2026', '2026-12-25'],
    ['Tanggal : 1 Mei 2026', '2026-05-01'],
  ];
  for (const [text, want] of cases) {
    const r = D.extractDates(text, { document_type: 'invoice' });
    assert.strictEqual(r.document_date.value, want, `${text} -> ${r.document_date.value}`);
  }
});

t('a day-first date beyond 12 is unambiguous and read as such', () => {
  const r = D.extractDates('Tanggal : 25/08/2026', { document_type: 'invoice' });
  assert.strictEqual(r.document_date.value, '2026-08-25');
  assert.strictEqual(r.document_date.status, 'detected');
});

console.log('\n15/16. honesty');
t('15. an ambiguous numeric date asks for confirmation', () => {
  const r = D.extractDates('Tanggal : 04/08/2026', { document_type: 'invoice' });
  assert.strictEqual(r.document_date.status, 'needs_confirmation');
  assert.strictEqual(r.document_date.value, '2026-08-04', 'day-first is the default reading');
  assert.ok(/day first.*month first|month first/i.test(r.document_date.note), r.document_date.note);
  assert.strictEqual(r.document_date.original, 'Tanggal : 04/08/2026'.slice(-10),
    'the original string is kept for review');
});

t('16. no date is invented when the document states none', () => {
  const r = D.extractDates('Invoice INV-2026-001 Netto 5.000.000', { document_type: 'invoice' });
  assert.strictEqual(r.document_date.value, null);
  assert.strictEqual(r.document_date.status, 'not_found');
  assert.strictEqual(r.due_date.status, 'not_found');
});

t('an upload date can never leak in — nothing here reads a clock', () => {
  const today = new Date().toISOString().slice(0, 10);
  const r = D.extractDates('Invoice with no dates at all', { document_type: 'invoice' });
  for (const k of ['document_date', 'due_date', 'payment_date']) {
    assert.notStrictEqual(r[k].value, today, `${k} must not be today's date`);
    assert.strictEqual(r[k].value, null);
  }
});

t('an impossible date is rejected rather than coerced', () => {
  const r = D.extractDates('Tanggal : 31/02/2026', { document_type: 'invoice' });
  assert.strictEqual(r.document_date.value, null, '31 February is not a date');
});

t('a single unlabelled date is used, but says it was unlabelled', () => {
  const r = D.extractDates('KWITANSI PT Alpha 04 September 2026 Rp 1.000.000', { document_type: 'receipt' });
  assert.strictEqual(r.document_date.value, '2026-09-04');
  assert.ok(/No date label/i.test(r.document_date.note), r.document_date.note);
});

t('several unlabelled dates are not guessed between', () => {
  const r = D.extractDates('Something 01/03/2026 and 09/07/2026 and 11/11/2026', { document_type: 'invoice' });
  assert.strictEqual(r.document_date.status, 'not_found');
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
