// Platform admin model + privacy rule. Run: node tests/design/v2AdminModel.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { companyStatus, setupScore, filterCompanies, overview, needsYou } from '../../client/src/v2/lib/adminModel.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 platform admin')
const now = new Date('2026-10-03T10:00:00')

const list = [
  { business_id: 'a', name: 'Alpha', type: 'business', effective_access_source: 'subscription', effective_plan: 'founder', wallet_count: 2, transactions_this_month: 5, created_at: '2026-01-01', last_activity: '2026-10-02' },
  { business_id: 'b', name: 'Beta', type: 'business', trial_status_effective: 'active', trial_ends_at: '2026-10-06', wallet_count: 1, created_at: '2026-09-20', last_activity: '2026-10-03' },
  { business_id: 'c', name: 'Gamma', type: 'business', wallet_count: 0, created_at: '2026-08-01', last_activity: '2026-08-02' },
  { business_id: 'd', name: 'Delta', type: 'business', subscription_status: 'past_due', created_at: '2026-05-01' },
  { business_id: 'p', name: 'Me', type: 'personal', created_at: '2026-09-01' },
]

t('status per company, first match wins', () => {
  assert.deepStrictEqual(list.slice(0, 4).map((b) => companyStatus(b, now)), ['healthy', 'trialEnds', 'setupStuck', 'pastDue'])
  assert.strictEqual(companyStatus({ status: 'archived', subscription_status: 'past_due' }, now), 'archived')
})

t('filters exclude personal workspaces; search; newest activity first', () => {
  assert.deepStrictEqual(filterCompanies(list, { now }).map((b) => b.business_id), ['b', 'a', 'c', 'd'])
  assert.deepStrictEqual(filterCompanies(list, { filter: 'paying', now }).map((b) => b.business_id), ['a'])
  assert.deepStrictEqual(filterCompanies(list, { filter: 'trial', now }).map((b) => b.business_id), ['b'])
  assert.deepStrictEqual(filterCompanies(list, { filter: 'attention', now }).map((b) => b.business_id).sort(), ['b', 'c', 'd'])
  assert.deepStrictEqual(filterCompanies(list, { q: 'gam', now }).map((b) => b.business_id), ['c'])
})

t('overview counts and funnel', () => {
  const o = overview(list, now)
  assert.deepStrictEqual([o.companies, o.personal, o.paying, o.trials, o.trialsEndingWeek, o.attention], [4, 1, 1, 1, 1, 3])
  assert.deepStrictEqual(o.funnel, { signedUp: 1, accounts: 1, active: 0 })
  assert.deepStrictEqual(setupScore(list[0]), { done: 2, of: 2 })
})

t('needs-you: degraded DB first; all good otherwise', () => {
  assert.strictEqual(needsYou({ system: { db_reachable: false } }, {})[0].key, 'dbDegraded')
  assert.deepStrictEqual(needsYou({ system: { db_reachable: true } }, { trialsEndingWeek: 0 }).map((x) => x.key), ['allGood'])
})

t('privacy: admin screens never request client financial data', () => {
  const dir = path.join(ROOT, 'client/src/v2/admin')
  const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), path.join(ROOT, 'client/src/v2/AdminApp.jsx')]
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8')
    const paths = [...s.matchAll(/use(?:Admin)?Api\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1])
    for (const p of paths) assert.ok(p.startsWith('/admin/'), `${path.basename(f)} reads ${p} — admin screens may only use /api/admin/*`)
    // An API path string starting with a client-finance resource (navigation links like
    // '/business/pulse' are fine — they are not requests).
    assert.ok(!/['"`]\/(api\/)?(transactions|wallets|documents|debts|pulse|personal|payroll|counterparties)\b/.test(s), `${path.basename(f)} references a client finance API path`)
  }
})

t('admin routes are flag-gated in App.jsx; legacy tools stay reachable', () => {
  const app = fs.readFileSync(path.join(ROOT, 'client/src/App.jsx'), 'utf8')
  assert.match(app, /const V2AdminApp = DESIGN_V2 \? lazy\(\(\) => import\('\.\/v2\/AdminApp'\)\) : null/)
  assert.match(app, /\) : <Route path="\/admin\/dashboard" element=\{<Layout><AdminDashboard \/><\/Layout>\} \/>\}/)
  assert.match(app, /<Route path="\/admin\/system" element=\{<Suspense fallback=\{null\}><V2AdminApp page="system" \/>/)
  assert.match(app, /<Route path="\/admin\/businesses\/:businessId\/tools" element=\{<Layout><AdminBusinessDetail \/><\/Layout>\} \/>/)
  assert.ok(!/\{DESIGN_V2 &&/.test(app), 'use a ternary: `DESIGN_V2 && …` leaves a false child in the OFF bundle')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
