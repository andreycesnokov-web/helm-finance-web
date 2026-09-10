// AI CFO's client-side derivations.
//
// Moved verbatim out of pages/AICFO.jsx during the design-system migration, for
// the same reason radarFigures.js exists: a visual migration has to be able to
// PROVE it moved no number, and a plain module can be pinned by a unit test
// without a JSX transform.
//
// Unlike Radar, AI CFO computes almost nothing. Every financial figure — cash,
// runway, the CFO Score and its five factors, the AI alert and hiring readiness —
// is calculated server-side in buildAiCfoContext / calculateCfoScore /
// calculateAiAlertStatus / calculateHiringReadiness and arrives ready to render.
// This page has only ever derived two kinds of thing:
//
//   1. the remaining-AI-questions arithmetic, and
//   2. the DISPLAY thresholds that decide which colour a figure wears.
//
// Both are here, with their original thresholds intact, so a test can assert
// that the migration did not quietly move a boundary. What each classification
// is PAINTED as is the component's business and deliberately not encoded here —
// see the note on runwayBand.

// Explicit extensions: Vite resolves either form, but plain Node ESM does not,
// and these helpers exist precisely so a plain-Node test can import them.
import { fmt, fmtFull } from './api.js'
import { currencyPrefix } from './money.js'

/** The five CFO Score factors, in the order the page has always shown them. */
export const FACTOR_ORDER = ['cash_health', 'runway', 'payables', 'receivables', 'expense_control']

/* ── money, with its currency named ────────────────────────────────────────
   These live here rather than in AICFOBlocks.jsx for the same reason the bands
   do: a reviewer asked to see that the migration moved no digit, and a helper
   inside a .jsx file cannot be imported by a plain Node test. They are pure
   string formatting over the page's OWN formatter — fmt() and fmtFull(), the
   ones AI CFO has always used — so nothing about rounding or grouping changes.

   Deliberately NOT money.js's compactAmount(): it rounds half-up where fmt()
   does not, so it would print a different digit beside figures formatted the
   old way. See aiCfoValuePreservation.test.mjs, which renders both the old and
   the new expression over one fixture and compares them token by token.

   Days and scores are NOT money and never pass through here. */

/** What the page prints where a figure could not be measured. */
export const MISSING = '—'

/**
 * Is this a number the page is entitled to print?
 *
 * The distinction the whole module turns on: a MEASURED zero and an ABSENT
 * value are different facts, and only one of them may be rendered as "Rp 0".
 * `Number(v || 0)` collapses them — it turns null, undefined, '' and NaN into a
 * confident zero — which on this page means inventing a balance, a net flow or
 * a total that the server never sent.
 *
 * `0` and `'0'` are values. `null`, `undefined`, `''` and anything that is not a
 * finite number are not.
 */
const isMeasured = (v) =>
  v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

/** Negative zero is zero. JSON can carry -0, and it formats as "-0" — a minus
 *  sign in front of nothing, which reads as a tiny loss rather than as none. */
const normalizeZero = (v) => (Number(v) === 0 ? 0 : v)

/**
 * "Rp 122.8M", or "—" when there is no figure to show.
 *
 * Note the currency prefix goes on ONLY when there is something to prefix.
 * `currencyPrefix(c) + fmt(null)` renders "Rp —", which reads as a rupiah
 * amount that happens to be unprintable rather than as a missing measurement.
 */
export const money = (v, currency) =>
  (isMeasured(v) ? currencyPrefix(currency) + fmt(normalizeZero(v)) : MISSING)

/** The exact figure, same rule. */
export const moneyFull = (v, currency) =>
  (isMeasured(v) ? currencyPrefix(currency) + fmtFull(normalizeZero(v)) : MISSING)

/**
 * A signed figure: "+Rp 61.5M", "−Rp 22.7M", "Rp 0", or "—".
 *
 * Three rules, and each exists because the obvious implementation gets it wrong:
 *
 *   1. ABSENCE IS NOT ZERO. `Number(v || 0)` turned a missing net flow into a
 *      confident "+Rp 0" — a claim that the business broke exactly even this
 *      month, made from a field the server did not send.
 *
 *   2. ZERO TAKES NO SIGN. `n < 0 ? '−' : '+'` signs zero as positive. Zero is
 *      neither, and the page already refuses to COLOUR it (see signBand); the
 *      glyph has to agree with the colour.
 *
 *   3. A negative reads as a typographic minus (U+2212) rather than fmt()'s
 *      ASCII hyphen — the one deliberate change to a printed character in this
 *      migration, and the magnitude either side of it is pinned by test.
 */
export const signedMoney = (v, currency) => {
  if (!isMeasured(v)) return MISSING
  const n = Number(v)
  if (n === 0) return currencyPrefix(currency) + fmt(0)   // -0 included
  return (n < 0 ? '−' : '+') + currencyPrefix(currency) + fmt(Math.abs(n))
}

/**
 * Money carrying a DIRECTION rather than the sign of its own value.
 *
 * Receivables are money coming in and payables money going out, whatever the
 * magnitude — so those cards prefix a fixed glyph rather than read the number's
 * sign. Doing that at the call site produced "+Rp —" for an absent total: a
 * direction asserted about a figure that was never measured. The direction now
 * goes on only when there is a figure to give it to.
 */
