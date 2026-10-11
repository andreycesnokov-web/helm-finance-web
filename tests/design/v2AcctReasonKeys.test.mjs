// Every i18n key the month-close "unreconciled bank transactions" block can show exists in
// EN, RU and ID — no raw "acct.reason.action…" on screen (seen in production before this test).
// Run: node tests/design/v2AcctReasonKeys.test.mjs
import assert from 'node:assert'
import { determineUnreconciledReason, UNRECONCILED_REASONS, reasonMeta } from '../../client/src/v2/lib/accounting.js'
import en from '../../client/src/v2/i18n/en.js'
import ru from '../../client/src/v2/i18n/ru.js'
import id from '../../client/src/v2/i18n/id.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 · month close reason keys')

const DICTS = { en, ru, id }
const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)
const assertKey = (key) => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    const v = lookup(dict, key)
    assert.ok(typeof v === 'string' && v.trim().length > 0, `${key} is missing in ${lang}`)
  }
}

// Every branch of determineUnreconciledReason.
const MONTH = '2026-09'
const WALLET = { id: 'w1', name: 'BCA Operasional', currency: 'IDR', type: 'bank' }
const TX = { id: 't1', wallet_id: 'w1', amount: 1000, type: 'expense', date: '2026-09-12' }
const covering = (over = {}) => ({ id: 'b1', wallet_id: 'w1', statement_start: '2026-09-01', statement_end: '2026-09-30', status: 'imported', ...over })
const SCENARIOS = {
  'no wallet': { tx: TX, month: MONTH, wallet: null, batches: [] },
  'no statement': { tx: TX, month: MONTH, wallet: WALLET, batches: [] },
  'statement not covering the month': { tx: TX, month: MONTH, wallet: WALLET, batches: [covering({ statement_end: '2026-09-15' })] },
  'statement needs review': { tx: TX, month: MONTH, wallet: WALLET, batches: [covering({ status: 'review_required' })] },
  'statement unbalanced': { tx: TX, month: MONTH, wallet: WALLET, batches: [covering({ difference: 5000 })] },
  'not found in statement': { tx: TX, month: MONTH, wallet: WALLET, batches: [covering()] },
  'linked but still listed': { tx: { ...TX, is_reconciled: true }, month: MONTH, wallet: WALLET, batches: [covering()] },
}
const results = Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, determineUnreconciledReason(v)]))

t('the scenarios reach every reason code', () => {
  const seen = new Set(Object.values(results).map((r) => r.reason))
  assert.deepStrictEqual([...seen].sort(), UNRECONCILED_REASONS.map((r) => r.code).sort())
})

for (const [name, r] of Object.entries(results)) {
  t(`${name}: reason text and action label exist in EN/RU/ID`, () => {
    assertKey(r.reasonKey)
    if (r.actionLabelKey) assertKey(r.actionLabelKey)
    if (r.actionRoute) assert.ok(r.actionLabelKey, 'an action route needs a label')
    assert.ok(UNRECONCILED_REASONS.some((x) => x.code === r.reason), `unknown reason ${r.reason}`)
  })
}

t('the three action labels the production screen showed raw now exist', () => {
  for (const k of ['acct.reason.actionUploadStatement', 'acct.reason.actionReviewStatement', 'acct.reason.actionMatchTransactions']) assertKey(k)
  assert.strictEqual(lookup(ru, 'acct.reason.actionUploadStatement'), 'Загрузить выписку')
  assert.strictEqual(lookup(en, 'acct.reason.actionMatchTransactions'), 'Match with statement')
  assert.strictEqual(lookup(id, 'acct.reason.actionReviewStatement'), 'Periksa rekening koran')
})

t('every badge and counter label exists in EN/RU/ID', () => {
  for (const r of UNRECONCILED_REASONS) { assertKey(r.badgeKey); assertKey(r.countKey) }
  assert.strictEqual(reasonMeta('something-new').code, 'requires_clarification', 'unknown codes fall back to clarification')
})

t('the block\'s own labels exist in EN/RU/ID', () => {
  for (const k of ['title', 'sub', 'reviewBtn', 'whyLabel', 'countsLabel', 'opsCount', 'allNoStatement', 'allUnconfirmed',
    'uploadStatement', 'reviewStatement', 'unknownAccount']) assertKey(`acct.unlinked.${k}`)
  assert.strictEqual(lookup(ru, 'acct.unlinked.whyLabel'), 'Почему не сверена')
  assert.strictEqual(lookup(en, 'acct.unlinked.whyLabel'), "Why it isn't reconciled")
  assert.strictEqual(lookup(id, 'acct.unlinked.whyLabel'), 'Mengapa belum direkonsiliasi')
})

t('menu labels: "Счета и Инвойсы" / "Bills & Invoices", lock and resize labels, full overdue phrase', () => {
  for (const k of ['nav.bills', 'nav.adminOnlyYou', 'nav.resize', 'badge.lateFull']) assertKey(k)
  assert.strictEqual(lookup(ru, 'nav.bills'), 'Счета и Инвойсы')
  assert.strictEqual(lookup(en, 'nav.bills'), 'Bills & Invoices')
  assert.strictEqual(lookup(ru, 'acct.check.bills'), 'Счета и Инвойсы с документом · {ok} из {n}')
  assert.strictEqual(lookup(ru, 'nav.adminOnlyYou'), 'Видно только вам')
  assert.strictEqual(lookup(ru, 'badge.lateFull'), '{n} просрочено')
})

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`)
process.exitCode = fail === 0 ? 0 : 1
