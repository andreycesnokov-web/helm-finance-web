// AI Accountant (design v2) — month close, documents by transaction, tax calendar.
// Pure; tested in tests/design/v2Accounting.test.mjs. Inputs are existing responses:
// /api/transactions, /api/debts, /api/bank-import/batches, /api/wallets and the stored
// compliance events from /api/accountant/summary (read-only). Nothing here computes a tax
// amount or a deadline: dates and amounts come from the verified rule engine's events.
import { txDate, needsCategory } from './obligations.js'

const pad = (n) => String(n).padStart(2, '0')
export const monthKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}` }

/** Last `n` months, newest first: [{ key: '2026-09', start, end }]. */
export function monthOptions(n = 12, today = new Date()) {
  const out = []
  for (let i = 0; i < n; i++) {
    const s = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0)
    out.push({ key: monthKey(s), start: `${s.getFullYear()}-${pad(s.getMonth() + 1)}-01`, end: `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}` })
  }
  return out
}

/** The month to close by default: last month. */
export const defaultCloseMonth = (today = new Date()) => monthOptions(2, today)[1].key

const inMonth = (iso, key) => String(iso || '').slice(0, 7) === key
const hasDocs = (d) => (Array.isArray(d?.attachments) && d.attachments.length > 0) || !!d?.attachment_url

/**
 * Month-close readiness from what the system can actually check:
 *   categories   every money-in/out transaction of the month has a category
 *   bills        every bill/invoice dated in the month has a document attached
 *   statements   every bank account has a statement reaching the month end
 * Returns the checks and an overall percentage of complete records.
 */
export function closeReadiness({ month, transactions = [], debts = [], batches = [], wallets = [] }) {
  const tx = transactions.filter((t) => inMonth(txDate(t), month) && (t.scope || 'business') === 'business')
  const noCat = tx.filter(needsCategory)
  const bills = debts.filter((d) => d.is_training !== true && d.status !== 'cancelled' && inMonth(d.due_date || d.created_at, month))
  const noDoc = bills.filter((d) => !hasDocs(d))
  const end = monthOptions(24).find((m) => m.key === month)?.end || `${month}-28`
  const banks = wallets.filter((w) => w.type === 'bank' && w.is_active !== false && (w.scope || 'business') === 'business')
  const covered = banks.filter((w) => batches.some((b) => String(b.wallet_id) === String(w.id) && !['cancelled', 'failed'].includes(b.status) && String(b.statement_end || '') >= end))
  const records = tx.length + bills.length
  const complete = records - noCat.length - noDoc.length
  return {
    month, records, complete: Math.max(0, complete),
    percent: records ? Math.round((Math.max(0, complete) / records) * 100) : null,
    checks: [
      { key: 'statements', done: banks.length > 0 && covered.length === banks.length, total: banks.length, ok: covered.length, missing: banks.filter((w) => !covered.includes(w)).map((w) => w.name) },
      { key: 'bills', done: noDoc.length === 0 && bills.length > 0, total: bills.length, ok: bills.length - noDoc.length, missing: noDoc.map((d) => d.counterparty).filter(Boolean) },
      { key: 'categories', done: noCat.length === 0, total: tx.length, ok: tx.length - noCat.length, missing: noCat.map((t) => t.description).filter(Boolean) },
    ],
  }
}

/**
 * Documents by transaction: one row per bill/invoice and per uncategorised transaction of
 * the month, with the package it needs. Only what the records carry is marked done; the
 * withholding slip is "not tracked yet" (PROPOSALS P-05).
 */
export function packages({ month, transactions = [], debts = [] }) {
  const rows = []
  for (const d of debts) {
    if (d.is_training === true || d.status === 'cancelled' || !inMonth(d.due_date || d.created_at, month)) continue
    const pay = d.type !== 'receivable'
    const paid = d.status === 'paid'
    const items = [
      { key: pay ? 'invoice' : 'ourInvoice', done: hasDocs(d) },
      { key: pay ? 'proof' : 'received', done: paid && !!(d.linked_transaction_id || d.last_payment_at), pending: !paid },
    ]
    const missing = items.filter((i) => !i.done && !i.pending).length
    rows.push({ key: `debt:${d.id}`, id: d.id, kind: pay ? 'out' : 'in', date: d.due_date || String(d.created_at || '').slice(0, 10),
      label: d.counterparty || '', note: d.description || '', amount: Number(d.original_amount ?? d.amount ?? 0), items,
      status: missing ? 'missing' : items.every((i) => i.done) ? 'complete' : 'open', missing })
  }
  for (const t of transactions) {
    if (!inMonth(txDate(t), month) || (t.scope || 'business') !== 'business') continue
    if (!needsCategory(t) && t.type !== 'payroll') continue
    const payroll = t.type === 'payroll'
    rows.push({ key: `tx:${t.id}`, id: t.id, kind: payroll ? 'payroll' : t.type === 'income' ? 'in' : 'out', date: txDate(t),
      label: t.description || '', note: '', amount: Number(t.amount_original || 0),
      items: payroll ? [{ key: 'payslips', unknown: true }, { key: 'pph21calc', unknown: true }, { key: 'bankTransfer', done: true }]
        : [{ key: 'receipt', unknown: true }, { key: 'category', done: false }],
      status: payroll ? 'open' : 'nocat', missing: payroll ? 0 : 1 })
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function packageSummary(rows) {
  return {
    total: rows.length,
    complete: rows.filter((r) => r.status === 'complete').length,
    missing: rows.filter((r) => r.status === 'missing').length,
    nocat: rows.filter((r) => r.status === 'nocat').length,
  }
}

/** Monday-first month grid: weeks of { iso, day, inMonth }. */
export function monthGrid(key) {
  const [y, m] = key.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(y, m, 0).getDate()
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ iso: `${y}-${pad(m)}-${pad(d)}`, day: d })
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Stored compliance events (summary.overdue + summary.upcoming), de-duplicated. */
export function complianceEvents(summary) {
  const all = [...(summary?.overdue || []), ...(summary?.upcoming || [])]
  const seen = new Set()
  return all.filter((e) => { const k = e.id || `${e.rule_code}|${e.period}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))
}

/** Progress of one event, from the statuses the engine stores. */
export function eventStage(e) {
  if (['paid', 'filed'].includes(e?.payment_status) || ['paid', 'filed'].includes(e?.status)) return 'done'
  if (e?.days != null && e.days < 0) return 'overdue'
  if (e?.amount_status === 'calculated' || e?.estimated_amount != null) return 'calculated'
  return 'todo'
}
