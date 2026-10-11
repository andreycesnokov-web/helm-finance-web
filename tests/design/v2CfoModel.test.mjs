// AI CFO page model. Run: node tests/design/v2CfoModel.test.mjs
import assert from 'node:assert'
import { mapRoute, topDecisions, briefParts, questionsLeft, scoreTone, FACTORS } from '../../client/src/v2/lib/cfoModel.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 AI CFO model')

t('legacy action routes map into the business workspace; unknown routes link nowhere', () => {
  assert.strictEqual(mapRoute('/receivables'), '/business/receivables')
  assert.strictEqual(mapRoute('/accountant/calendar'), '/business/accountant?tab=taxes')
  assert.strictEqual(mapRoute('/business/radar'), '/business/radar')
  assert.strictEqual(mapRoute('/admin'), null)
  assert.strictEqual(mapRoute('/personal'), null)
  assert.strictEqual(mapRoute(undefined), null)
})

t('top three decisions, most urgent first', () => {
  const d = topDecisions({ next_actions: [{ title: 'c', priority: 'low' }, { title: 'a', priority: 'high' }, { title: 'b', priority: 'medium' }, { title: 'd', priority: 'critical' }] })
  assert.deepStrictEqual(d.map((x) => x.title), ['d', 'a', 'b'])
})

t('brief uses business figures only, never personal cash', () => {
  const parts = briefParts({ current_month: { income: 1, expenses: 3, net_flow: -2 }, runway_days: 40,
    receivables: { total_remaining: 5, overdue_total: 2, overdue_count: 1 }, pending_submissions: { count: 2 },
    wallets_summary: { personal_cash: 999 } })
  assert.deepStrictEqual(parts.map((p) => p.key), ['cfo.brief.loss', 'cfo.brief.runway', 'cfo.brief.owed', 'cfo.brief.late', 'cfo.brief.pending'])
  assert.ok(!JSON.stringify(parts).includes('999'))
  assert.deepStrictEqual(briefParts(null), [])
})

t('questions left only when the plan has a limit', () => {
  assert.strictEqual(questionsLeft({ usage: {} }), null)
  assert.deepStrictEqual(questionsLeft({ usage: { max_ai_questions_per_month: 200, remaining_ai_questions: 150 } }), { left: 150, max: 200 })
})

t('score tones and factor order', () => {
  assert.deepStrictEqual(['healthy', 'warning', 'critical', 'x'].map(scoreTone), ['good', 'warn', 'crit', 'neutral'])
  assert.strictEqual(FACTORS.length, 5)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
