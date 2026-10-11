// Approve / reject buttons follow the server's role and self-approval rules.
// Run: node tests/design/v2Decisions.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import { decisionRights, DECIDE_ROLES } from '../../client/src/v2/lib/decisions.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 decision rights')
const debt = { id: 1, created_by_user_id: 'u1' }

t('roles that may only submit get no buttons', () => {
  for (const role of ['manager', 'accountant', 'member', 'viewer']) assert.deepStrictEqual(decisionRights({ role, userId: 'u2', debt }), { known: true, canDecide: false, canApprove: false, why: 'role' })
})
t('admin and CFO cannot approve their own submission, but may reject or ask', () => {
  for (const role of ['admin', 'cfo']) assert.deepStrictEqual(decisionRights({ role, userId: 'u1', debt }), { known: true, canDecide: true, canApprove: false, why: 'own' })
})
t('owner and CEO may approve their own; deciders may approve others', () => {
  for (const role of ['owner', 'ceo']) assert.strictEqual(decisionRights({ role, userId: 'u1', debt }).canApprove, true)
  for (const role of DECIDE_ROLES) assert.strictEqual(decisionRights({ role, userId: 'u2', debt }).canApprove, true)
  assert.strictEqual(decisionRights({ role: 'cfo', userId: 7, debt: { created_by_user_id: '7' } }).canApprove, false, 'ids compare as strings')
})
t('unknown role (still loading) offers nothing', () => assert.deepStrictEqual(decisionRights({ role: undefined, userId: 'u1', debt }), { known: false, canDecide: false, canApprove: false, why: null }))
t('DECIDE_ROLES mirrors canApproveFinancialRecord on the server', () => {
  const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
  const m = /function canApproveFinancialRecord\(role\)\s*\{ return (\[[^\]]*\])\.includes\(role\); \}/.exec(src)
  assert.deepStrictEqual(JSON.parse(m[1].replace(/'/g, '"')), DECIDE_ROLES)
  assert.match(src, /created_by_user_id === userId && !\['owner', 'ceo'\]\.includes\(biz\.role\)/)
})
t('DecisionActions uses the rights', () => {
  const s = fs.readFileSync(new URL('../../client/src/v2/components/DecisionActions.jsx', import.meta.url), 'utf8')
  assert.match(s, /decisionRights\(\{ role: team\.data\?\.my_role, userId: user\?\.id, debt \}\)/)
  assert.match(s, /disabled=\{busy \|\| !rights\.canApprove\}/)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
