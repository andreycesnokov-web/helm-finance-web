// The client classifier (client/src/v2/lib/cashClass.js) must agree with the server's
// (server/lib/financialInsights.js) on every row. Run: node tests/design/v2CashClass.test.mjs
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { classOf } from '../../client/src/v2/lib/cashClass.js'

const require = createRequire(import.meta.url)
const { classifyTransaction } = require('../../server/lib/financialInsights.js')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }

const ROWS = [
  { type: 'income', description: 'Opening balance · BCA' },
  { type: 'income', source: 'wallet_opening_balance', description: 'x' },
  { type: 'income', category: 'Sales', description: 'Vending' },
  { type: 'income', description: 'Owner funding' },
  { type: 'income', description: 'Loan proceeds from bank' },
  { type: 'expense', description: 'Loan repayment' },
  { type: 'expense', description: 'Dividend 2025' },
  { type: 'expense', description: 'Owner withdrawal' },
  { type: 'income', description: 'Mystery money' },
  { type: 'expense', description: 'Mystery cost' },
  { type: 'expense', category: 'Refill', description: 'liquid' },
  { type: 'expense', category: 'Rent', description: 'office' },
  { type: 'expense', description: 'Equipment maintenance' },
  { type: 'expense', description: 'New machine purchase' },
  { type: 'expense', description: 'PPh 25 pajak' },
  { type: 'expense', description: 'Loan interest' },
  { type: 'payroll', description: '' },
  { type: 'payroll', description: 'March wages' },
  { type: 'transfer', description: 'to cash' },
  { type: 'correction', description: '' },
  { type: 'expense', description: 'Balance correction' },
  { type: 'expense', description: '' },
  { type: 'income', notes: 'xendit settlement' },
]

console.log('\nDesign v2 cash classifier parity')
t('client classOf matches server classifyTransaction on every fixture row', () => {
  for (const r of ROWS) assert.strictEqual(classOf(r), classifyTransaction(r).class, JSON.stringify(r))
})
t('opening balances, owner money and loans are never revenue', () => {
  for (const d of ['Opening balance · BCA', 'Owner funding', 'Loan proceeds']) assert.notStrictEqual(classOf({ type: 'income', description: d }), 'revenue', d)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
