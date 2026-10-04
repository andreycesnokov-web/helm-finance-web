// "+ Add" in design v2: the body of one expense or income record. Pure; tested in
// tests/design/v2AddEntry.test.mjs.
//
// Always scope 'business'. The legacy Add page and the database default both say 'personal',
// which is how company payments ended up labelled personal (see _specs/design-v2/
// RELEASE_CHECKLIST.md, "Scope labels"). The server still checks the role and that the wallet
// belongs to the active company (POST /api/transactions/batch).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_IDR = 1e15

export function addEntryBody(f = {}) {
  if (!['expense', 'income'].includes(f.type)) return { error: 'type' }
  const cur = String(f.currency || 'IDR').toUpperCase().trim()
  const raw = String(f.amount ?? '').trim()
  let amount = NaN

  if (cur === 'IDR') {
    // Whole rupiah: spaces, dots and commas are thousand separators ("1.500.000", "1 500 000").
    amount = /^\d{1,3}([\s.,]?\d{3})*$|^\d+$/.test(raw) ? Number(raw.replace(/[\s.,]/g, '')) : NaN
  } else {
    // Foreign currency (USD, EUR, SGD, USDT): allow whole or decimal amounts
    if (/^\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?$/.test(raw)) {
      amount = Number(raw.replace(/,/g, ''))
    } else if (/^\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?$/.test(raw)) {
      amount = Number(raw.replace(/\./g, '').replace(',', '.'))
    } else if (/^\d{1,3}(?:\s\d{3})*(?:[.,]\d{1,4})?$/.test(raw)) {
      amount = Number(raw.replace(/\s/g, '').replace(',', '.'))
    } else if (/^\d+(?:[.,]\d{1,4})?$/.test(raw)) {
      amount = Number(raw.replace(',', '.'))
    }
  }

  if (!(Number.isFinite(amount) && amount > 0 && amount <= MAX_IDR)) return { error: 'amount' }
  if (!f.wallet_id) return { error: 'wallet' }
  if (!DATE_RE.test(String(f.date || ''))) return { error: 'date' }
  const description = String(f.description || '').trim().slice(0, 300)
  if (!description) return { error: 'description' }
  const category = String(f.category || '').trim().slice(0, 120) || null
  return { tx: { type: f.type, amount, currency: cur, wallet_id: f.wallet_id,
    transaction_date: f.date, description, category, scope: 'business' } }
}
