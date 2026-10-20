// Presentation-only matching hints. The server remains the authority for links.
// created_at is the ledger write time, not evidence of the bank transaction date.
export const transactionDate = tx => String(tx?.transaction_date || tx?.date || '').slice(0, 10)
export const transactionAmount = tx => {
  const value = tx?.amount_original ?? tx?.amount
  return value == null || value === '' ? NaN : Number(value)
}
export const transactionCurrency = tx => String(tx?.currency_original || tx?.currency || '').toUpperCase()
export const transactionDirection = tx => tx?.type === 'income' ? 'in'
  : ['expense', 'payroll'].includes(tx?.type) ? 'out'
    : tx?.type === 'transfer' ? 'transfer' : 'other'
export const transactionCounterparty = tx => String(tx?.counterparty_name || tx?.counterparty || '').trim()

const clean = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const dayNumber = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed.getTime() / 86400000 : null
}

// Conservative comparison labels: only recorded, comparable values can produce a match.
export function compareDocumentTransaction(doc, tx) {
  const docAmount = doc?.gross_amount == null || doc.gross_amount === '' ? NaN : Number(doc.gross_amount)
  const txAmount = transactionAmount(tx)
  const amount = !Number.isFinite(docAmount) || !Number.isFinite(txAmount) || !doc?.currency || !tx?.currency_original ? 'unknown'
    : String(doc.currency).toUpperCase() === transactionCurrency(tx)
      && Math.abs(Math.abs(docAmount) - Math.abs(txAmount)) < 0.01 ? 'matches' : 'differs'
  const docDay = dayNumber(String(doc?.document_date || '').slice(0, 10))
  const txDay = dayNumber(transactionDate(tx))
  const date = docDay == null || txDay == null ? 'unknown' : docDay === txDay ? 'matches' : 'differs'
  const docCounterparty = doc?.issuer_counterparty_id
  const txCounterparty = tx?.counterparty_id
  const counterparty = docCounterparty == null || txCounterparty == null ? 'unknown'
    : String(docCounterparty) === String(txCounterparty) ? 'matches' : 'differs'
  return { amount, date, counterparty, insufficientDocumentData: !Number.isFinite(docAmount) || !doc?.currency || docDay == null }
}

export function transactionMatchScore(tx, doc, counterparties = []) {
  let score = 0
  const amount = Number(doc?.gross_amount)
  const txAmount = transactionAmount(tx)
  if (doc?.gross_amount != null && Number.isFinite(amount) && Number.isFinite(txAmount)
    && doc?.currency && tx?.currency_original && transactionCurrency(tx) === String(doc.currency).toUpperCase()) {
    const difference = Math.abs(Math.abs(txAmount) - Math.abs(amount))
    if (difference < 0.01) score += 100
    else if (amount > 0 && difference / amount <= 0.01) score += 15
  }
  const docDay = dayNumber(String(doc?.document_date || '').slice(0, 10))
  const txDay = dayNumber(transactionDate(tx))
  if (docDay != null && txDay != null) {
    const gap = Math.abs(docDay - txDay)
    if (gap === 0) score += 30
    else if (gap <= 3) score += 20
    else if (gap <= 14) score += 10
  }
  const issuerId = doc?.issuer_counterparty_id
  if (issuerId != null && tx?.counterparty_id != null && String(issuerId) === String(tx.counterparty_id)) score += 35
  else if (issuerId != null) {
    const issuer = counterparties.find(cp => String(cp.id) === String(issuerId))?.name
    if (issuer && clean(issuer) === clean(transactionCounterparty(tx))) score += 25
  }
  return score
}

export function filterAndRankTransactions(transactions, doc, filters, counterparties = [], linkedIds = new Set()) {
  const q = clean(filters.search)
  // Numbers inside a description must not also match unrelated amounts.
  const digits = /^(?:(?:[a-z]{3}|rp)\s*)?[+-]?[\d.,\s]+$/.test(q) ? q.replace(/\D/g, '') : ''
  return transactions.filter(tx => {
    const date = transactionDate(tx)
    if ((filters.from || filters.to) && dayNumber(date) == null) return false
    if (filters.from && date < filters.from) return false
    if (filters.to && date > filters.to) return false
    if (filters.direction !== 'all' && transactionDirection(tx) !== filters.direction) return false
    if (filters.wallet !== 'all' && String(tx.wallet_id) !== String(filters.wallet)) return false
    if (filters.unmatched && linkedIds.has(String(tx.id))) return false
    if (!q) return true
    const text = clean([transactionCounterparty(tx), tx.description, tx.source, date,
      tx.reference, tx.bank_reference, tx.reference_number, tx.external_reference].join(' '))
    const amount = transactionAmount(tx)
    const amountDigits = Number.isFinite(amount) ? String(Math.abs(amount)).replace(/\D/g, '') : ''
    return text.includes(q) || !!(digits && amountDigits.includes(digits))
  }).sort((a, b) => transactionMatchScore(b, doc, counterparties) - transactionMatchScore(a, doc, counterparties)
    || transactionDate(b).localeCompare(transactionDate(a)) || String(a.id).localeCompare(String(b.id)))
}