export const directionalMoney = (v, currency, direction) =>
  (isMeasured(v) ? direction + money(v, currency) : MISSING)

/** A count, or "—". Same rule as money, without the currency. */
export const countOrMissing = (v) => (isMeasured(v) ? String(Number(v)) : MISSING)

/**
 * Remaining AI questions for the month, or null when the plan has no cap.
 *
 * Lifted expression-for-expression from AICFO.jsx. Read the caveat before
 * showing this as "remaining": `usage.ai_questions_this_month` is hardcoded to 0
 * on the server (index.js — "not tracked in DB yet"), in all three places it is
 * produced, so this subtraction always returns the plan's full monthly
 * allowance and never decrements. The number is real; the word "remaining" is
 * not, which is why the page labels it as an allowance.
 */
export function aiQuestionsLeft(access) {
  return access?.limits?.max_ai_questions_per_month != null
    ? Math.max(0, access.limits.max_ai_questions_per_month - (access?.usage?.ai_questions_this_month ?? 0))
    : null
}

/**
 * The CFO Score's own status bands: >= 75 healthy, >= 50 attention, below that
 * critical. The same two boundaries the server uses to set `cfo_score.status`,
 * and the same ones this page has always coloured on.
 */
export function scoreBand(score) {
  if (score >= 75) return 'healthy'
  if (score >= 50) return 'attention'
  return 'critical'
}

/**
 * A factor's band follows the IMPACT the server assigned it, never the factor's
 * own score. That distinction matters: "No payables" scores 90 with impact
 * `positive`, while "Runway adequate (30+ days)" scores 70 with impact
 * `neutral`. Colouring by score would paint the second one green.
 */
export function factorBand(impact) {
  if (impact === 'positive') return 'healthy'
  if (impact === 'negative') return 'critical'
  if (impact === 'warning') return 'attention'
  return 'neutral'
}

/**
 * Runway bands: unknown, then < 7 days critical, < 14 attention, otherwise
 * adequate. These are the page's original two boundaries, unmoved.
 *
 * This returns a BAND and not a colour on purpose. The old page painted the
 * top band green (#34D399), which claimed 14 days of cash was a healthy
 * position; the component now leaves that band uncoloured. The boundary is the
 * thing worth pinning, so the boundary is what lives here.
 */
export function runwayBand(days) {
  if (days === null || days === undefined) return 'unknown'
  if (days < 7) return 'critical'
  if (days < 14) return 'attention'
  return 'adequate'
}

/** A signed figure's band. Zero is neither good nor bad and gets no colour. */
export function signBand(value) {
  const n = Number(value || 0)
  if (n > 0) return 'positive'
  if (n < 0) return 'negative'
  return 'neutral'
}

/**
 * Is there provably no financial data behind this context yet?
 *
 * The reason this exists: the server's CFO Score is computed from the ABSENCE of
 * data as readily as from data. An untouched workspace takes the "not enough
 * expense history" (70), "runway unknown" (60), "no receivables" (80), "no
 * payables" (90, impact positive) and "no monthly data" (60) branches, which
 * weight to 72 — so a business that has entered nothing is told its financial
 * health is 72 out of 100 and its payables are in excellent shape. That is a
 * verdict about a business, derived from silence.
 *
 * The engine is not changed here — not one threshold, weight or branch. The page
 * simply declines to present the verdict when there is demonstrably nothing
 * behind it, and shows a next action instead.
 *
 * What counts as "something to assess" is TRANSACTIONS, DEBT or a BALANCE — not
 * wallets. Every factor the engine scores is derived from transaction history:
 * cash health from balance over monthly expenses, runway from the burn rate,
 * expense control from income against expenses. A workspace that has added three
 * bank accounts and imported nothing has given the engine exactly as much to
 * work with as an untouched one, and was still being scored 72 for it. Wallet
 * count is therefore deliberately NOT part of this test.
 *
 * The zeros themselves are not the problem and are not hidden: an empty wallet
 * really does hold Rp 0, and the flagship card keeps saying so. What is withheld
 * is the VERDICT — a score, a status and five graded factors — because that is
 * the part inferred from silence rather than measured.
 *
 * Deliberately conservative in the other direction: one transaction, one open
 * debt or any balance at all, and the page renders the real figures. Missing
 * fields are not read as zeros — an absent count means the payload was not the
 * shape we expected, which is not proof that the workspace is empty.
 */
export function hasNoFinancialData(ctx) {
  if (!ctx) return false
  const cash = ctx.cash || {}
  const month = ctx.current_month || {}
  const recv = ctx.receivables || {}
  const pay = ctx.payables || {}
  const zero = (v) => Number(v || 0) === 0
  return month.transactions_count === 0
    && zero(cash.total_balance)
    && zero(recv.total_remaining)
    && zero(pay.total_remaining)
}

export default {
  FACTOR_ORDER, MISSING, money, moneyFull, signedMoney, directionalMoney, countOrMissing,
  aiQuestionsLeft, scoreBand, factorBand, runwayBand, signBand, hasNoFinancialData,
}
