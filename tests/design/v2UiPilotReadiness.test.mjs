// UI Pilot Readiness automated tests. Run: node tests/design/v2UiPilotReadiness.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { billingCopy } from '../../client/src/v2/lib/billingCopy.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
const t = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (e) {
    fail++
    console.error(`  FAIL  ${name}\n        ${e.message}`)
  }
}

console.log('\n--- UI Pilot Readiness: Billing page 404 & copy')

t('billingCopy contains pilotTitle and pilotNotice across EN, RU, ID', () => {
  for (const lang of ['en', 'ru', 'id']) {
    const c = billingCopy(lang)
    assert.ok(c.pilotTitle, `missing pilotTitle for ${lang}`)
    assert.ok(c.pilotNotice, `missing pilotNotice for ${lang}`)
    assert.ok(c.pilotNotice.length > 20, `pilotNotice too short for ${lang}`)
  }
  assert.ok(billingCopy('en').pilotNotice.includes('pilot'), 'EN pilot notice mentions pilot')
  assert.ok(billingCopy('ru').pilotNotice.includes('пилот'), 'RU pilot notice mentions пилот')
  assert.ok(billingCopy('id').pilotNotice.includes('pilot'), 'ID pilot notice mentions pilot')
})

t('billingCopy contains no Cyrillic in EN or ID translations', () => {
  const cyrillic = /[\u0400-\u04FF]/
  const content = fs.readFileSync(path.join(ROOT, 'client/src/v2/lib/billingCopy.js'), 'utf8')
  const lines = content.split('\n')
  assert.equal(cyrillic.test(lines[0]), false, 'no cyrillic in EN')
  assert.equal(cyrillic.test(lines[2]), false, 'no cyrillic in ID')
})

t('Billing.jsx intercepts confirmed disabled billing and leaves other errors to ErrorBox', () => {
  const src = fs.readFileSync(path.join(ROOT, 'client/src/v2/pages/Billing.jsx'), 'utf8')
  assert.ok(src.includes('isBillingDisabled'), 'defines isBillingDisabled check')
  assert.ok(src.includes('r.error.status===404') || src.includes('r.error.status === 404'), 'checks status 404')
  assert.ok(src.includes('!r.error.data.path'), 'verifies no path property to prevent masking routing 404s')
  assert.ok(src.includes('c.pilotNotice'), 'renders c.pilotNotice when disabled')
  assert.ok(src.includes('/business/pulse'), 'includes return link to dashboard /business/pulse')
  assert.ok(src.includes('<ErrorBox error={r.error} onRetry={r.reload}/>'), 'preserves ErrorBox for unexpected errors')

  // Extract the evaluator expression from Billing.jsx to test it directly against real response shapes
  const match = src.match(/const isBillingDisabled=(Boolean\([^;]+\));/)
  assert.ok(match, 'found isBillingDisabled evaluator expression')
  const check = new Function('r', `return ${match[1]}`)

  // 1. Confirmed backend gate disabled: status 404, data: { error: 'not_found' } without path
  assert.equal(check({ error: { status: 404, data: { error: 'not_found' } } }), true, 'gate 404 is detected as disabled')
  assert.equal(check({ error: { status: 404, data: { code: 'billing_disabled' } } }), true, 'explicit billing_disabled is detected')

  // 2. Routing 404: express fallback app.use('/api', ...) includes path
  assert.equal(check({ error: { status: 404, data: { error: 'not_found', path: '/api/billing' } } }), false, 'routing 404 with path is NOT masked')

  // 3. Arbitrary 404: resource missing
  assert.equal(check({ error: { status: 404, data: { error: 'company_not_found' } } }), false, 'arbitrary 404 is NOT masked')
  assert.equal(check({ error: { status: 404, data: { error: '<html>404 Not Found</html>' } } }), false, 'HTML 404 is NOT masked')

  // 4. 500 internal server error
  assert.equal(check({ error: { status: 500, data: { error: 'database_unavailable' } } }), false, '500 error is NOT masked')

  // 5. Network / offline error
  assert.equal(check({ error: { message: 'Failed to fetch' } }), false, 'network error is NOT masked')
})

console.log('\n--- UI Pilot Readiness: DocumentIntakeModal localization and Design 2.0')

t('DocumentIntakeModal imports useTranslation and defaults to RU when unset', () => {
  const src = fs.readFileSync(path.join(ROOT, 'client/src/components/DocumentIntakeModal.jsx'), 'utf8')
  assert.ok(src.includes("import { useTranslation } from '../hooks/useTranslation'"), 'imports useTranslation')
  assert.ok(src.includes("useTranslation()"), 'calls useTranslation in component')
  assert.ok(/localStorage\.getItem\('hf_lang'\)\s*\|\|\s*'ru'/.test(src), 'defaults to ru when hf_lang is missing')
})

t('DocumentIntakeModal uses localized defaultType and detected type labels', () => {
  const src = fs.readFileSync(path.join(ROOT, 'client/src/components/DocumentIntakeModal.jsx'), 'utf8')
  assert.ok(src.includes('docTypeLabel(defaultType, lang)'), 'uses localized docTypeLabel for defaultType')
  assert.ok(src.includes('detectedLabel(it.detected, lang)'), 'uses localized detectedLabel for preliminary classification')
  assert.ok(src.includes('confLabel(it.detected.confidence, lang)'), 'uses localized confLabel for confidence level')
})

t('DocumentIntakeModal applies Design 2.0 tokens and overlay', () => {
  const src = fs.readFileSync(path.join(ROOT, 'client/src/components/DocumentIntakeModal.jsx'), 'utf8')
  assert.ok(src.includes('--surface-overlay'), 'uses --surface-overlay token for backdrop')
  assert.ok(src.includes('--surface-card'), 'uses --surface-card token for modal box')
  assert.ok(src.includes('--font-ui'), 'uses --font-ui token')
  assert.ok(!src.includes('rgba(0,0,0,.45)'), 'no hardcoded black scrim')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
