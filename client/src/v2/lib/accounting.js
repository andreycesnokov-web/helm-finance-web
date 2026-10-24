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

/**
 * The Accountant page month from ?month=. Only a month the picker offers (the last 12) is
 * accepted; anything else — garbage, a future month, a month too old — falls back to the
 * tab's default: the current month for Tax calendar, last month for close and packages.
 * The tab links carry no month, so switching tabs resets it to that tab's default.
 */
export function accountantMonth(param, tab, today = new Date()) {
  const keys = monthOptions(12, today).map((m) => m.key)
  if (typeof param === 'string' && keys.includes(param)) return param
  return tab === 'taxes' ? keys[0] : defaultCloseMonth(today)
}

const inMonth = (iso, key) => String(iso || '').slice(0, 7) === key
export const hasDocs = (d) =>
  (Array.isArray(d?.attachments) && d.attachments.length > 0) ||
  !!d?.attachment_url ||
  (Array.isArray(d?.document_links) && d.document_links.length > 0) ||
  (Array.isArray(d?.linked_documents) && d.linked_documents.length > 0) ||
  (Number(d?.linked_documents_count) > 0) ||
  d?._hasLinkedDocs === true

export const isBankWallet = (w) =>
  (w?.type === 'bank' || (!w?.type && !/cash/i.test(w?.name || ''))) &&
  w?.type !== 'cash' &&
  !/cash/i.test(w?.name || '') &&
  w?.is_active !== false

/**
 * Strict calendar date verification:
 * Checks standard YYYY-MM-DD pattern, realistic bounds (1990..2099),
 * and verifies that day/month actually exist on the calendar (rejects Feb 30, April 31, Feb 29 on non-leap years).
 */
export function isValidCalendarDate(val) {
  if (!val) return false
  let str = ''
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return false
    str = val.toISOString()
  } else if (typeof val === 'string') {
    str = val.trim()
  } else {
    return false
  }
  // Strict format check: pure YYYY-MM-DD or standard ISO timestamp YYYY-MM-DD[T ]HH:mm:ss...
  // Entire string must match without trailing junk/tail characters.
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/)
  if (!match) return false
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 1990 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return false
  if (match[4] !== undefined) {
    const hh = Number(match[4])
    const mm = Number(match[5])
    const ss = Number(match[6])
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return false
  }
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(dt.getTime())) return false
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d
}

/** Check whether a batch has a valid, non-corrupted date range (start <= end and not spanning multiple decades) */
export const isBatchPeriodValid = (b) => {
  if (!b) return false
  if (!b.statement_start && !b.statement_end) return true // Batch with unspecified period is not invalid
  if (b.statement_start && !isValidCalendarDate(b.statement_start)) return false
  if (b.statement_end && !isValidCalendarDate(b.statement_end)) return false
  if (b.statement_start && b.statement_end) {
    const s = new Date(`${String(b.statement_start).slice(0, 10)}T00:00:00Z`).getTime()
    const e = new Date(`${String(b.statement_end).slice(0, 10)}T00:00:00Z`).getTime()
    if (isNaN(s) || isNaN(e) || s > e) return false
    const diffDays = Math.round((e - s) / (1000 * 60 * 60 * 24))
    // A corrupted multi-decade span (e.g. 2000-2032 spans > 10,000 days / ~30 years) is blocked
    if (diffDays > 365 * 5) return false
  }
  return true
}

/** Check whether statement rows contain corrupted dates (impossible calendar dates, invalid strings) or invalid amounts */
export const hasCorruptRows = (rows = []) => {
  return (rows || []).some(r => {
    if (!isValidCalendarDate(r.tx_date)) return true
    if (r.amount === null || r.amount === undefined || String(r.amount).trim() === '') return true
    if (!Number.isFinite(Number(r.amount))) return true
    return false
  })
}

/**
 * Month-close readiness from what the system can actually check:
 *   categories   every money-in/out transaction of the month has a category
 *   bills        every bill/invoice dated in the month has a document attached
 *   statements   every bank account has a statement reaching the month end
 * Returns the checks and an overall percentage of complete records.
 */
