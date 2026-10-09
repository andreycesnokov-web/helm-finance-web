// Bills & invoices, approvals, counterparties, accounts and transactions — pure
// helpers over existing API responses. Tested in tests/design/v2Obligations.test.mjs.
// Nothing here computes tax: a withholding split is only shown when the verified rule
// engine supplied a rate (see withholdingSplit).

import { csvCell } from './csv.js'

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export const remaining = (d) => num(d?.remaining_amount ?? d?.amount)
export const isOpen = (d) => !!d && !['paid', 'cancelled'].includes(d.status) && d.approval_status !== 'rejected'
export const isPending = (d) => isOpen(d) && d.approval_status === 'pending_approval'

/** Row status for Bills & invoices: pending | late | partial | open | paid | cancelled. */
export function billStatus(d) {
  if (!d) return 'open'
  if (d.status === 'cancelled' || d.approval_status === 'rejected') return 'cancelled'
  if (d.status === 'paid') return 'paid'
  if (d.approval_status === 'pending_approval') return 'pending'
  if (d.status === 'overdue') return 'late'
  if (d.status === 'partial') return 'partial'
  return 'open'
}

/** The tab a route presets. */
export function tabForPath(pathname = '') {
  if (/\/business\/receivables/.test(pathname)) return 'collect'
  if (/\/business\/invoices/.test(pathname)) return 'all'
  return 'pay'
}

/** Summary for the two headline cards. Server totals (confirmed items) come from
 *  /api/pulse; this adds the counts and the late / pending / due-soon parts. */
export function billSummary(debts = [], { today = new Date(), soonDays = 14 } = {}) {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0)
  const soon = new Date(t0); soon.setDate(soon.getDate() + soonDays)
  const open = debts.filter(isOpen)
  const confirmed = open.filter((d) => !isPending(d))
  const side = (type) => {
    const xs = confirmed.filter((d) => d.type === type)
    return {
      count: xs.length,
      total: xs.reduce((s, d) => s + remaining(d), 0),
      late: xs.filter((d) => d.status === 'overdue').reduce((s, d) => s + remaining(d), 0),
      lateCount: xs.filter((d) => d.status === 'overdue').length,
      dueSoon: xs.filter((d) => d.status !== 'overdue' && d.due_date && new Date(d.due_date) <= soon).reduce((s, d) => s + remaining(d), 0),
      pending: open.filter((d) => d.type === type && isPending(d)).reduce((s, d) => s + remaining(d), 0),
      pendingCount: open.filter((d) => d.type === type && isPending(d)).length,
    }
  }
  return { collect: side('receivable'), pay: side('payable') }
}

/** Rows for a tab and a view (open | paid). Sorted by due date, undated last. */
export function billRows(debts = [], { tab = 'pay', view = 'open' } = {}) {
  const type = tab === 'collect' ? 'receivable' : tab === 'pay' ? 'payable' : null
  return debts
    .filter((d) => d.is_training !== true)
    .filter((d) => (type ? d.type === type : true))
    .filter((d) => (view === 'paid' ? d.status === 'paid' : isOpen(d)))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : 0)
}

/**
 * Supplier / tax-office split for a payable. Uses ONLY a rate the verified rule engine
 * returned (findWithholdingRule over GET /api/accountant/rules). No rate → null, and the
 * UI says the split is not available. Never a hard-coded percentage.
 */
export function withholdingSplit(amount, engineRate) {
  const rate = Number(engineRate)
  const gross = num(amount)
  if (!(rate > 0 && rate < 100) || !(gross > 0)) return null
  const tax = Math.round(gross * (rate / 100))
  return { gross, rate, tax, net: gross - tax }
}

/**
 * Does this bill carry a withholding treatment? (review 8.2 #9)
 *   'withhold'  the counterparty's default tax treatment names a withholding (PPh 23 / 4(2) /
 *               "withhold") and does not say "no"/"not"/"none"
 *   'applied'   the bill was already created net of withholding (its description says so)
 *   null        no treatment → no split is shown (goods, fuel, "no withholding" parties …)
 * The rate itself still comes only from the verified rule engine.
 */
