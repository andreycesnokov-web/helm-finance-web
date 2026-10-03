// Profit from confirmed category groups (Design v2 P-10; DECISIONS.md "P-10 decisions").
// Pure; tested in tests/design/v2Pnl.test.mjs.
//
// Used only once a business has CONFIRMED a mapping (any category with pnl_group). Until
// then Performance keeps the classifier estimate (lib/performance.js profitRows), and Pulse
// and AI CFO keep the keyword classifier — nothing here touches them.
//
// Accrual (P-10):
//   * A bill or invoice (debts) counts in the month it was issued/received, at its full
//     amount, by its category's group — paid or not. An invoice paid net of PPh 23 keeps its
//     full revenue (the withheld part is a tax prepayment, never a cost or a revenue cut).
//   * A payment that settles a bill (debts.linked_transaction_id) is not counted again.
//   * Every other income / expense / payroll transaction counts in its own month by group.
//   * Records with no category, or a category with no confirmed group, are NEVER guessed:
//     they stay out of profit and are counted in "N of M records have a category".
//   * revenue → gross profit (− direct_cost) → EBITDA (− operating_cost) → operating profit
//     (no depreciation until the asset register, P-11) → + other_income (shown net, e.g.
//     deposit interest after the bank's final tax) − interest (loans we owe) → profit before
//     tax − tax (the company's own tax) → net profit.
//   * asset_purchase, funding and transfer are never in profit.
//   * Asset register (P-11): a bill or payment registered as an asset (assets.purchase_debt_id
//     / purchase_transaction_id) is left out whatever its category — no double counting —
//     and the register's straight-line depreciation (computed by the server from the verified
//     rule) is subtracted after EBITDA: operating profit = EBITDA − depreciation.
//   * Funding register (P-03): a payment that settles a loan repayment is split by the
//     register — principal is funding (never profit), interest goes to the 'interest' group
//     in the month the repayment falls due — instead of using the payment's category.
import { txDate } from './obligations.js'

export const GROUPS = ['revenue', 'direct_cost', 'operating_cost', 'interest', 'other_income', 'tax', 'asset_purchase', 'funding', 'transfer']
// Tax profile regimes that pay the UMKM final tax on turnover (TaxProfile.jsx options).
export const TURNOVER_TAX_REGIMES = ['pph_final_umkm', 'pp23_final']
const PROFIT_TX_TYPES = ['income', 'expense', 'payroll']

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Has this business confirmed a mapping? (Any of its categories carries a group.) */
export const mappingConfirmed = (categories = []) => (categories || []).some((c) => c && GROUPS.includes(c.pnl_group))

/** Category name (normalised) → confirmed group. */
export function groupMap(categories = []) {
  const m = new Map()
  for (const c of categories || []) if (c && GROUPS.includes(c.pnl_group)) m.set(norm(c.name), c.pnl_group)
  return m
}

/** "Turnover tax (0.5%)" when the tax profile is UMKM final, else income tax. */
export const taxLabelKey = (regime) => (TURNOVER_TAX_REGIMES.includes(regime) ? 'turnover' : 'income')

const debtMonth = (d) => String(d.invoice_date || d.issue_date || d.created_at || d.due_date || '').slice(0, 7)
const debtCounts = (d) => d && d.status !== 'cancelled' && d.is_training !== true
  && !['pending_approval', 'rejected'].includes(d.approval_status) && (d.currency || 'IDR') === 'IDR'

/**
 * Monthly accrual rows from confirmed groups.
 * @returns {{ rows: Array, coverage: { categorised, total, missing: Array } }}
 */
export function accrualRows({ transactions = [], debts = [], categories = [], months = [], assets = null, funding = null } = {}) {
  const map = groupMap(categories)
  const inWindow = new Set(months)
  const sums = Object.fromEntries(months.map((k) => [k, Object.fromEntries(GROUPS.map((g) => [g, 0]))]))
  let total = 0, categorised = 0
  const missing = new Map()
  const miss = (name) => { const k = name || '—'; missing.set(k, (missing.get(k) || 0) + 1) }

  const settlementTx = new Set((debts || []).map((d) => d && d.linked_transaction_id).filter((x) => x != null).map(String))
  const assetList = Array.isArray(assets?.assets) ? assets.assets : []
  const assetDebts = new Set(assetList.map((a) => a.purchase_debt_id).filter((x) => x != null).map(String))
  const assetTx = new Set(assetList.map((a) => a.purchase_transaction_id).filter((x) => x != null).map(String))
  const dep = assets?.depreciation_by_month || {}
  const repaymentTx = new Set((funding?.repayment_transactions || []).map(String))
  const loanInterest = funding?.interest_by_month || {}

  for (const d of debts || []) {
    if (!debtCounts(d) || assetDebts.has(String(d.id))) continue
    const k = debtMonth(d)
    if (!inWindow.has(k)) continue
    total++
    const g = map.get(norm(d.category))
    if (!g) { miss(d.category); continue }
    categorised++
    const amt = num(d.original_amount ?? d.amount)
    sums[k][g] += d.type === 'receivable' ? amt : -amt
  }
  for (const t of transactions || []) {
    if (!t || !PROFIT_TX_TYPES.includes(t.type)) continue
    // Every company row counts, whatever its scope label (see lib/performance.js, isBizIdr).
    if (t.currency_original && t.currency_original !== 'IDR') continue
    if (settlementTx.has(String(t.id)) || assetTx.has(String(t.id)) || repaymentTx.has(String(t.id))) continue
    const k = txDate(t).slice(0, 7)
    if (!inWindow.has(k)) continue
    total++
    const g = map.get(norm(t.category))
    if (!g) { miss(t.category); continue }
    categorised++
    const amt = num(t.amount_original)
    sums[k][g] += t.type === 'income' ? amt : -amt
  }

  const rows = months.map((k) => {
    const s = sums[k]
    const revenue = s.revenue
    const direct = 0 - s.direct_cost
    const gross = revenue - direct
    const opex = 0 - s.operating_cost
    const ebitda = gross - opex
    const depreciation = Number(dep[k]) || 0
    const operating = ebitda - depreciation
    const otherIncome = s.other_income
    const interest = 0 - s.interest + (Number(loanInterest[k]) || 0)
    const pbt = operating + otherIncome - interest
    const tax = 0 - s.tax
    const empty = GROUPS.every((g) => s[g] === 0)
    return { month: k, empty: empty && !depreciation, revenue, direct, gross, opex, ebitda, depreciation, operating, otherIncome, interest, pbt, tax,
      net: pbt - tax, assets: 0 - s.asset_purchase, margin: revenue > 0 ? gross / revenue : null }
  })
  return {
    rows,
    hasRegister: !!assets && assets.available === true,
    hasFunding: !!funding && funding.available === true,
    coverage: { categorised, total, missing: [...missing.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) },
  }
}
