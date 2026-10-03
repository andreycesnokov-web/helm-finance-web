// Display formatting for v2. Labels only — never an input to arithmetic.
// Compaction above a million reuses lib/money's compactAmount (half-up on the
// tenth), so v2 and the existing pages print the same figure for the same number.
import { compactAmount, currencyPrefix, formatAmount } from '../../lib/money'
import { WORKSPACE_DEFAULT_CURRENCY } from '../../lib/walletBalanceContract'

export const BASE_CCY = WORKSPACE_DEFAULT_CURRENCY
const MINUS = '−'

/** "Rp 122.9M", "Rp 300K", "Rp 950". `sign`: 'auto' adds + for positives. */
export function money(value, { currency = BASE_CCY, sign = false } = {}) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  let body
  const c = compactAmount(abs, currency)
  if (c) body = c
  else if (abs >= 1000) body = `${currencyPrefix(currency)}${Math.round(abs / 1000)}K`
  else body = `${currencyPrefix(currency)}${formatAmount(String(Math.round(abs)), currency)}`
  if (n < 0) return MINUS + body
  if (sign && n > 0) return '+' + body
  return body
}

/** Exact amount, e.g. "Rp 10,000,000" style per existing formatAmount. */
export function moneyExact(value, currency = BASE_CCY) {
  const n = Number(value || 0)
  const s = currencyPrefix(currency) + formatAmount(String(Math.abs(n)), currency)
  return n < 0 ? MINUS + s : s
}

export function dayMonth(date, locale = 'en-GB') {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export function longDate(date, locale = 'en-GB') {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function weekdayShort(date, locale = 'en-GB') {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString(locale, { weekday: 'short' })
}

/** Whole days from today (local midnight) to `date`; negative = past. */
export function daysFromToday(date, now = new Date()) {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((b - a) / 86400000)
}

export const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase()