export function withholdingTreatment(debt, counterparty) {
  if (!debt || debt.type === 'receivable' || (debt.currency || 'IDR') !== 'IDR') return null
  if (/\bwithheld\b/i.test(String(debt.description || ''))) return 'applied'
  // A withholding record already took the tax off what is still open (batch 10): never split twice.
  if (Number(debt.withholding_allocated) > 0) return 'applied'
  const tt = String(counterparty?.default_tax_treatment || '').toLowerCase()
  if (!tt || /\b(no|not|none|tidak)\b/.test(tt)) return null
  return /pph[\s_]*23|4\s*\(\s*2\s*\)|pph[\s_]*4[\s_]*2|withhold|potong/.test(tt) ? 'withhold' : null
}

/**
 * How a counterparty has paid (receivables) or been paid (payables), from history.
 * `names` is every name the counterparty goes by (legal, display, short); a bill matches any
 * of them. Open balances are split by direction — what they owe us and what we owe them are
 * never added together — and items waiting for approval are left out, as on Pulse and Radar.
 * Returns null when no name is given or nothing matches, so a caller can fall back.
 */
export function payerHistory(debts = [], names) {
  const keys = new Set((Array.isArray(names) ? names : [names]).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean))
  if (!keys.size) return null
  const mine = debts.filter((d) => keys.has(String(d.counterparty || '').trim().toLowerCase()))
  if (!mine.length) return null
  const paid = mine.filter((d) => d.status === 'paid' && d.due_date && d.last_payment_at)
  const lateDays = paid.map((d) => Math.round((new Date(d.last_payment_at) - new Date(d.due_date)) / 86400000))
  const onTime = lateDays.filter((x) => x <= 0).length
  const avgLate = lateDays.length ? Math.round(lateDays.reduce((s, x) => s + Math.max(0, x), 0) / lateDays.length) : null
  const open = mine.filter((d) => isOpen(d) && !isPending(d))
  const sum = (xs) => xs.reduce((s, d) => s + remaining(d), 0)
  const theirs = open.filter((d) => d.type === 'receivable'), ours = open.filter((d) => d.type !== 'receivable')
  const late = (xs) => xs.filter((d) => d.status === 'overdue')
  return {
    paidCount: paid.length, onTime, avgLate,
    theyOwe: sum(theirs), weOwe: sum(ours),
    lateTheyOwe: sum(late(theirs)), lateWeOwe: sum(late(ours)),
  }
}

const digits = (s) => String(s || '').replace(/\D/g, '')

/** Possible duplicate pairs: same NPWP, or the same bank account number. Suggestion
 *  only — the UI never merges (DESIGN_SPEC: duplicate suggestions, never auto-merge). */
export function duplicatePairs(counterparties = []) {
  const active = counterparties.filter((c) => c && c.is_active !== false && c.status !== 'archived')
  const pairs = []
  const seen = new Set()
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j]
      let reason = null, detail = null
      if (digits(a.npwp).length >= 15 && digits(a.npwp) === digits(b.npwp)) { reason = 'npwp'; detail = a.npwp }
      else {
        const acc = (c) => (c.bank_accounts || []).map((x) => digits(x.account_number)).filter((x) => x.length >= 6)
        const shared = acc(a).find((n) => acc(b).includes(n))
        if (shared) { reason = 'bank'; detail = shared.slice(-4) }
      }
      if (!reason) continue
      const k = [a.id, b.id].sort().join('|')
      if (seen.has(k)) continue
      seen.add(k)
      pairs.push({ a, b, reason, detail })
    }
  }
  return pairs
}

/** NPWP format check: 15 digits (legacy) or 16 digits (NIK-based). Format only. */
export function npwpFormat(value) {
  const d = digits(value)
  if (!d) return 'empty'
  return d.length === 15 || d.length === 16 ? 'ok' : 'bad'
}

const norm = (s) => String(s || '').toLowerCase().replace(/\b(pt|cv|tbk|ud|persero)\b/g, '').replace(/[^a-z0-9]/g, '')
/** Bank holder name vs legal name (DESIGN_SPEC: "bank holder must match"). */
export function holderMatches(holder, legalName) {
  if (!holder || !legalName) return null
  return norm(holder) === norm(legalName)
}

