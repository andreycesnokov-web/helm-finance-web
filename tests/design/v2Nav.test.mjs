// Design v2 navigation model and route coverage.
// Run: node tests/design/v2Nav.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAV_GROUPS, SETTINGS_ITEM, TABS, activeNavKey, activeTabKey, allNavItems } from '../../client/src/v2/nav.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }

const app = read('client/src/v2/BusinessApp.jsx')
const v2Paths = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => '/business/' + m[1]))

console.log('\nDesign v2 navigation')

t('sidebar groups follow the design: Overview / Money / Obligations / Accounting', () => {
  assert.deepStrictEqual(NAV_GROUPS.map((g) => g.key), ['overview', 'money', 'obligations', 'accounting'])
  assert.deepStrictEqual(NAV_GROUPS[0].items.map((i) => i.key), ['pulse', 'radar', 'performance', 'cfo'])
  assert.deepStrictEqual(NAV_GROUPS[1].items.map((i) => i.key), ['accounts', 'transactions', 'funding', 'assets'])
  assert.deepStrictEqual(NAV_GROUPS[2].items.map((i) => i.key), ['bills', 'payroll', 'approvals', 'counterparties'])
  assert.deepStrictEqual(NAV_GROUPS[3].items.map((i) => i.key), ['documents', 'accountant'])
})

t('phone tab bar is Pulse · Radar · + Add · AI CFO · More', () => {
  assert.deepStrictEqual(TABS.map((x) => x.key), ['pulse', 'radar', 'add', 'cfo', 'more'])
})

t('every nav and tab destination is a registered v2 route', () => {
  for (const it of [...allNavItems(), ...TABS]) {
    if (it.disabled) continue
    assert.ok(v2Paths.has(it.to), `${it.to} is not routed in BusinessApp.jsx`)
  }
})

t('"+ Add" is disabled until Add is migrated — never the legacy Personal-default page (review 8.2 #3)', () => {
  const add = TABS.find((x) => x.key === 'add')
  assert.ok(add.disabled && add.to === null)
  for (const f of ['client/src/v2/shell/V2Shell.jsx', 'client/src/v2/pages/Transactions.jsx', 'client/src/v2/nav.js'])
    assert.ok(!/to=["'{]?\/business\/add\b|to: '\/business\/add'/.test(read(f)), `${f} links to /business/add`)
})

t('every legacy /business route is still routed when the flag is on', () => {
  const legacy = [...read('client/src/App.jsx').matchAll(/<Route path="(\/business\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(legacy.length >= 20, `expected the legacy /business tree, found ${legacy.length}`)
  for (const p of legacy) assert.ok(v2Paths.has(p), `legacy route ${p} would 404 with VITE_DESIGN_V2 on`)
})

t('every DESIGN_SPEC §3 business route exists', () => {
  for (const p of ['/business/pulse', '/business/radar', '/business/ai-cfo', '/business/performance',
    '/business/performance/cash', '/business/performance/forecast', '/business/accounts', '/business/transactions',
    '/business/funding-investors', '/business/assets', '/business/assets/new', '/business/payables',
    '/business/receivables', '/business/invoices', '/business/payables/:id', '/business/payroll',
    '/business/approvals', '/business/counterparties', '/business/counterparties/new', '/business/documents',
    '/business/accountant', '/business/settings', '/business/team', '/business/onboarding', '/business/more', '/business/add']) {
    assert.ok(v2Paths.has(p), `${p} missing`)
  }
})

t('active item follows the page, including sub-routes', () => {
  assert.strictEqual(activeNavKey('/business/pulse'), 'pulse')
  assert.strictEqual(activeNavKey('/business/receivables'), 'bills')
  assert.strictEqual(activeNavKey('/business/invoices'), 'bills')
  assert.strictEqual(activeNavKey('/business/payables/42'), 'bills')
  assert.strictEqual(activeNavKey('/business/performance/cash'), 'performance')
  assert.strictEqual(activeNavKey('/business/accountant/tax-profile'), 'accountant')
  assert.strictEqual(activeNavKey('/business/team'), 'settings')
  assert.strictEqual(activeNavKey('/business/counterparties/new'), 'counterparties')
  assert.strictEqual(activeNavKey('/business/more'), null)
  assert.strictEqual(activeNavKey('/business/pulsefoo'), null, 'a prefix must match a whole segment')
})

t('tab bar: four destinations, everything else lights up More', () => {
  assert.strictEqual(activeTabKey('/business/pulse'), 'pulse')
  assert.strictEqual(activeTabKey('/business/radar'), 'radar')
  assert.strictEqual(activeTabKey('/business/ai-cfo'), 'cfo')
  assert.strictEqual(activeTabKey('/business/add'), 'add')
  assert.strictEqual(activeTabKey('/business/payables'), 'more')
  assert.strictEqual(activeTabKey('/business/more'), 'more')
})

t('Settings sits at the bottom, not in a group', () => {
  assert.strictEqual(SETTINGS_ITEM.to, '/business/settings')
  assert.ok(!NAV_GROUPS.some((g) => g.items.some((i) => i.key === 'settings')))
})

t('Platform admin link renders only behind the existing admin check', () => {
  const shell = read('client/src/v2/shell/V2Shell.jsx')
  assert.match(shell, /useApi\('\/admin\/status'\)/, 'must use the existing GET /api/admin/status')
  assert.match(shell, /is_admin === true/, 'only an explicit true shows the link')
  assert.match(shell, /\{isAdmin && \(\s*<Link to="\/admin\/dashboard"/, 'link must be conditional on isAdmin')
  const more = read('client/src/v2/pages/More.jsx')
  assert.match(more, /\{isAdmin && <Row/, 'More must gate the admin row the same way')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
