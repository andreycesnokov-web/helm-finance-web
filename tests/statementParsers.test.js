'use strict';
// Bank statement engine: BCA CSV and Permata PDF text, checked by balances. Synthetic data only.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../server/lib/statementParsers');

const BCA = [
  '"Account Portfolio - Transaction Inquiry"," "," "," "," ",',
  '',
  '"Account Number : 1234567890"',
  '"Name : TEST COMPANY PT"',
  '"Period : 01/09/2026 - 30/09/2026"',
  '"Currency Code : Rp"',
  '"Transaction Date","Description","Branch","Amount","Balance"',
  '"03/09","BI-FAST CR TRANSFER   DR 013 SOMEONE     ","0000","1,000,000.00 CR","1,100,000.00"',
  '"04/09","TRSF E-BANKING DB 0409/X 250000.00 SUPPLIER    ","7720","250,000.00 DB","850,000.00"',
  '"04/09","BIAYA ADM       ","0000","10,000.00 DB","840,000.00"',
].join('\n')

test('BCA CSV: rows, signs, dates with the period year, opening from the first balance', () => {
  const r = P.parseStatement({ text: BCA })
  assert.strictEqual(r.ok, true); assert.strictEqual(r.format, 'bca_csv'); assert.strictEqual(r.bank, 'BCA')
  assert.strictEqual(r.account_number, '1234567890'); assert.strictEqual(r.currency, 'IDR')
  assert.strictEqual(r.period_start, '2026-09-01'); assert.strictEqual(r.period_end, '2026-09-30')
  assert.strictEqual(r.rows.length, 3)
  assert.deepStrictEqual(r.rows.map((x) => [x.tx_date, x.direction, x.amount]), [['2026-09-03', 'in', 1000000], ['2026-09-04', 'out', 250000], ['2026-09-04', 'out', 10000]])
  assert.strictEqual(r.opening, 100000); assert.strictEqual(r.closing, 840000)
  assert.strictEqual(r.checks.balances, true); assert.strictEqual(r.checks.running_breaks, 0)
})

test('BCA CSV: a broken running balance is reported, not hidden', () => {
  const bad = BCA.replace('"850,000.00"', '"860,000.00"')
  const r = P.parseStatement({ text: bad })
  assert.ok(r.checks.running_breaks >= 1)
})

const PERMATA = 'TRANSACTION HISTORY 01 Oct 2026 | 16:55:47 01 Sep 2026 - 30 Sep 2026 IDR Account No. Currency Period 0000-1111-222 '
  + 'Account Name Test Company Opening Balance Total Debit Total Credit Closing Balance 1,000,000.00 300,500.00 500,000.00 1,199,500.00 '
  + 'Financial Transaction Date Value Date Transaction Reference No./ Customer Reference Detail/ Cheque No. Description Amount '
  + '28 Sep 2026 28 Sep 2026 - 500.00 0805-0000-0000-0001 - 9282026 ADM S/W BCA TRF KE SOMEONE 0805000000000001 '
  + '28 Sep 2026 28 Sep 2026 - 300,000.00 0805-0000-0000-0001 - 9282026 TRF KE SOMEONE BANK X 0805000000000001 '
  + 'Page 1 of 2 TRANSACTION HISTORY 01 Oct 2026 | 16:55:47 Financial Transaction Date Value Date Transaction Reference No./ Customer Reference Detail/ Cheque No. Description Amount '
  + '27 Sep 2026 27 Sep 2026 500,000.00 0865-0000-0000-0002 WLST00 - PB Dari Ke PERMATA GATEWAY 07:00:14 G2000 2709 WLST00 '

test('Permata text: credit and debit, references, page headers dropped, totals match', () => {
  const r = P.parseStatement({ text: PERMATA })
  assert.strictEqual(r.ok, true); assert.strictEqual(r.format, 'permata_pdf')
  assert.strictEqual(r.account_number, '00001111222'); assert.strictEqual(r.account_name, 'Test Company')
  assert.strictEqual(r.rows.length, 3)
  const inRow = r.rows.find((x) => x.direction === 'in')
  assert.strictEqual(inRow.amount, 500000); assert.strictEqual(inRow.tx_date, '2026-09-27'); assert.match(inRow.description, /PERMATA GATEWAY/)
  assert.ok(!r.rows.some((x) => /TRANSACTION HISTORY|Page \d/.test(x.description)), 'page header glued to a row')
  assert.strictEqual(r.checks.balances, true); assert.strictEqual(r.checks.totals_match, true)
  assert.strictEqual(r.rows[0].tx_date <= r.rows[r.rows.length - 1].tx_date, true, 'oldest first')
})

test('unknown text is not guessed', () => {
  assert.deepStrictEqual(P.parseStatement({ text: 'hello' }), { ok: false, reason: 'unknown_format' })
})

test("the model's rows get the engine's checks; invalid rows are dropped", () => {
  const r = P.normalizeModelStatement({ bank: 'Mandiri', currency: 'IDR', opening_balance: '100.00', closing_balance: '150.00',
    rows: [{ date: '2026-09-01', description: 'in', credit: '100.00' }, { date: '2026-09-02', description: 'out', debit: '50.00' }, { date: 'bad', credit: '1' }] })
  assert.strictEqual(r.rows.length, 2); assert.strictEqual(r.checks.balances, true)
  const off = P.normalizeModelStatement({ opening_balance: '100', closing_balance: '999', rows: [{ date: '2026-09-01', credit: '1' }] })
  assert.strictEqual(off.checks.balances, false)
})

test('amounts in both separators', () => {
  assert.strictEqual(P.amountOf('1,234,567.89'), 1234567.89)
  assert.strictEqual(P.amountOf('1.234.567,89'), 1234567.89)
  assert.strictEqual(P.amountOf('-'), null)
})
