// Sidebar badges derived from GET /api/pulse. Run: node tests/design/v2ShellCounts.test.mjs
import assert from 'node:assert'
import { shellCounts } from '../../client/src/v2/lib/shellCounts.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 shell counts')

t('no response → no badges (null, never zero)', () => {
  assert.deepStrictEqual(shellCounts(null), { late: null, approvals: null, needsCategory: null })
})

t('late counts server-marked overdue items, not drafts or rejected ones', () => {
  const c = shellCounts({ debts: [
    { status: 'overdue', approval_status: 'approved' },
    { status: 'overdue' },
    { status: 'overdue', approval_status: 'pending_approval' },
    { status: 'overdue', approval_status: 'rejected' },
    { status: 'open', approval_status: 'approved' },
  ] })
  assert.strictEqual(c.late, 2)
})

t('approvals counts open pending_approval items only', () => {
  const c = shellCounts({ debts: [
    { status: 'open', approval_status: 'pending_approval' },
    { status: 'paid', approval_status: 'pending_approval' },
    { status: 'cancelled', approval_status: 'pending_approval' },
    { status: 'open', approval_status: 'approved' },
  ] })
  assert.strictEqual(c.approvals, 1)
})

t('needs-category is the server count, or null when absent', () => {
  assert.strictEqual(shellCounts({ needs_review_count: 3 }).needsCategory, 3)
  assert.strictEqual(shellCounts({}).needsCategory, null)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
