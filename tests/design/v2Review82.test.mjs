// Review fixes 8.2 (PR #110): regression checks for items that are wiring, not pure logic.
// The pure items have their own tests: #1 v2AiLinks, #3 v2Nav, #9 v2Obligations,
// #11 v2Performance + v2CashClass, #12 v2CounterpartyForm, #13 v2TargetsForm, #14 v2RadarSeries.
// Run: node tests/design/v2Review82.test.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import en from '../../client/src/v2/i18n/en.js'
import ru from '../../client/src/v2/i18n/ru.js'
import id from '../../client/src/v2/i18n/id.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const V2 = 'client/src/v2'
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(jsx?|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []))
const at = (o, k) => k.split('.').reduce((x, p) => (x == null ? x : x[p]), o)
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 review fixes 8.2')

t('#1 an error boundary wraps business pages, the AI panel and admin pages', () => {
  const shell = read(`${V2}/shell/V2Shell.jsx`)
  assert.match(shell, /<ErrorBoundary>\{children\}<\/ErrorBoundary>/)
  assert.match(shell, /<ErrorBoundary compact><AskPanel \/><\/ErrorBoundary>/)
  assert.match(read(`${V2}/AdminApp.jsx`), /<ErrorBoundary>\{children\}<\/ErrorBoundary>/)
  const eb = read(`${V2}/components/ErrorBoundary.jsx`)
  assert.match(eb, /getDerivedStateFromError/)
  for (const L of [en, ru, id]) assert.ok(at(L, 'shell.crash'), 'shell.crash missing')
})