export function closeReadiness({ month, transactions = [], debts = [], batches = [], wallets = [], operationDocuments = null }) {
  // Every company row counts, whatever its scope label (see lib/performance.js, isBizIdr).
  const tx = transactions.filter((t) => inMonth(txDate(t), month))
  const noCat = tx.filter(needsCategory)
  const bills = debts.filter((d) => d.is_training !== true && d.status !== 'cancelled' && inMonth(d.due_date || d.created_at, month))
  const noDoc = bills.filter((d) => !hasDocs(d))
  const mOpt = monthOptions(24).find((m) => m.key === month)
  const start = mOpt?.start || `${month}-01`
  const end = mOpt?.end || `${month}-28`
  const banks = wallets.filter(isBankWallet)

  const isFiniteNumber = (val) => val != null && val !== '' && typeof val !== 'boolean' && Number.isFinite(Number(val)) && !Number.isNaN(Number(val))
  const toIsoDateStr = (val) => {
    if (!val) return null
    if (typeof val === 'string') return val.trim().slice(0, 10)
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      const y = val.getUTCFullYear()
      const m = String(val.getUTCMonth() + 1).padStart(2, '0')
      const d = String(val.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    return null
  }
  const isValidIsoDate = (val) => {
    const str = toIsoDateStr(val)
    if (!str) return false
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return false
    const [_, y, m, d] = match
    const dt = new Date(`${y}-${m}-${d}T00:00:00Z`)
    if (Number.isNaN(dt.getTime())) return false
    return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() + 1 === Number(m) && dt.getUTCDate() === Number(d)
  }

  const isBatchDurationValid = (bStart, bEnd) => {
    if (!bStart || !bEnd) return false
    const s = new Date(`${bStart}T00:00:00Z`).getTime()
    const e = new Date(`${bEnd}T00:00:00Z`).getTime()
    if (isNaN(s) || isNaN(e)) return false
    const diffDays = Math.round((e - s) / 86400000)
    return diffDays >= 0 && diffDays <= 365 * 5 // Reject corrupted multi-decade spans like 2000-2032
  }

  const withStatements = banks.filter((w) =>
    batches.some((b) => {
      if (String(b.wallet_id) !== String(w.id)) return false
      if (['cancelled', 'failed'].includes(b.status)) return false
      if (!isValidIsoDate(b.statement_start) || !isValidIsoDate(b.statement_end)) return false
      const bStart = toIsoDateStr(b.statement_start)
      const bEnd = toIsoDateStr(b.statement_end)
      if (bStart > bEnd) return false
      if (!isBatchDurationValid(bStart, bEnd)) return false
      return bStart <= start && bEnd >= end
    })
  )
  const reconciled = banks.filter((w) =>
    batches.some((b) => {
      if (String(b.wallet_id) !== String(w.id)) return false
      if (['cancelled', 'failed', 'review_required'].includes(b.status)) return false
      if (b.status !== 'imported' && b.status !== 'reconciled') return false

      // Statement dates must be valid and cover the selected month
      if (!isValidIsoDate(b.statement_start) || !isValidIsoDate(b.statement_end)) return false
      const bStart = toIsoDateStr(b.statement_start)
      const bEnd = toIsoDateStr(b.statement_end)
      if (bStart > bEnd) return false
      if (!isBatchDurationValid(bStart, bEnd)) return false
      if (bStart > start || bEnd < end) return false

      // Closing balance must be a finite number
      if (!isFiniteNumber(b.closing_balance)) return false

      // Reconciliation outcome must be valid and confirmed
      const recon = b.reconciliation || b.bank_reconciliations?.[0] || null
      const rawDiff = b.difference != null ? b.difference : recon?.difference
      if (!isFiniteNumber(rawDiff)) return false
      const diff = Number(rawDiff)

      const recStatus = b.reconciliation_status || recon?.status || null
      const confirmedStatus = ['balanced', 'reconciled', 'matched'].includes(recStatus)
      if (!confirmedStatus) return false

      // Explicit currency precision: IDR integer (tolerance 1), foreign currency (tolerance 0.01)
      const currency = (b.currency || w.currency || 'IDR').toUpperCase()
      const tol = currency === 'IDR' ? 1 : 0.01
      if (Math.abs(diff) >= tol) return false

      // Ledger completeness: if transactions are supplied and statement period covers the month,
      // all ledger transactions for this bank account in this month must be linked to statement rows.
      // An absent, null, or false statement link strictly means unreconciled.
      const isReconciledTx = (t) => {
        if (t?.source === 'wallet_opening_balance' || t?.type === 'opening' || OPENING_ANCHOR_SOURCES.includes(t?.source)) return true
        if (t?.linked_statement_row_id || t?.statement_row_id) return true
        if (t?.is_reconciled === true) return true
        return false
      }
      const walletMonthTx = tx.filter((t) => String(t.wallet_id) === String(w.id))
      const hasUnlinkedTx = walletMonthTx.some((t) => !isReconciledTx(t))
      if (hasUnlinkedTx) return false

      return true
    })
  )
  const isReconciledBankTx = (t) => {
    if (t?.source === 'wallet_opening_balance' || t?.type === 'opening' || OPENING_ANCHOR_SOURCES.includes(t?.source)) return true
    if (t?.linked_statement_row_id || t?.statement_row_id) return true
    if (t?.is_reconciled === true) return true
    return false
  }
  const unlinkedBankTx = tx.filter((t) => {
    const isBank = banks.some((w) => String(w.id) === String(t.wallet_id))
    if (!isBank) return false
    return !isReconciledBankTx(t)
  })
  const records = operationDocuments ? operationDocuments.summary.total : tx.length + bills.length
  const complete = operationDocuments ? operationDocuments.summary.complete : Math.max(0, records - noCat.length - noDoc.length)
  const classification_percent = tx.length ? Math.round((tx.length-noCat.length)/tx.length*100) : null
  const percent = operationDocuments ? (operationDocuments.summary.total ? Math.floor(operationDocuments.summary.complete/operationDocuments.summary.total*100) : null) : records ? Math.round((complete / records) * 100) : null
  const checks = [
    { key: 'statements', done: banks.length > 0 && withStatements.length === banks.length, total: banks.length, ok: withStatements.length, missing: banks.filter((w) => !withStatements.includes(w)).map((w) => w.name) },
    { key: 'reconciliation', done: banks.length > 0 && reconciled.length === banks.length, total: banks.length, ok: reconciled.length, missing: banks.filter((w) => !reconciled.includes(w)).map((w) => w.name) },
    { key: 'bills', done: noDoc.length === 0 && bills.length > 0, total: bills.length, ok: bills.length - noDoc.length, missing: noDoc.map((d) => d.counterparty).filter(Boolean) },
    { key: 'categories', done: noCat.length === 0, total: tx.length, ok: tx.length - noCat.length, missing: noCat.map((t) => t.description).filter(Boolean) },
  ]
  if(operationDocuments){const s=operationDocuments.summary;checks[2]={key:'bills',done:s.document_control_complete,total:s.total,ok:s.complete,missing:operationDocuments.operations.filter(o=>o.status!=='complete').map(o=>o.description)};}
  const automated_checks_passed = percent === 100 && checks.every((c) => c.done)
  // Hard rule: Without explicit accountant confirmation, is_closed remains false.
  // When all automated checks pass, status is 'prepared_for_review'.
  const is_closed = false

  return {
    month,
    records,
    complete,
    percent,
    classification_percent,
    is_closed,
    automated_checks_passed,
    status: is_closed ? 'closed' : automated_checks_passed ? 'prepared_for_review' : 'in_progress',
    banks: {
      total: banks.length,
      with_statement: withStatements.length,
      reconciled: reconciled.length,
    },
    unlinked_transactions: unlinkedBankTx.map((t) => ({
      id: t.id,
      date: txDate(t),
      amount: Number(t.amount_original || 0),
      currency: t.currency_original || 'IDR',
      type: t.type,
      description: t.description || '',
      category: t.category || null,
      counterparty: t.counterparty || null,
      source: t.source || null,
      wallet_id: t.wallet_id || null,
      document_id: t.document_id || null,
      linked_statement_row_id: t.linked_statement_row_id || null,
      statement_batch_id: t.statement_batch_id || null,
      raw: t,
    })),
    checks,
  }
}

/**
 * Diagnoses the exact factual reason why a bank transaction is unreconciled for a given month.
 * Returns: { code, key, walletName, walletId, month, batch, diff }
 * Codes:
 *   - 'no_statement': statement for account not uploaded covering the month
 *   - 'statement_unconfirmed': statement uploaded, but processing/reconciliation unconfirmed (unbalanced/review_required)
 *   - 'no_match': statement uploaded and confirmed/imported, but transaction not matched to statement rows
 *   - 'requires_clarification': insufficient data to determine
 */
// Every reason code determineUnreconciledReason can return, in the order the month-close
// screen counts them, with the i18n keys for its badge, its short counter label and its tone.
// Kept here (not in the page) so a test can assert every key exists in EN, RU and ID.
export const UNRECONCILED_REASONS = [
  { code: 'no_statement', badgeKey: 'acct.unlinked.badgeNoStatement', countKey: 'acct.unlinked.count.noStatement', tone: 'crit' },
  { code: 'statement_unconfirmed', badgeKey: 'acct.unlinked.badgeUnconfirmed', countKey: 'acct.unlinked.count.unconfirmed', tone: 'warn' },
  { code: 'no_match', badgeKey: 'acct.unlinked.badgeNoMatch', countKey: 'acct.unlinked.count.noMatch', tone: 'warn' },
  { code: 'requires_clarification', badgeKey: 'acct.unlinked.badgeClarification', countKey: 'acct.unlinked.count.clarification', tone: 'neutral' },
]
export const reasonMeta = (code) => UNRECONCILED_REASONS.find((r) => r.code === code) || UNRECONCILED_REASONS[3]

export function determineUnreconciledReason({ tx, month, wallet, batches = [] }) {
  if (!wallet || !tx) {
    return {
      code: 'requires_clarification',
      reason: 'requires_clarification',
      key: 'clarification',
      reasonKey: 'acct.reason.clarification',
      walletName: wallet?.name || null,
      walletId: wallet?.id || null,
      month,
      params: {
        wallet: wallet?.name || 'Bank',
        month: month || '',
      },
      actionRoute: null,
      actionLabelKey: null,
    }
  }

  const mOpt = monthOptions(24).find((m) => m.key === month)
  const start = mOpt?.start || `${month}-01`
  const end = mOpt?.end || `${month}-28`

  const isFiniteNumber = (val) => val != null && val !== '' && typeof val !== 'boolean' && Number.isFinite(Number(val)) && !Number.isNaN(Number(val))
  const toIsoDateStr = (val) => {
    if (!val) return null
    if (typeof val === 'string') return val.trim().slice(0, 10)
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      const y = val.getUTCFullYear()
      const m = String(val.getUTCMonth() + 1).padStart(2, '0')
      const d = String(val.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    return null
  }
  const isValidIsoDate = (val) => {
    const str = toIsoDateStr(val)
    if (!str) return false
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return false
    const [_, y, m, d] = match
    const dt = new Date(`${y}-${m}-${d}T00:00:00Z`)
    if (Number.isNaN(dt.getTime())) return false
    return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() + 1 === Number(m) && dt.getUTCDate() === Number(d)
  }

  const walletBatches = (batches || []).filter((b) =>
    String(b.wallet_id) === String(wallet.id) &&
    !['cancelled', 'failed'].includes(b.status)
  )

  const isBatchDurationValid = (bStart, bEnd) => {
    if (!bStart || !bEnd) return false
    const s = new Date(`${bStart}T00:00:00Z`).getTime()
    const e = new Date(`${bEnd}T00:00:00Z`).getTime()
    if (isNaN(s) || isNaN(e)) return false
    const diffDays = Math.round((e - s) / 86400000)
    return diffDays >= 0 && diffDays <= 365 * 5 // Reject corrupted multi-decade spans like 2000-2032
  }

  const coveringBatches = walletBatches.filter((b) => {
    if (!isValidIsoDate(b.statement_start) || !isValidIsoDate(b.statement_end)) return false
    const bStart = toIsoDateStr(b.statement_start)
    const bEnd = toIsoDateStr(b.statement_end)
    if (bStart > bEnd) return false
    if (!isBatchDurationValid(bStart, bEnd)) return false
    return bStart <= start && bEnd >= end
  })

  // 1. No statement uploaded for this account covering the period
  if (coveringBatches.length === 0) {
    const routeParams = new URLSearchParams()
    if (wallet?.id) routeParams.set('wallet_id', String(wallet.id))
    if (month) routeParams.set('month', String(month))
    const qStr = routeParams.toString()
    return {
      code: 'no_statement',
      reason: 'no_statement',
      key: 'noStatement',
      reasonKey: 'acct.reason.noStatement',
      walletName: wallet.name,
      walletId: wallet.id,
      month,
      params: {
        wallet: wallet.name || 'Bank',
        month: month || '',
      },
      actionRoute: `/business/bank-import${qStr ? `?${qStr}` : ''}`,
      actionLabelKey: 'acct.reason.actionUploadStatement',
    }
  }

  // 2. Statement exists, but processing or reconciliation confirmation is incomplete
  const unconfirmedBatch = coveringBatches.find((b) => {
    if (['review_required', 'unbalanced'].includes(b.status)) return true
    const recon = b.reconciliation || b.bank_reconciliations?.[0] || null
    const recStatus = b.reconciliation_status || recon?.status || null
    if (recStatus === 'unbalanced' || recStatus === 'review_required') return true

    const rawDiff = b.difference != null ? b.difference : recon?.difference
    if (rawDiff != null && isFiniteNumber(rawDiff)) {
      const currency = (b.currency || wallet.currency || 'IDR').toUpperCase()
      const tol = currency === 'IDR' ? 1 : 0.01
      if (Math.abs(Number(rawDiff)) >= tol) return true
    }
    if (b.status !== 'imported' && b.status !== 'reconciled' && b.status !== 'confirmed') return true
    return false
  })

  if (unconfirmedBatch) {
    const recon = unconfirmedBatch.reconciliation || unconfirmedBatch.bank_reconciliations?.[0]
    const diff = unconfirmedBatch.difference != null ? unconfirmedBatch.difference : recon?.difference
    const routeParams = new URLSearchParams()
    if (unconfirmedBatch.id) routeParams.set('batchId', String(unconfirmedBatch.id))
    if (wallet?.id) routeParams.set('wallet_id', String(wallet.id))
    if (month) routeParams.set('month', String(month))
    const qStr = routeParams.toString()
    return {
      code: 'statement_unconfirmed',
      reason: 'statement_unconfirmed',
      key: 'unconfirmed',
      reasonKey: 'acct.reason.unconfirmed',
      batch: unconfirmedBatch,
      diff: diff != null ? Number(diff) : null,
      walletName: wallet.name,
      walletId: wallet.id,
      month,
      params: {
        wallet: wallet.name || 'Bank',
        month: month || '',
      },
      actionRoute: `/business/bank-import${qStr ? `?${qStr}` : ''}`,
      actionLabelKey: 'acct.reason.actionReviewStatement',
    }
  }

  // 3. Statement is uploaded and processed/confirmed, but this transaction is unlinked
  const isLinked = !!(tx.linked_statement_row_id || tx.statement_row_id || tx.is_reconciled)
  if (!isLinked) {
    const latestBatch = coveringBatches[0]
    const routeParams = new URLSearchParams()
    if (latestBatch?.id) routeParams.set('batchId', String(latestBatch.id))
    if (wallet?.id) routeParams.set('wallet_id', String(wallet.id))
    if (month) routeParams.set('month', String(month))
    const qStr = routeParams.toString()
    return {
      code: 'no_match',
      reason: 'no_match',
      key: 'noMatch',
      reasonKey: 'acct.reason.noMatch',
      walletName: wallet.name,
      walletId: wallet.id,
      month,
      params: {
        wallet: wallet.name || 'Bank',
        month: month || '',
      },
      actionRoute: `/business/bank-import${qStr ? `?${qStr}` : ''}`,
      actionLabelKey: 'acct.reason.actionMatchTransactions',
    }
  }

  return {
    code: 'requires_clarification',
    reason: 'requires_clarification',
    key: 'clarification',
    reasonKey: 'acct.reason.clarification',
    walletName: wallet.name,
    walletId: wallet.id,
    month,
    params: {
      wallet: wallet.name || 'Bank',
      month: month || '',
    },
    actionRoute: null,
    actionLabelKey: null,
  }
}

/**
 * Documents by transaction: one row per bill/invoice and per uncategorised transaction of
 * the month, with the package it needs. Only what the records carry is marked done.
 *
 * P-05:
 *   slip   the withholding slip — only for IDR supplier bills when the verified engine has a
 *          withholding rate (`slipNeeded`, the same test Bill detail uses). Read from
 *          withholding_records (migration 031) via `slips` = { available, by_debt }; while
 *          that read is unavailable the slip is "not tracked here yet".
 *   check  "checked by an accountant" (migration 061) — a review mark, not a document: an
 *          unchecked bill is 'open', never 'missing'. Before 061 there is no check item.
 */
export const checklistTracked = (d) => !!d && Object.prototype.hasOwnProperty.call(d, 'accountant_checked_at')

export function packages({ month, transactions = [], debts = [], slipNeeded = false, slips = null }) {
  const rows = []
  for (const d of debts) {
    if (d.is_training === true || d.status === 'cancelled' || !inMonth(d.due_date || d.created_at, month)) continue
    const pay = d.type !== 'receivable'
    const paid = d.status === 'paid'
    const items = [
      { key: pay ? 'invoice' : 'ourInvoice', done: hasDocs(d) },
      { key: pay ? 'proof' : 'received', done: paid && !!(d.linked_transaction_id || d.last_payment_at), pending: !paid },
    ]
    const tracked = checklistTracked(d)
    if (pay && slipNeeded && (d.currency || 'IDR') === 'IDR')
      items.push(slips?.available === true ? { key: 'slip', done: !!slips.by_debt?.[String(d.id)]?.slip_document_id } : { key: 'slip', unknown: true })
    if (tracked) items.push({ key: 'check', done: !!d.accountant_checked_at, review: true })
    const missing = items.filter((i) => !i.done && !i.pending && !i.unknown && !i.review).length
    rows.push({ key: `debt:${d.id}`, id: d.id, kind: pay ? 'out' : 'in', date: d.due_date || String(d.created_at || '').slice(0, 10),
      label: d.counterparty || '', note: d.description || '', amount: Number(d.original_amount ?? d.amount ?? 0), items,
      status: missing ? 'missing' : items.every((i) => i.done) ? 'complete' : 'open', missing })
  }
  for (const t of transactions) {
    if (!inMonth(txDate(t), month)) continue
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
    // Withholding slips still to make: null while P-05 is not tracked (no row has the column).
    slipsToMake: rows.some((r) => r.items.some((i) => i.key === 'slip' && !i.unknown))
      ? rows.filter((r) => r.items.some((i) => i.key === 'slip' && !i.unknown && !i.done)).length : null,
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
// D4-A: opening-anchor bookkeeping rows (re-anchor pair, bank opening alignment) are not bank
// movements; they never have a statement line and must not make a month unreconciled.
export const OPENING_ANCHOR_SOURCES = Object.freeze(['opening_reanchor','opening_reanchor_reversal','bank_import_opening'])

/**
 * Payment and filing of a tax obligation, kept apart (financial integrity audit 2026-10-24): money
 * paid is not a filed return, and a filed return is never assumed from a payment.
 *   payment  'recorded' (payment_status / status 'paid') | 'overdue' (pay-by date passed) | 'due'
 *   filing   'filed' (filing_status / status 'filed', or the legacy payment_status 'filed') | 'overdue' | 'due'
 * Same rule as the server (GET /api/accountant/tax-calendar, taxStages in server/lib/taxDeadlines.js).
 */
export function taxProgress(e, today = new Date().toISOString().slice(0, 10)) {
  const paid = e?.payment_status === 'paid' || e?.status === 'paid'
  const filed = e?.filing_status === 'filed' || e?.status === 'filed' || e?.payment_status === 'filed'
  const payBy = String(e?.pay_by || e?.due_date || '').slice(0, 10)
  const fileBy = String(e?.due_date || '').slice(0, 10)
  return {
    payment: paid ? 'recorded' : payBy && payBy < today ? 'overdue' : 'due',
    filing: filed ? 'filed' : fileBy && fileBy < today ? 'overdue' : 'due',
  }
}

export function eventStage(e, today) {
  const p = taxProgress(e, today)
  if (p.filing === 'filed') return 'done'
  if (p.payment === 'recorded' && p.filing !== 'overdue') return 'paid'
  if (p.filing === 'overdue' || (p.payment === 'overdue' && !e?.nil_return) || (e?.days != null && e.days < 0)) return 'overdue'
  if (e?.amount_status === 'calculated' || e?.estimated_amount != null) return 'calculated'
  return 'todo'
}

/** Zero-dependency ZIP generator creating valid STORE archives (CRC-32 + local headers + central directory + EOCD) */
export function createZip(files, { date = new Date() } = {}) {
  // DOS date/time of the archive entries (local time, 2-second resolution); a zero date is invalid (month 0).
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  // Entry names must stay inside the archive: no absolute paths, drive letters, backslashes or "..".
  const seenNames = new Set()
  for (const f of files) {
    const n = String(f.name || '')
    if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\\') || n.split('/').some((part) => part === '..' || part === '.') || /[\u0000-\u001f]/.test(n))
      throw new Error('unsafe_zip_entry_name')
    if (seenNames.has(n)) throw new Error('duplicate_zip_entry_name')
    seenNames.add(n)
  }
  const CRC_TABLE = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1)
    CRC_TABLE[i] = c >>> 0
  }
  function crc32(buf) {
    let crc = 0xffffffff
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }
  const encoder = new TextEncoder()
  const fileEntries = files.map((f) => {
    const dataBuf = typeof f.data === 'string' ? encoder.encode(f.data) : f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data)
    const nameBuf = encoder.encode(f.name)
    return { name: f.name, nameBuf, dataBuf, crc: crc32(dataBuf), size: dataBuf.length }
  })

  const parts = []
  let offset = 0
  const centralDirHeaders = []

  for (const f of fileEntries) {
    const local = new Uint8Array(30 + f.nameBuf.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 0x0800, true)
    dv.setUint16(8, 0, true)
    dv.setUint16(10, dosTime, true)
    dv.setUint16(12, dosDate, true)
    dv.setUint32(14, f.crc, true)
    dv.setUint32(18, f.size, true)
    dv.setUint32(22, f.size, true)
    dv.setUint16(26, f.nameBuf.length, true)
    dv.setUint16(28, 0, true)
    local.set(f.nameBuf, 30)
    parts.push(local, f.dataBuf)

    const cd = new Uint8Array(46 + f.nameBuf.length)
    const cdv = new DataView(cd.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0x0800, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, dosTime, true)
    cdv.setUint16(14, dosDate, true)
    cdv.setUint32(16, f.crc, true)
    cdv.setUint32(20, f.size, true)
    cdv.setUint32(24, f.size, true)
    cdv.setUint16(28, f.nameBuf.length, true)
    cdv.setUint16(30, 0, true)
    cdv.setUint16(32, 0, true)
    cdv.setUint16(34, 0, true)
    cdv.setUint16(36, 0, true)
    cdv.setUint32(38, 0, true)
    cdv.setUint32(42, offset, true)
    cd.set(f.nameBuf, 46)
    centralDirHeaders.push(cd)

    offset += local.length + f.dataBuf.length
  }

  const cdOffset = offset
  let cdSize = 0
  for (const cd of centralDirHeaders) {
    parts.push(cd)
    cdSize += cd.length
  }

  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(4, 0, true)
  edv.setUint16(6, 0, true)
  edv.setUint16(8, fileEntries.length, true)
  edv.setUint16(10, fileEntries.length, true)
  edv.setUint32(12, cdSize, true)
  edv.setUint32(16, cdOffset, true)
  edv.setUint16(20, 0, true)
  parts.push(eocd)

  const totalLen = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(totalLen)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/**
 * Deduplicates an array of document link references by document_id or unique link identifier.
 */
export function dedupeDocumentLinks(links) {
  if (!Array.isArray(links)) return []
  const seen = new Set()
  const result = []
  for (const l of links) {
    if (!l) continue
    const docId = String(l.document_id || l.id || l.file_id || '')
    const linkId = String(l.link_id || l._link_id || '')
    const key = docId ? `doc:${docId}` : (linkId ? `link:${linkId}` : JSON.stringify(l))
    if (!seen.has(key)) {
      seen.add(key)
      result.push(l)
    }
  }
  return result
}

/**
 * Builds structured accountant export data:
 * - summary: readiness %, complete/total records, reconciliation status, bank breakdown
 * - discrepancies: missing bank statements, unreconciled accounts, bills without docs, uncategorised transactions, unavailable files
 * - registry: list of transactions, debts, and their linked document status
 */
export function packageExportData({ month, companyName = '', businessId = '', transactions = [], debts = [], batches = [], wallets = [], operationDocuments = null }) {
  const matchBiz = (item) => !businessId || !item.business_id || String(item.business_id) === String(businessId)
  const scopedTx = transactions.filter(matchBiz)
  const scopedDebts = debts.filter(matchBiz)
  const scopedBatches = batches.filter(matchBiz)
  const scopedWallets = wallets.filter(matchBiz)

  const readiness = closeReadiness({
    month,
    transactions: scopedTx,
    debts: scopedDebts,
    batches: scopedBatches,
    wallets: scopedWallets,
    operationDocuments,
  })
  const inM = (iso) => inMonth(iso, month)
  const monthTx = scopedTx.filter((t) => inM(txDate(t)))
  const monthDebts = scopedDebts.filter((d) => d.is_training !== true && d.status !== 'cancelled' && inM(d.due_date || d.created_at))

  const missingStatements = readiness.checks.find((c) => c.key === 'statements')?.missing || []
  const unreconciledStatements = readiness.checks.find((c) => c.key === 'reconciliation')?.missing || []
  const missingBills = readiness.checks.find((c) => c.key === 'bills')?.missing || []
  const missingCategories = readiness.checks.find((c) => c.key === 'categories')?.missing || []

  const registry = [
    ...monthDebts.map((d) => ({
      type: 'bill_or_invoice',
      id: d.id,
      counterparty: d.counterparty || '',
      date: d.due_date || String(d.created_at || '').slice(0, 10),
      amount: Number(d.original_amount ?? d.amount ?? 0),
      currency: d.currency || 'IDR',
      status: d.status,
      has_documents: hasDocs(d),
      document_links: dedupeDocumentLinks(d.document_links || []),
      accountant_checked: !!d.accountant_checked_at,
    })),
    ...monthTx.map((t) => ({
      type: 'transaction',
      id: t.id,
      description: t.description || '',
      date: txDate(t),
      amount: Number(t.amount_original || 0),
      currency: t.currency_original || 'IDR',
      category: t.category || null,
      has_category: !needsCategory(t),
    })),
  ]

  return {
    package_version: '1.1',
    package_kind: 'preliminary',
    operation_documents: operationDocuments,
    document_control: operationDocuments?.summary || null,
    generated_at: new Date().toISOString(),
    month,
    company: {
      name: companyName,
      business_id: businessId,
    },
    readiness: {
      percent: readiness.percent,
      complete_records: readiness.complete,
      total_records: readiness.records,
      is_closed: readiness.is_closed,
      automated_checks_passed: readiness.automated_checks_passed,
      status: readiness.status,
      bank_reconciliation_status: readiness.banks.reconciled === readiness.banks.total && readiness.banks.total > 0 ? 'reconciled' : 'unreconciled',
      checks: readiness.checks,
    },
    bank_accounts: {
      total_banks: readiness.banks.total,
      statements_uploaded: readiness.banks.with_statement,
      balances_reconciled: readiness.banks.reconciled,
      cash_accounts_excluded: scopedWallets.filter((w) => !isBankWallet(w)).map((w) => ({ id: w.id, name: w.name, type: w.type })),
    },
    discrepancies: {
      missing_bank_statements: missingStatements,
      unreconciled_bank_statements: unreconciledStatements,
      unlinked_transactions: readiness.unlinked_transactions || [],
      bills_without_documents: operationDocuments ? [] : missingBills,
      operations_with_document_gaps: operationDocuments?.operations.filter(o=>o.status!=='complete') || [],
      uncategorised_transactions: missingCategories,
    },
    limitations: [
      ...(operationDocuments?.limitations || []),
      ...(!readiness.is_closed ? ['Month is not closed: awaiting accountant sign-off and verification.'] : []),
      ...(missingStatements.length ? [`Missing bank statements for: ${missingStatements.join(', ')}`] : []),
      ...(unreconciledStatements.length ? [`Unreconciled bank statements for: ${unreconciledStatements.join(', ')}`] : []),
      ...(readiness.unlinked_transactions?.length ? [`Unreconciled ledger transactions not present in bank statement: ${readiness.unlinked_transactions.length}`] : []),
      ...(missingBills.length ? [`Bills without original documents: ${missingBills.length}`] : []),
      ...(missingCategories.length ? [`Transactions without category: ${missingCategories.length}`] : []),
    ],
    records_registry: operationDocuments ? operationDocuments.operations.map(o=>({type:'operation',...o})) : registry,
  }
}

/**
 * Creates the downloadable accountant handoff ZIP for a month ('2026-09') or a quarter ('2026-Q3'):
 * - accountant-summary.pdf (readiness, checks, exceptions, period totals, tax preparation)
 * - registers/*.csv and <name>_Registers.xlsx (transactions, accounts, cash-basis P&L, financing,
 *   receivables/payables, payroll with BPJS split, missing documents, review items, document map, tax preparation)
 * - documents/ originals as uploaded, under safe unique names
 * - summary.json, discrepancies.json (incl. unavailable_files), records_registry.json, operation-documents.json
 * - README.txt (scope, limitations, where filings happen) and manifest.json / manifest.csv (SHA-256, counts, totals)
 * Nothing here files, calculates or certifies a tax; an incomplete period is never labelled complete.
 */
export async function createAccountantZipPackage({
  month,
  period = null,
  companyName = '',
  businessId = '',
  transactions = [],
  debts = [],
  batches = [],
  wallets = [],
  documents = [],
  operationDocuments = null,
  operationDocumentsByMonth = null,
  payrollRuns = [],
  funding = null,
  pnl = null,
  profile = null,
  sourceErrors = [],
  token = null,
  fetchSignedUrl = null,
  fetchDocumentBytes = null,
  signal = null,
  lang = 'ru',
  now = new Date(),
}) {
  const abortIfNeeded = () => {
    if (signal?.aborted) {
      const err = new Error('Export aborted')
      err.name = 'AbortError'
      throw err
    }
  }
  abortIfNeeded()
  const R = await import('./accountantRegisters.js')
  const p = R.reportingPeriod(period || month)
  const months = p.months
  const opDocsList = Array.isArray(operationDocumentsByMonth) && operationDocumentsByMonth.length
    ? operationDocumentsByMonth
    : operationDocuments ? [operationDocuments] : []
  const opDocsFor = (m) => opDocsList.find((o) => o?.month === m) || (months.length === 1 ? opDocsList[0] || null : null)

  const perMonth = months.map((m) => packageExportData({ month: m, companyName, businessId, transactions, debts, batches, wallets, operationDocuments: opDocsFor(m) }))
  const exportData = perMonth.length === 1 ? perMonth[0] : mergePeriodExport(perMonth, p)
  const unavailableFiles = []
  const filesToZip = [
    ...opDocsList.filter(Boolean).map((od, i) => ({ name: opDocsList.length > 1 ? `operation-documents-${od.month || i + 1}.json` : 'operation-documents.json', data: JSON.stringify(od, null, 2) })),
    { name: 'documents/README.txt', data: `Financial documents for ${p.key} (${p.start} to ${p.end}).\nUnavailable files are listed in discrepancies.json.\n` },
  ]
  const addedZipPaths = new Set(['documents/README.txt'])
  const docPaths = {}
  const zipPathFor = (rawName, id) => 'documents/' + R.uniqueName(R.safeFileName(rawName, `${id}.bin`), addedZipPaths, String(id).slice(0, 8))

  const monthSet = new Set(months)
  const inM = (iso) => monthSet.has(String(iso || '').slice(0, 7))
  const monthDebtIds = new Set(opDocsList.length ? opDocsList.flatMap((od) => (od?.operations || []).flatMap((o) => (o.invoice ? [String(o.invoice.id)] : []))) : exportData.records_registry.filter((r) => r.type === 'bill_or_invoice').map((r) => String(r.id)))
  const monthTxIds = new Set(opDocsList.length ? opDocsList.flatMap((od) => (od?.operations || []).flatMap((o) => o.payments.map((pay) => String(pay.id)))) : exportData.records_registry.filter((r) => r.type === 'transaction').map((r) => String(r.id)))

  // Scope documents to selected company and period
  const matchBiz = (item) => !businessId || !item.business_id || String(item.business_id) === String(businessId)
  const isDocInPeriod = (doc) => {
    if (!matchBiz(doc)) return false
    if (inM(doc.document_date || doc.created_at)) return true
    if (doc.debt_id && monthDebtIds.has(String(doc.debt_id))) return true
    if (doc.transaction_id && monthTxIds.has(String(doc.transaction_id))) return true
    if (Array.isArray(doc.links) && doc.links.some((l) =>
      (l.target_type === 'debt' && monthDebtIds.has(String(l.target_id))) ||
      (l.target_type === 'transaction' && monthTxIds.has(String(l.target_id)))
    )) return true
    if (Array.isArray(doc.debt_links) && doc.debt_links.some((l) => monthDebtIds.has(String(l.debt_id || l)))) return true
    return exportData.records_registry.some((r) =>
      Array.isArray(r.document_links) && r.document_links.some((dl) => String(dl.document_id || dl.id) === String(doc.id)))
  }

  const targetDocs = opDocsList.length
    ? [...new Map(opDocsList.filter(Boolean).flatMap((od) => (od.operations || []).flatMap((o) => [...o.documents, ...o.bank_rows.map((r) => (od.available_documents || []).find((d) => d.id === r.document_id)).filter(Boolean)])).map((d) => [d.id, d])).values()]
    : documents.filter(isDocInPeriod)

  // Bytes of one stored original: inline content, the same-origin content route, or a signed URL.
  const inlineBytes = (holder) => {
    const raw = holder.file_content || holder.content || holder.raw_csv
    const b64 = holder.content_base64 || (typeof raw === 'string' && raw.startsWith('data:') ? raw.split(',')[1] : null)
    if (b64) { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out }
    if (raw?.data && Array.isArray(raw.data)) return new Uint8Array(raw.data)
    if (typeof raw === 'string' || raw instanceof Uint8Array) return raw
    return null
  }
  const remoteBytes = async (docId) => {
    if (typeof fetchDocumentBytes === 'function') {
      try { const b = await fetchDocumentBytes(docId, businessId, signal); if (b) return b instanceof Uint8Array ? b : new Uint8Array(b) }
      catch (e) { if (signal?.aborted || e?.name === 'AbortError') throw e }
    }
    if (typeof fetchSignedUrl === 'function') {
      try {
        const url = await fetchSignedUrl(docId, 'download', businessId, signal)
        if (url && typeof fetch === 'function') { const resp = await fetch(url, { signal }); if (resp.ok) return new Uint8Array(await resp.arrayBuffer()) }
      } catch (e) { if (signal?.aborted || e?.name === 'AbortError') throw e }
    }
    return null
  }

  // 1. Financial documents (invoices, receipts, etc.)
  for (const doc of targetDocs) {
    abortIfNeeded()
    const fileName = doc.file?.file_name || doc.file_name || `${doc.id}.bin`
    let bytes = null
    try { bytes = inlineBytes(doc) } catch { unavailableFiles.push({ document_id: doc.id, file_name: fileName, reason: 'Failed to decode base64 file content' }); continue }
    if (bytes == null) bytes = await remoteBytes(doc.id)
    if (bytes == null) {
      unavailableFiles.push({ document_id: doc.id, file_name: fileName, reason: 'Original file could not be retrieved from authorized storage or signed URL was unavailable' })
      continue
    }
    const zipPath = zipPathFor(fileName, doc.id)
    filesToZip.push({ name: zipPath, data: bytes })
    docPaths[String(doc.id)] = zipPath
  }

  // 2. Bank statements (originals of the selected company and period)
  const isBatchInPeriod = (b) => {
    if (!b || !matchBiz(b) || ['cancelled', 'failed'].includes(b.status)) return false
    if (b.month && monthSet.has(b.month)) return true
    const bStart = b.statement_start ? String(b.statement_start).slice(0, 7) : null
    const bEnd = b.statement_end ? String(b.statement_end).slice(0, 7) : null
    if (bStart && bEnd) { if (months.some((m) => bStart <= m && bEnd >= m)) return true }
    else if (bStart && monthSet.has(bStart)) return true
    else if (bEnd && monthSet.has(bEnd)) return true
    return !!(b.created_at && inM(b.created_at))
  }
  for (const b of batches.filter(isBatchInPeriod)) {
    abortIfNeeded()
    const batchFileName = b.file?.file_name || b.file_name || `bank_statement_${b.id}.${b.file_type || 'csv'}`
    const docMatch = documents.find((d) => b.document_id && String(d.id) === String(b.document_id))
    if (docMatch && docPaths[String(docMatch.id)]) continue // already packed as a document
    let bytes = null
    if (docMatch) { try { bytes = inlineBytes(docMatch) } catch { bytes = null } if (bytes == null) bytes = await remoteBytes(docMatch.id) }
    if (bytes == null) {
      try { bytes = inlineBytes(b) } catch { unavailableFiles.push({ batch_id: b.id, file_name: batchFileName, reason: 'Failed to decode base64 statement file content' }); continue }
    }
    if (bytes == null) {
      unavailableFiles.push({ batch_id: b.id, file_name: batchFileName, wallet_id: b.wallet_id || null, statement_period: `${b.statement_start || ''}..${b.statement_end || ''}`, reason: 'Original bank statement file is unavailable or could not be retrieved from storage' })
      continue
    }
    const zipPath = zipPathFor(batchFileName, docMatch?.id || b.id)
    filesToZip.push({ name: zipPath, data: bytes })
    if (docMatch) docPaths[String(docMatch.id)] = zipPath
  }

  const filesAvailable = unavailableFiles.length === 0
  // A source that could not be read makes its register incomplete: say so, never present it as empty.
  const sourcesComplete = sourceErrors.length === 0
  const isComplete = filesAvailable && sourcesComplete && exportData.readiness.is_closed === true

  const summary = {
    package_version: '2.0',
    generated_at: now.toISOString(),
    month: p.kind === 'month' ? p.key : null,
    period: { kind: p.kind, key: p.key, start: p.start, end: p.end, months },
    label: R.PACKAGE_LABEL,
    company: exportData.company,
    is_complete: isComplete,
    files_available: filesAvailable,
    filed: false,
    readiness: { ...exportData.readiness, is_complete: isComplete, files_available: filesAvailable },
    readiness_by_month: perMonth.length > 1 ? perMonth.map((x) => ({ month: x.month, ...x.readiness, checks: undefined })) : undefined,
    bank_accounts: exportData.bank_accounts,
    limitations: [...(exportData.limitations || []), ...sourceErrors.map((n) => `Source not available when the package was built: ${n}. Its register is incomplete.`)],
    sources_complete: sourcesComplete,
  }
  const discrepancies = {
    company_name: exportData.company.name,
    month: summary.month,
    period: summary.period,
    is_complete: isComplete,
    files_available: filesAvailable,
    limitations: summary.limitations,
    unavailable_sources: sourceErrors,
    ...exportData.discrepancies,
    unavailable_files: unavailableFiles,
  }

  // 3. Registers for the accountant, from the same snapshot.
  const reg = R.buildRegisters({ period: p, company: { name: companyName, business_id: businessId }, profile, transactions, wallets, debts, payrollRuns, funding, pnl, operationDocuments: opDocsList, docPaths })
  summary.totals = reg.totals
  summary.tax_profile_missing = reg.tax.missing_profile
  reg.tables.forEach((tbl, i) => filesToZip.push({ name: `registers/${String(i + 1).padStart(2, '0')}_${tbl.name}.csv`, data: R.toCsv(tbl) }))
  const safeComp = (companyName || 'company').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'company'
  const base = `CFO_AI_${safeComp}_${p.key}`
  try {
    const XLSX = await import('xlsx')
    const lib = XLSX.utils ? XLSX : XLSX.default
    const wb = lib.utils.book_new()
    for (const tbl of reg.tables) lib.utils.book_append_sheet(wb, lib.utils.aoa_to_sheet([tbl.columns, ...tbl.rows]), tbl.name.slice(0, 31))
    filesToZip.push({ name: `${base}_Registers.xlsx`, data: new Uint8Array(lib.write(wb, { type: 'array', bookType: 'xlsx', compression: true })) })
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') throw e
    summary.limitations.push('XLSX workbook could not be generated; the CSV registers carry the same data.')
  }

  filesToZip.push({ name: 'summary.json', data: JSON.stringify(summary, null, 2) })
  filesToZip.push({ name: 'discrepancies.json', data: JSON.stringify(discrepancies, null, 2) })
  filesToZip.push({ name: 'records_registry.json', data: JSON.stringify(exportData.records_registry, null, 2) })
  filesToZip.push({ name: 'README.txt', data: R.readmeText({ period: p, company: { name: companyName }, totals: reg.totals, missingProfile: reg.tax.missing_profile, unavailable: unavailableFiles.length, unavailableSources: sourceErrors, isComplete, generatedAt: summary.generated_at }) })

  // Dynamically import PDF generator on demand (code-splitting)
  const { generateAccountantSummaryPdf } = await import('./accountantSummaryPdf.js')
  const summaryPdfBytes = await generateAccountantSummaryPdf({
    summary,
    discrepancies,
    recordsRegistry: exportData.records_registry,
    attachedFiles: filesToZip,
    wallets,
    lang,
    handoff: { period: p, totals: reg.totals, taxRows: reg.tax.table.rows, missingProfile: reg.tax.missing_profile },
  })
  filesToZip.push({ name: 'accountant-summary.pdf', data: summaryPdfBytes })

  // 4. Manifest: every file with its SHA-256, plus the record counts and totals it was built from.
  const enc = new TextEncoder()
  const manifestFiles = []
  for (const f of filesToZip) {
    const bytes = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    manifestFiles.push({ path: f.name, bytes: bytes.length, sha256: await R.sha256Hex(bytes) })
  }
  const manifest = {
    package: R.PACKAGE_LABEL, package_version: summary.package_version, generated_at: summary.generated_at,
    company: summary.company, period: summary.period, is_complete: isComplete, filed: false,
    record_counts: Object.fromEntries(reg.tables.map((tbl) => [tbl.name, tbl.rows.length])),
    totals: reg.totals, source_ids: { documents: Object.keys(docPaths) }, files: manifestFiles,
  }
  filesToZip.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) })
  filesToZip.push({ name: 'manifest.csv', data: R.toCsv({ columns: ['path', 'bytes', 'sha256'], rows: manifestFiles.map((f) => [f.path, f.bytes, f.sha256]) }) })

  const zipBytes = createZip(filesToZip, { date: now })
  const filename = `${base}_Accountant_Package.zip`

  return {
    zipBytes,
    filename,
    summary,
    discrepancies,
    recordsRegistry: exportData.records_registry,
    registers: reg,
    manifest,
    unavailableFiles,
    filesAvailable,
    isComplete,
    summaryPdfBytes,
  }
}