/** Counterparty list filter: all | customer | supplier | missing. */
export function cpFilter(cp, f) {
  if (f === 'customer') return cp.role === 'customer' || cp.role === 'both'
  // A landlord supplies the premises; a lender is not a supplier (P-04 roles).
  if (f === 'supplier') return cp.role === 'vendor' || cp.role === 'both' || cp.role === 'landlord'
  if (f === 'missing') return !cp.npwp
  return true
}

/** Transactions: effective date, direction and "needs a category". */
export const txDate = (t) => String(t?.transaction_date || t?.created_at || '').slice(0, 10)
export function txDir(t) {
  if (['income'].includes(t?.type)) return 'in'
  if (['expense', 'payroll'].includes(t?.type)) return 'out'
  if (t?.type === 'transfer') return 'transfer'
  return 'other'
}
export const needsCategory = (t) => (txDir(t) === 'in' || txDir(t) === 'out') && !String(t?.category || '').trim()

export function txFilter(rows = [], { kind = 'all', walletId = 'all', days = 30, q = '', today = new Date() } = {}) {
  const from = new Date(today); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - days)
  const fromIso = days ? from.toISOString().slice(0, 10) : ''
  const needle = q.trim().toLowerCase()
  return rows
    .filter((t) => !days || txDate(t) >= fromIso)
    .filter((t) => walletId === 'all' || String(t.wallet_id) === String(walletId))
    .filter((t) => kind === 'all' || (kind === 'review' ? needsCategory(t) : txDir(t) === kind))
    .filter((t) => !needle || [t.description, t.category, t.counterparty, t.source, String(t.amount_original)]
      .some((v) => String(v || '').toLowerCase().includes(needle)))
    .sort((a, b) => (txDate(a) < txDate(b) ? 1 : txDate(a) > txDate(b) ? -1 : 0))
}

/** Where a transaction came from, from fields the row already carries. */
export function txSource(t) {
  if (t?.bank_import_batch_id || t?.bank_import_row_id) return 'bank'
  if (t?.source === 'wallet_opening_balance') return 'opening'
  if (t?.payroll_payment_id || t?.type === 'payroll') return 'payroll'
  if (t?.telegram_message_id || t?.created_by_telegram_id) return 'telegram'
  return 'added'
}

/** CSV of the rows on screen (client-side export; no backend). */
export function toCsv(rows) {
  const esc = csvCell
  const head = ['date', 'type', 'description', 'category', 'amount', 'currency', 'wallet_id', 'source']
  return [head.join(','), ...rows.map((t) => [txDate(t), t.type, t.description, t.category, t.amount_original, t.currency_original || 'IDR', t.wallet_id, t.source].map(esc).join(','))].join('\n')
}

/** Latest statement per wallet from bank-import batches (statement_end, else created_at). */
export function statementFreshness(batches = []) {
  const out = {}
  for (const b of batches) {
    if (!b.wallet_id || ['cancelled', 'failed'].includes(b.status)) continue
    const d = String(b.statement_end || b.created_at || '').slice(0, 10)
    if (!d) continue
    if (!out[b.wallet_id] || out[b.wallet_id].date < d) out[b.wallet_id] = { date: d, status: b.status, id: b.id }
  }
  return out
}

