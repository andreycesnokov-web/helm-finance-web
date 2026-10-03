// Pure derivations used by v2 money/obligations pages — no React, so
// tests/design/v2/obligations.test.mjs can import them directly.
import { isLive } from './debts.js'
import { remainingOf } from './counts.js'

const IN = ['income']
const OUT = ['expense', 'payroll']
const TAX_RE = /pph|pajak|\btax\b|withhold/i
const norm = (s) => String(s || '').trim().toLowerCase()

/** Latest statement batch per wallet: { [wallet_id]: { date, review } }. Pure. */
export function freshnessByWallet(batches) {
  const out = {}
  for (const b of Array.isArray(batches) ? batches : []) {
    if (!b.wallet_id || ['cancelled', 'failed'].includes(b.status)) continue
    const date = b.statement_end || b.created_at
    const cur = out[b.wallet_id]
    if (!cur || String(date) > String(cur.date)) {
      out[b.wallet_id] = { date, review: b.status === 'review_required' ? Math.max(0, (b.row_count || 0) - (b.imported_count || 0)) : 0 }
    }
  }
  return out
}

export const txDir = (tx) => (IN.includes(tx.type) ? 'in' : OUT.includes(tx.type) ? 'out' : tx.type === 'transfer' ? 'transfer' : 'other')

export const txDate = (tx) => tx.transaction_date || tx.created_at

export const needsCategory = (tx) => (txDir(tx) === 'in' || txDir(tx) === 'out') && !String(tx.category || '').trim()

/** Last `days` days by effective date, newest first. Pure. */
export function recent(txs, days = 30, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10)
  return (Array.isArray(txs) ? txs : []).filter((x) => String(txDate(x) || '').slice(0, 10) >= from)
    .sort((a, b) => String(txDate(b)).localeCompare(String(txDate(a))))
}

/** Split a payment's items into gross, tax withheld and other deductions. Pure. */
export function runBreakdown(p) {
  const items = p.payroll_payment_items || []
  const sum = (f) => items.filter(f).reduce((s, i) => s + Number(i.amount || 0), 0)
  const tax = sum((i) => i.direction === 'deduction' && TAX_RE.test(`${i.label || ''} ${i.item_type || ''}`))
  const otherDed = sum((i) => i.direction === 'deduction' && !TAX_RE.test(`${i.label || ''} ${i.item_type || ''}`))
  const net = Number(p.net_amount ?? p.amount ?? 0)
  const additions = sum((i) => i.direction !== 'deduction')
  return { gross: additions || net + tax + otherDed, tax, otherDed, net, hasTaxLine: tax > 0 }
}

export const TYPE_TO_ROLE = { supplier: 'vendor', customer: 'customer', both: 'both' }

/** Pure: form → POST body. Empty strings are dropped; NPWP keeps its digits as typed. */
export function counterpartyBody(f) {
  const body = { legal_name: f.legal_name.trim(), role: TYPE_TO_ROLE[f.type] || 'other' }
  if (f.display_name.trim()) body.display_name = f.display_name.trim()
  if (f.npwp.trim()) body.npwp = f.npwp.trim()
  if (f.pkp_status) body.pkp_status = f.pkp_status
  for (const k of ['address', 'email', 'phone', 'notes']) if (f[k] && f[k].trim()) body[k] = f[k].trim()
  if (f.bank_number.trim()) body.bank_accounts = [{ bank_name: f.bank_name.trim() || null, account_number: f.bank_number.trim(), account_name: f.bank_holder.trim() || null, is_primary: true }]
  return body
}

/** Bank holder must match the legal name (DESIGN_SPEC §3) — a warning, not a block. */
export function holderMatches(holder, legal) {
  const n = (s) => String(s || '').toLowerCase().replace(/\b(pt|cv|tbk|ud)\b\.?/g, '').replace(/[^a-z0-9]/g, '')
  if (!holder || !legal) return null
  return n(holder) === n(legal)
}

export function balancesByCounterparty(cps, debts) {
  const out = {}
  for (const c of cps) out[c.id] = { owesYou: 0, youOwe: 0, late: false }
  const byName = {}
  for (const c of cps) for (const n of [c.name, c.legal_name, c.display_name, ...(c.aliases || [])]) if (n) byName[norm(n)] = c.id
  for (const d of debts) {
    if (!isLive(d)) continue
    const id = d.counterparty_id && out[d.counterparty_id] ? d.counterparty_id : byName[norm(d.counterparty)]
    if (!id) continue
    if (d.type === 'receivable') out[id].owesYou += remainingOf(d); else out[id].youOwe += remainingOf(d)
    if (d.status === 'overdue') out[id].late = true
  }
  return out
}

export const missingDetails = (c) => !c.npwp || !(c.bank_accounts || []).length