// A quarter's export from its three months: records and gaps concatenated, readiness checks summed; the period
// is complete only when every month is.
function mergePeriodExport(perMonth, p) {
  const checks = new Map()
  for (const x of perMonth) for (const c of x.readiness.checks || []) {
    const prev = checks.get(c.key) || { ...c, ok: 0, total: 0, done: true, missing: [] }
    checks.set(c.key, { ...prev, ok: (prev.ok || 0) + (c.ok || 0), total: (prev.total || 0) + (c.total || 0), done: prev.done && !!c.done, missing: [...(prev.missing || []), ...(c.missing || [])] })
  }
  const sum = (k) => perMonth.reduce((s, x) => s + (Number(x.readiness[k]) || 0), 0)
  const records = sum('total_records'), complete = sum('complete_records')
  const all = (k) => perMonth.every((x) => x.readiness[k] === true)
  const status = perMonth.every((x) => x.readiness.status === 'prepared_for_review') ? 'prepared_for_review' : perMonth.some((x) => x.readiness.status === 'in_progress') ? 'in_progress' : perMonth[0].readiness.status
  const cat = (k) => perMonth.flatMap((x) => (x.discrepancies[k] || []).map((v) => (v && typeof v === 'object' ? { month: x.month, ...v } : { month: x.month, value: v })))
  return {
    package_version: perMonth[0].package_version, package_kind: 'preliminary', month: null, period: p.key,
    generated_at: perMonth[0].generated_at, company: perMonth[0].company,
    readiness: {
      percent: records ? Math.round((complete / records) * 100) : null, complete_records: complete, total_records: records,
      is_closed: all('is_closed'), automated_checks_passed: all('automated_checks_passed'), status,
      bank_reconciliation_status: perMonth.every((x) => x.readiness.bank_reconciliation_status === 'reconciled') ? 'reconciled' : 'unreconciled',
      checks: [...checks.values()],
    },
    bank_accounts: perMonth[perMonth.length - 1].bank_accounts,
    discrepancies: {
      missing_bank_statements: cat('missing_bank_statements'), unreconciled_bank_statements: cat('unreconciled_bank_statements'),
      unlinked_transactions: cat('unlinked_transactions'), bills_without_documents: cat('bills_without_documents'),
      operations_with_document_gaps: cat('operations_with_document_gaps'), uncategorised_transactions: cat('uncategorised_transactions'),
    },
    limitations: [...new Set(perMonth.flatMap((x) => (x.limitations || []).map((l) => `${x.month}: ${l}`)))],
    records_registry: perMonth.flatMap((x) => x.records_registry.map((r) => ({ month: x.month, ...r }))),
  }
}