t('#2 the AI thread and the Accountant ask box reset on a business or scope switch and drop late answers', () => {
  // The side thread (AskContext) keeps its own tag.
  const ask = read(`${V2}/ai/AskContext.jsx`)
  assert.match(ask, /useWorkspace\(\)/, 'AskContext: must read the active workspace')
  assert.match(ask, /const wsKey = `\$\{active\?\.id \?\? ''\}\|\$\{scopeKey \?\? ''\}`/, 'AskContext: key = business + scope')
  assert.match(ask, /useEffect\(\(\) => \{ wsRef\.current = wsKey;/, 'AskContext: reset on switch')
  assert.match(ask, /const asked = wsRef\.current/, 'AskContext: tag the request')
  assert.match(ask, /wsRef\.current !== asked\) return|wsRef\.current === asked\)/, 'AskContext: drop a late answer')
  // The Accountant ask box clears its question on a switch; its answers live in the chat
  // modal (#137), which aborts and invalidates in-flight requests per business + scope.
  const acct = read(`${V2}/pages/Accountant.jsx`)
  assert.match(acct, /const wsKey = `\$\{active\?\.id \?\? ''\}\|\$\{scopeKey \?\? ''\}`/, 'Accountant: key = business + scope')
  assert.match(acct, /if \(wsRef\.current !== wsKey\) \{\s*wsRef\.current = wsKey\s*setQ\(''\)/, 'Accountant: reset the question on switch')
  assert.match(acct, /activeBusinessId=\{active\?\.id\}[\s\S]{0,80}scopeKey=\{scopeKey\}|scopeKey=\{scopeKey\}[\s\S]{0,80}activeBusinessId=\{active\?\.id\}/, 'Accountant: the chat gets the business + scope')
  const chat = read(`${V2}/components/AccountantChatModal.jsx`)
  assert.match(chat, /const currentScope = `\$\{activeBusinessId \?\? ''\}\|\$\{scopeKey \?\? ''\}`/, 'chat: key = business + scope')
  assert.match(chat, /scopeRef\.current !== currentScope\) \{[\s\S]{0,200}guardRef\.current\.abort\(\)[\s\S]{0,120}setThread\(\[\]\)/, 'chat: abort and wipe on switch')
  assert.match(chat, /if \(!isStale\(\) && !guardRef\.current\.isStale\(gen\)\)/, 'chat: drop a late answer')
})

// #4 was reversed at release: production showed that inside a company the `scope` column is only
// a label (its database default is 'personal'; 29 of 33 company bills carried it), so filtering on
// it hid real company payments. Isolation is by business_id on the server; Personal is a separate
// workspace. v2 therefore never filters company data by the scope label.
t('#4 (reversed at release) no v2 read filters company data by the scope label', () => {
  for (const f of walk(V2)) {
    const s = read(f)
    assert.ok(!/scope=business/.test(s), `${f} asks the server for scope=business`)
    assert.ok(!/\(\w+\.scope \|\| 'business'\) [!=]== 'business'/.test(s), `${f} drops rows by their scope label`)
  }
})

t('#5 no "Send reminder" action links anywhere; Radar shows it as NotYet', () => {
  assert.ok(!/sendReminder/.test(read(`${V2}/pages/Pulse.jsx`)), 'Pulse: use "Open invoice"')
  assert.match(read(`${V2}/pages/Pulse.jsx`), /pulse\.dec\.openInvoice/)
  const radar = read(`${V2}/pages/Radar.jsx`)
  for (const m of radar.matchAll(/radar\.sendReminder/g)) {
    const before = radar.slice(Math.max(0, m.index - 80), m.index)
    assert.match(before, /<NotYet[^>]*>\{t\('$/, 'Radar: Send reminder must be NotYet')
  }
})

t('#6 nothing in v2 links to the write-on-read /accountant/calendar page; the empty copy promises no calendar', () => {
  for (const f of walk(V2)) assert.ok(!/(to|href)=["'{`][^"'}`]*\/accountant\/calendar/.test(read(f)), `${f} links to /accountant/calendar`)
  assert.ok(!/calendar/i.test(at(en, 'acct.noEvents')), en.acct.noEvents)
})

t('#7 tax profile completeness is read from /accountant/applicability', () => {
  for (const f of ['FirstDay.jsx', 'Settings.jsx']) {
    const s = read(`${V2}/pages/${f}`)
    assert.match(s, /useApi\('\/accountant\/applicability'\)/, f)
    assert.ok(!/useApi\('\/accountant\/profile'\)/.test(s), `${f}: /profile does not return completeness`)
  }
})

t('#8 every document type from migration 031 has a label in EN/RU/ID, and unknown types fall back', () => {
  const m = /document_type TEXT NOT NULL CHECK \(document_type IN \(([^)]*)\)\)/.exec(read('migrations/031_tax_document_linking.sql'))
  const types = m[1].split(',').map((x) => x.trim().replace(/'/g, ''))
  assert.ok(types.includes('vendor_invoice') && types.length === 9)
  const docs = read(`${V2}/pages/Documents.jsx`)
  for (const k of types) {
    for (const [n, L] of [['en', en], ['ru', ru], ['id', id]]) assert.ok(at(L, `docs.type.${k}`), `${n}: docs.type.${k}`)
    assert.ok(new RegExp(`'${k}'`).test(/export const DOC_TYPES = \[([^\]]*)\]/.exec(docs)[1]), `DOC_TYPES lacks ${k}`)
  }
  assert.match(docs, /DOC_TYPES\.includes\(k\) \? k : 'other'/)
  assert.ok(!/t\(`docs\.type\.\$\{d\.document_type\}`\)/.test(docs), 'no raw key lookups')
})

t('#10 Payroll and Approvals are gated by the plan like the legacy pages', () => {
  for (const [f, flag] of [['Payroll.jsx', 'payroll_enabled'], ['Approvals.jsx', 'approval_flow_enabled']]) {
    const s = read(`${V2}/pages/${f}`)
    assert.match(s, /useAccess\(\)/, f)
    assert.match(s, new RegExp(`!accessLoading && !hasFeature\\('${flag}'\\)\\) return <>\\{head\\}<Locked`), f)
  }
})

t('#11d Performance waits for /transactions and Assets waits for /accountant/obligations', () => {
  const perf = read(`${V2}/pages/Performance.jsx`)
  assert.match(perf, /if \(needTx && tx\.loading\)/)
  assert.match(perf, /if \(needTx && tx\.error\)/)
  const assets = read(`${V2}/pages/Assets.jsx`)
  assert.match(assets, /pulse\.loading \|\| obl\.loading/)
  assert.match(assets, /if \(obl\.error\)/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
