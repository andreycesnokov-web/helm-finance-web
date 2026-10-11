// What a statement row is (client/src/v2/lib/statementInsights.js). Synthetic rows shaped like
// BCA and Permata lines; names are invented.
import test from 'node:test'
import assert from 'node:assert'
import { insightOf, counterpartyOf, mentions } from '../client/src/v2/lib/statementInsights.js'

const ctx = { company: 'Sunrise Trading Indonesia', otherCompanies: ['Sunrise Pay'] }
const row = (description, direction, amount = 1000000) => ({ description, direction, amount })

test('bank fees and interest', () => {
  assert.strictEqual(insightOf(row('BIAYA ADM', 'out', 30000), ctx).kind, 'bank_fee')
  assert.strictEqual(insightOf(row('BI-FAST DB BIAYA TXN KE 008 SOMEONE KBB', 'out', 2500), ctx).category, 'Bank fee and admin')
  const i = insightOf(row('BUNGA', 'in', 1200), ctx)
  assert.strictEqual(i.kind, 'interest'); assert.strictEqual(i.tax, 'final_interest')
})

test("own accounts and the owner's other companies", () => {
  const own = insightOf(row('TRF KE SUNRISE TRADING INDONE 07721538064 BANK CENTRAL ASIA', 'out'), ctx)
  assert.strictEqual(own.kind, 'own_transfer'); assert.strictEqual(own.category, 'Transfer between own accounts — out')
  const ic = insightOf(row('SWITCHING CR TRF TRANSFEDR 013 SUNRISE PAY PEB', 'in'), ctx)
  assert.strictEqual(ic.kind, 'intercompany'); assert.strictEqual(ic.category, 'Intercompany — in'); assert.strictEqual(ic.ask, true)
})

test('gateway settlement, payment abroad, rent', () => {
  assert.strictEqual(insightOf(row('WLST00 PB Dari Ke PERMATA GATEWAY 07:00:14 G2000', 'in'), ctx).category, 'Payment gateway settlement')
  const f = insightOf(row('TT OUT USD 472 LOCATION MEDIA OCBC SG', 'out'), ctx)
  assert.strictEqual(f.kind, 'foreign'); assert.strictEqual(f.tax, 'pph26')
  const r = insightOf(row('TRSF E-BANKING DB 0409/FTSCY 29600000.00 CIRCLEKA INDONESIA', 'out'), ctx)
  assert.strictEqual(r.kind, 'rent'); assert.strictEqual(r.tax, 'pph42')
})

test('private persons: money in asks (owner funding?), money out reminds of PPh 21', () => {
  const a = insightOf(row('BI-FAST CR TRANSFER DR 013 JOHN DOE', 'in', 30000000), ctx)
  assert.strictEqual(a.kind, 'from_person'); assert.strictEqual(a.counterparty, 'JOHN DOE'); assert.strictEqual(a.ask, true)
  const b = insightOf(row('BI-FAST DB TRANSFER KE 008 JANE ROE KBB', 'out', 5000000), ctx)
  assert.strictEqual(b.kind, 'to_person'); assert.strictEqual(b.tax, 'pph21')
  assert.strictEqual(insightOf(row('TRF KE PT SUPPLIER JAYA 123 BANK MANDIRI', 'out'), ctx).kind, 'other', 'a company is not a person')
})

test('money to the owner is a withdrawal question, not pay', () => {
  const o = insightOf(row('BI-FAST DB TRANSFER KE 013 ALEX OWNER KBB', 'out', 900000), { ...ctx, ownerNames: ['Alex Owner'] })
  assert.strictEqual(o.kind, 'owner'); assert.strictEqual(o.tax, null); assert.strictEqual(o.category, 'Owner withdrawal / dividends')
  assert.strictEqual(counterpartyOf('TRSF E-BANKING DB 0409/FTSCY/WS95051 29600000.00 CIRCLEKA INDONESIA'), 'CIRCLEKA INDONESIA')
})

test('counterparty and name matching', () => {
  assert.strictEqual(counterpartyOf('BI-FAST DB TRANSFER   KE 013 PT HELLO WORLD KBB'), 'PT HELLO WORLD')
  assert.strictEqual(counterpartyOf('PB KE JOHN SMITH 4138125896 New PeB 06:39:11'), 'JOHN SMITH')
  assert.ok(mentions('TRF KE SUNRISE TRADING INDONE', 'Sunrise Trading Indonesia'))
  assert.ok(!mentions('TRF KE SUNRISE BAKERY', 'Sunrise Trading Indonesia'))
})
