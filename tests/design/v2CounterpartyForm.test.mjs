// P-04 fields on counterparty save (review 8.2 #12). Run: node tests/design/v2CounterpartyForm.test.mjs
import assert from 'node:assert'
import { taxFieldsFor } from '../../client/src/v2/lib/counterpartyForm.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`) } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`) } }
console.log('\nDesign v2 counterparty form')
const cp = { entity_form: 'pt', payment_terms_days: 30 }

t('edit with unchanged entity form and terms sends neither (a manager editing a phone is not refused)', () => {
  // The form holds strings; the row holds a number — still unchanged.
  assert.deepStrictEqual(taxFieldsFor({ editing: true, cp, entityForm: 'pt', terms: 30 }), {})
  assert.deepStrictEqual(taxFieldsFor({ editing: true, cp: {}, entityForm: '', terms: null }), {})
  assert.deepStrictEqual(taxFieldsFor({ editing: true, cp: { entity_form: null, payment_terms_days: null }, entityForm: '', terms: null }), {})
})
t('edit sends only the field that changed, and null when a stored value is cleared', () => {
  assert.deepStrictEqual(taxFieldsFor({ editing: true, cp, entityForm: 'cv', terms: 30 }), { entity_form: 'cv' })
  assert.deepStrictEqual(taxFieldsFor({ editing: true, cp, entityForm: 'pt', terms: 45 }), { payment_terms_days: 45 })
  assert.deepStrictEqual(taxFieldsFor({ editing: true, cp, entityForm: '', terms: null }), { entity_form: null, payment_terms_days: null })
})
t('create sends the fields only when filled in', () => {
  assert.deepStrictEqual(taxFieldsFor({ editing: false, cp: null, entityForm: '', terms: null }), {})
  assert.deepStrictEqual(taxFieldsFor({ editing: false, cp: null, entityForm: 'person', terms: 0 }), { entity_form: 'person', payment_terms_days: 0 })
})
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