/** Payroll: the latest pay period and its per-person lines from /api/payroll/overview. */
export function latestPayrollRun(overview) {
  const pays = Array.isArray(overview?.payments) ? overview.payments : []
  if (!pays.length) return null
  const period = pays.map((p) => p.period_month || String(p.payment_date || '').slice(0, 7)).filter(Boolean).sort().pop()
  const inRun = pays.filter((p) => (p.period_month || String(p.payment_date || '').slice(0, 7)) === period)
  const isTax = (i) => i.direction === 'deduction' && /pph|pajak|\btax\b|withhold/i.test(`${i.label || ''} ${i.item_type || ''}`)
  const isBpjs = (i) => i.direction === 'deduction' && /bpjs/i.test(`${i.label || ''} ${i.item_type || ''}`)
  const people = inRun.map((p) => {
    const items = p.payroll_payment_items || []
    const tax = items.filter(isTax).reduce((s, i) => s + num(i.amount), 0)
    return {
      id: p.id, employee_id: p.employee_id, name: p.employee_name || p.recipient_name || null,
      gross: num(p.gross_amount ?? p.amount), tax: items.some(isTax) ? tax : null,
      bpjs: items.filter(isBpjs).reduce((s, i) => s + num(i.amount), 0),
      net: num(p.net_amount ?? p.amount), status: p.status, date: p.payment_date,
    }
  })
  const sum = (k) => people.reduce((s, x) => s + num(x[k]), 0)
  return {
    period, people, gross: sum('gross'), net: sum('net'), bpjs: sum('bpjs'),
    tax: people.some((x) => x.tax != null) ? sum('tax') : null,
    paid: inRun.every((p) => p.status === 'paid'), date: inRun.map((p) => p.payment_date).filter(Boolean).sort().pop() || null,
  }
}

/**
 * Bill detail checklist (designs/BillDetail.dc.html): invoice, payment proof, withholding
 * slip (only when the verified engine computed a withholding) and accountant check.
 *   slip   read from withholding_records.bukti_potong_document_id (migration 031, via
 *          GET /api/withholding-slips) — `slips` is { available, by_debt }. Read-only here.
 *   check  the P-05 mark (migration 061); before 061 it is `unknown`, never claimed done.
 */
// A bill counts as documented when the Document Center links a document to it
// (document_debt_links, returned by GET /api/debts as document_links / linked_documents_count)
// or it carries a legacy attachment. Before, only legacy attachments counted, so a bill with a
// linked invoice still asked for one and showed up as "missing" on Documents.
export const billHasDocument = (d) => !!d && ((Array.isArray(d.document_links) && d.document_links.length > 0)
  || Number(d.linked_documents_count) > 0 || (Array.isArray(d.attachments) && d.attachments.length > 0) || !!d.attachment_url)
// The classic Document Center opens this document's review from ?doc=<id>.
export const classicDocPath = (doc) => `/business/documents/classic?doc=${encodeURIComponent(doc.id)}`

export function billChecklistItems(d, { hasInvoice = false, paid = false, slipNeeded = false, slips = null, invoiceDocPath = null } = {}) {
  const checkTracked = !!d && Object.prototype.hasOwnProperty.call(d, 'accountant_checked_at')
  const slipTracked = slips?.available === true
  const slipDoc = slipTracked ? slips.by_debt?.[String(d?.id)]?.slip_document_id || null : null
  return [
    { key: 'invoice', done: !!hasInvoice, link: hasInvoice ? (invoiceDocPath || '/business/documents') : null },
    { key: 'proof', done: !!paid && !!(d?.linked_transaction_id || d?.last_payment_at) },
    ...(slipNeeded ? [{ key: 'slip', done: !!slipDoc, unknown: !slipTracked, documentId: slipDoc }] : []),
    { key: 'check', done: checkTracked && !!d.accountant_checked_at, unknown: !checkTracked, editable: checkTracked },
  ]
}

/**
 * Money rows that no account picks up: no wallet_id, and the source text matches no wallet
 * name (GET /api/wallets links a row by wallet_id or by an exact source = wallet name).
 * Their cash counts in the company total on Pulse but in no account balance, so Accounts
 * shows the difference instead of hiding it. Signed: income +, expense/payroll −.
 */
export function unlinkedMoney(transactions = [], wallets = []) {
  const names = new Set((wallets || []).map((w) => w.name))
  let sum = 0, count = 0
  for (const t of transactions || []) {
    if (!t || t.wallet_id || names.has(t.source)) continue
    const a = Number(t.amount_idr ?? t.amount_original ?? 0) || 0
    const d = t.type === 'income' ? a : (t.type === 'expense' || t.type === 'payroll') ? -a : t.type === 'correction' ? a : 0
    if (!d) continue
    sum += d; count++
  }
  return { sum, count }
}
