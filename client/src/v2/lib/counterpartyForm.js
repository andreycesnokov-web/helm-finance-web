// Which P-04 fields (entity_form, payment_terms_days) a counterparty save sends.
// Only the accountant role and above may set them (server 403 otherwise), so an edit sends
// them ONLY when they changed: a manager fixing a phone number must not be refused for
// fields they never touched (review 8.2 #12). On create they are sent when filled in.
// Pure; tested in tests/design/v2CounterpartyForm.test.mjs.
const normForm = (v) => (v == null || v === '' ? null : String(v))
const normTerms = (v) => (v == null || v === '' ? null : Number(v))

export function taxFieldsFor({ editing, cp, entityForm, terms }) {
  const form = normForm(entityForm), days = normTerms(terms)
  if (!editing) return { ...(form ? { entity_form: form } : {}), ...(days != null ? { payment_terms_days: days } : {}) }
  const out = {}
  if (form !== normForm(cp?.entity_form)) out.entity_form = form
  if (days !== normTerms(cp?.payment_terms_days)) out.payment_terms_days = days
  return out
}
