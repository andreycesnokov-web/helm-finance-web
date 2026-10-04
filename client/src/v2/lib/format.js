// Design v2 money and date formatting. Pure, no React — tested in
// tests/design/v2Format.test.mjs. Formats values the API returns; computes nothing.
//
// Design conventions: "Rp 4.2M", "Rp 300K", "+Rp 1.5M", "−Rp 6.8M" (true minus
// sign), full form "Rp 250,000". Non-IDR amounts keep their own currency code and are
// never added to IDR here.

const MINUS = '−'

const trimZero = (s) => s.replace(/\.0$/, '')

/** Compact amount, e.g. 4_200_000 → "4.2M". Absolute value; sign handled by caller. */
export function compact(n) {
  const a = Math.abs(Number(n) || 0)
  if (a >= 1e12) return trimZero((a / 1e12).toFixed(1)) + 'T'
  if (a >= 1e9) return trimZero((a / 1e9).toFixed(1)) + 'B'
  if (a >= 1e6) return trimZero((a / 1e6).toFixed(1)) + 'M'
  if (a >= 1e3) return trimZero((a / 1e3).toFixed(a >= 1e5 ? 0 : 1)) + 'K'
  return String(Math.round(a))
}

const prefix = (currency) => (!currency || currency === 'IDR' ? 'Rp ' : currency + ' ')

/**
 * Money for display.
 *   money(4200000)                        → "Rp 4.2M"
 *   money(-6800000, { sign: true })       → "−Rp 6.8M"
 *   money(1500000, { sign: true })        → "+Rp 1.5M"
 *   money(250000, { full: true })         → "Rp 250,000"
 * Returns "—" for null/undefined/NaN so a missing figure is never shown as zero.
 */
export function money(v, { currency = 'IDR', sign = false, full = false } = {}) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const isCcyWithCents = currency && currency !== 'IDR'
  const body = full
    ? (isCcyWithCents && Number(n) % 1 !== 0
        ? Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : Math.round(Math.abs(n)).toLocaleString('en-US'))
    : compact(n)
  const s = n < 0 ? MINUS : sign && n > 0 ? '+' : ''
  return `${s}${prefix(currency)}${body}`
}

/** "Friday, 2 October" in the UI language. */
export function longDate(d = new Date(), lang = 'en') {
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB'
  return new Date(d).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** "2 Oct". */
export function shortDate(d, lang = 'en') {
  if (!d) return '—'
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return '—'
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB'
  return x.toLocaleDateString(loc, { day: 'numeric', month: 'short' })
}

/** Whole days from `from` (default today, local midnight) to `d`. */
export function daysUntil(d, from = new Date()) {
  const a = new Date(from); a.setHours(0, 0, 0, 0)
  const b = new Date(d); b.setHours(0, 0, 0, 0)
  if (Number.isNaN(b.getTime())) return null
  return Math.round((b - a) / 86400000)
}

/** Workspace initial for the avatar square. */
export const initial = (name = '') => (String(name).trim()[0] || '?').toUpperCase()
