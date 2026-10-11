// Review 8.2 SHOULD FIX items (batch 13). Pure parts are unit-tested; wiring is checked
// in the source. Others have their own files: v2Decisions, v2Csv, v2Obligations
// (payerHistory), v2PulseModel (tiles, overdue tax), tests/migrations/ci_061.js (NOT VALID).
// Run: node tests/design/v2ShouldFix82.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { warningItem, needsYou } from '../../client/src/v2/lib/adminModel.js'
import { accountantMonth } from '../../client/src/v2/lib/accounting.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const V2 = 'client/src/v2'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 review 8.2 should-fix')

t('admin warnings: static ones dropped, the rest mapped to i18n keys', () => {
  assert.strictEqual(warningItem('businesses.inactive_no_recent_activity: not computed (requires per-business aggregation)'), null)
  assert.strictEqual(warningItem('identity_risks.duplicate_email_conflicts: unavailable; conflicts are currently detected at link time'), null)
  assert.deepStrictEqual(warningItem('users.total: unavailable (database error)'), { key: 'dbError', what: 'users.total' })
  assert.deepStrictEqual(warningItem('Dashboard metrics timed out. Some metrics are unavailable.'), { key: 'timeout' })
  assert.deepStrictEqual(warningItem('something new'), { key: 'other', detail: 'something new' })
  const items = needsYou({ system: { db_reachable: true }, warnings: ['businesses.inactive_no_recent_activity: not computed (requires per-business aggregation)'] }, {})
  assert.deepStrictEqual(items.map((x) => x.key), ['allGood'], 'static warnings never make "needs you" non-empty')
})

t('admin companies: server-side search and the response total; payment connections linked', () => {
  const s = read(`${V2}/admin/AdminCompanies.jsx`)
  assert.match(s, /&search=\$\{encodeURIComponent\(search\)\}/)
  assert.match(s, /Number\(list\.data\?\.total \?\? all\.length\)/)
  assert.ok(!/filterCompanies\(all, \{ filter, q \}\)/.test(s), 'no client-only search over the first 200')
  assert.match(read(`${V2}/AdminApp.jsx`), /to="\/admin\/payment-connections"/)
})

t('"Skip to content" goes through i18n in both shells', () => {
  for (const f of [`${V2}/shell/V2Shell.jsx`, `${V2}/AdminApp.jsx`]) {
    const s = read(f)
    assert.ok(!/>Skip to content</.test(s), f)
    assert.match(s, /href="#v2-main">\{t\('shell\.skip'\)\}/, f)
  }
})

t('accountant month: only a picker month is accepted; tab default otherwise', () => {
  const today = new Date(2026, 9, 3)
  assert.strictEqual(accountantMonth('2026-07', 'close', today), '2026-07')
  for (const bad of ['garbage', '2026-13', '2027-01', '2020-01', '', null, undefined, ['2026-07']]) {
    assert.strictEqual(accountantMonth(bad, 'close', today), '2026-09', String(bad))
    assert.strictEqual(accountantMonth(bad, 'taxes', today), '2026-10', String(bad))
  }
  const s = read(`${V2}/pages/Accountant.jsx`)
  assert.match(s, /const month = accountantMonth\(sp\.get\('month'\), tab\)/, 'read from the URL every render, so a tab switch resets it')
})

t('Radar: horizon waits for the plan and falls back to 30; "Show all" matches the filter', () => {
  const s = read(`${V2}/pages/Radar.jsx`)
  assert.match(s, /const advanced = !accessLoading && hasFeature\('advanced_radar_enabled'\)/)
  assert.match(s, /const horizon = advanced \? picked : DEFAULT_HORIZON/)
  assert.match(s, /SHOW_ALL = \{ in: '\/business\/receivables', out: '\/business\/payables', all: '\/business\/invoices' \}/)
  assert.ok(!/<Link to="\/business\/transactions">\{t\('radar\.showAll'/.test(s))
})

t('data cache: a later page mount refetches; only in-flight or very fresh reads are shared', () => {
  const s = read(`${V2}/data.jsx`)
  assert.match(s, /export const FRESH_MS = 2000/)
  assert.match(s, /hit\.at == null \|\| Date\.now\(\) - hit\.at < FRESH_MS/)
})

t('Accounts: wallets and transfers labelled personal are kept and labelled, not dropped', () => {
  const s = read(`${V2}/pages/Accounts.jsx`)
  assert.ok(!/\(x\.scope \|\| 'business'\) === 'business'/.test(s), 'no scope filter on wallets')
  assert.match(s, /x\.scope === 'personal' && <> <Pill tone="warn">\{t\('acc\.labelledPersonal'\)\}/)
  assert.match(s, /m\.scope === 'personal' && <> <Pill tone="warn">\{t\('acc\.labelledPersonal'\)\}/)
})

t('late invoices offer "Mark received" through the existing payment modal', () => {
  const s = read(`${V2}/pages/Bills.jsx`)
  assert.match(s, /s === 'late' && receivable\) action = <span className="v2-btnpair"><Btn onClick=\{\(\) => onPay\(d\)\}>\{t\('bills\.markReceived'\)\}/)
})

t('PROPOSALS records the two findings', () => {
  const s = read('_specs/design-v2/PROPOSALS.md')
  assert.match(s, /## F-02 · Finding: `POST \/api\/counterparties` has no role check/)
  assert.match(s, /## F-03 · Finding: clickable AI phrases need a backend prompt change/)
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
