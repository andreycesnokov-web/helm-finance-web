// Design v2 — routes, navigation, badge counts, formatting and copy.
// Run: node tests/design/v2/shell.test.mjs
import assert from 'node:assert'
import { t, done, read, code } from './_t.mjs'
import { P, NAV_GROUPS, TABS, SPEC_SCREENS, activeNavKey, activeTabKey } from '../../../client/src/v2/routes.js'
import { shellCounts, openApprovedDebts, pendingDebts } from '../../../client/src/v2/lib/counts.js'

console.log('\nRoutes')
const app = code('client/src/v2/BusinessApp.jsx')
const registered = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => '/business/' + m[1]))

await t('every DESIGN_SPEC §3 business screen has a registered route', () => {
  for (const [screen, p] of Object.entries(SPEC_SCREENS)) {
    if (p.startsWith('/admin')) continue
    assert.ok(registered.has(p), `${screen} → ${p} is not registered in BusinessApp.jsx`)
  }
})

await t('every existing /business/* route from App.jsx is still served by v2', () => {
  const legacy = [...read('client/src/App.jsx').matchAll(/<Route path="(\/business\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(legacy.length >= 20, 'expected the legacy business routes in App.jsx')
  for (const p of legacy) assert.ok(registered.has(p), `${p} would be lost with the flag on`)
})

await t('every nav item and tab points at a registered route', () => {
  const all = [...NAV_GROUPS.flatMap((g) => g.items), ...TABS]
  for (const it of all) assert.ok(registered.has(it.to), `${it.key} → ${it.to}`)
  assert.ok(registered.has(P.settings) && registered.has(P.more) && registered.has(P.add))
})

await t('sidebar groups follow the design order', () => {
  assert.deepStrictEqual(NAV_GROUPS.map((g) => g.key), ['overview', 'money', 'obligations', 'accounting'])
  assert.deepStrictEqual(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key)), [
    'pulse', 'radar', 'performance', 'cfo', 'accounts', 'transactions', 'funding', 'assets',
    'bills', 'payroll', 'approvals', 'counterparties', 'documents', 'accountant'])
  assert.deepStrictEqual(TABS.map((x) => x.key), ['pulse', 'radar', 'add', 'cfo', 'more'])
})

await t('active nav item follows the route, including sub-pages', () => {
  const cases = {
    '/business/pulse': 'pulse', '/business/receivables': 'bills', '/business/invoices': 'bills',
    '/business/payables/abc': 'bills', '/business/accountant/taxes': 'accountant',
    '/business/performance/cash': 'performance', '/business/assets/new': 'assets',
    '/business/counterparties/new': 'counterparties', '/business/settings': 'settings', '/business/team': 'settings',
  }
  for (const [p, k] of Object.entries(cases)) assert.strictEqual(activeNavKey(p), k, p)
  assert.strictEqual(activeTabKey('/business/radar'), 'radar')
  assert.strictEqual(activeTabKey('/business/payroll'), 'more')
  assert.strictEqual(activeTabKey('/business/add'), 'add')
})

console.log('\nBadge counts')
const d = (o) => ({ status: 'open', approval_status: 'approved', amount: 1, ...o })
await t('counts come from the pulse payload with the server rules', () => {
  const pulse = { needs_review_count: 3, debts: [
    d({ status: 'overdue' }), d({ status: 'overdue', approval_status: 'pending_approval' }),
    d({ status: 'paid' }), d({ approval_status: 'pending_approval' }), d({ approval_status: 'rejected', status: 'cancelled' }),
    d({ status: 'overdue', approval_status: null }),
  ] }
  assert.deepStrictEqual(shellCounts(pulse), { needsCategory: 3, lateBills: 2, approvals: 2 })
  assert.deepStrictEqual(shellCounts(null), { needsCategory: 0, lateBills: 0, approvals: 0 })
  assert.strictEqual(openApprovedDebts(pulse.debts).length, 2)
  assert.strictEqual(pendingDebts(pulse.debts).length, 2)
})

console.log('\nShell rules')
const shell = code('client/src/v2/shell/V2Shell.jsx')
await t('Platform admin link is gated on the existing /admin/status check', () => {
  assert.match(shell, /apiFetch\('\/admin\/status'/)
  assert.match(shell, /is_admin === true/)
  assert.match(shell, /\{isAdmin && \(/)
})
await t('a personal workspace never renders the business shell', () => {
  assert.match(shell, /active\.type === 'personal'\) return null/)
  assert.match(shell, /navigate\(P\.personal\)/)
})
await t('badge pulse request is skipped for roles the server would refuse', () => {
  assert.match(shell, /canViewFinance\(active\.role\)/)
})

console.log('\nCopy')
const en = (await import('../../../client/src/i18n/v2/en.js')).default
const ru = (await import('../../../client/src/i18n/v2/ru.js')).default
const id = (await import('../../../client/src/i18n/v2/id.js')).default
await t('RU and ID never carry a key EN does not have', () => {
  for (const [name, dict] of [['ru', ru], ['id', id]]) {
    const extra = Object.keys(dict).filter((k) => !(k in en))
    assert.deepStrictEqual(extra, [], `${name} has keys missing from en: ${extra.join(', ')}`)
  }
})
await t('every t() key used by v2 code exists in EN', async () => {
  const fs = await import('node:fs'); const path = await import('node:path')
  const files = []
  const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); fs.statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) && files.push(p) } }
  walk(new URL('../../../client/src/v2', import.meta.url).pathname)
  const missing = []
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8')
    for (const m of s.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in en)) missing.push(`${path.basename(f)}: ${m[1]}`)
    for (const m of s.matchAll(/(?:labelKey|titleKey)[:=]\s*["']([a-zA-Z0-9_.]+)["']/g)) if (!(m[1] in en)) missing.push(`${path.basename(f)}: ${m[1]}`)
  }
  assert.deepStrictEqual(missing, [])
})
await t('untranslated keys are reported, not hidden', () => {
  const ruMissing = Object.keys(en).filter((k) => !(k in ru))
  const idMissing = Object.keys(en).filter((k) => !(k in id))
  console.log(`      RU falls back to EN for ${ruMissing.length} key(s); ID for ${idMissing.length}`)
})

done()
