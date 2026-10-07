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
 * Month-close readiness from what the system can actually check:
 *   categories   every money-in/out transaction of the month has a category
 *   bills        every bill/invoice dated in the month has a document attached
 *   statements   every bank account has a statement reaching the month end
 * Returns the checks and an overall percentage of complete records.
 */
export function closeReadiness({ month, transactions = [], debts = [], batches = [], wallets = [] }) {
  // Every company row counts, whatever its scope label (see lib/performance.js, isBizIdr).
  const tx = transactions.filter((t) => inMonth(txDate(t), month))
  const noCat = tx.filter(needsCategory)
  const bills = debts.filter((d) => d.is_training !== true && d.status !== 'cancelled' && inMonth(d.due_date || d.created_at, month))
  const noDoc = bills.filter((d) => !hasDocs(d))
  const end = monthOptions(24).find((m) => m.key === month)?.end || `${month}-28`
  const banks = wallets.filter(isBankWallet)
  const withStatements = banks.filter((w) =>
    batches.some((b) =>
      String(b.wallet_id) === String(w.id) &&
      !['cancelled', 'failed'].includes(b.status) &&
      String(b.statement_end || '') >= end
    )
  )
  const reconciled = banks.filter((w) =>
    batches.some((b) => {
      if (String(b.wallet_id) !== String(w.id)) return false
      if (['cancelled', 'failed', 'review_required'].includes(b.status)) return false
      if (b.closing_balance == null) return false
      if (b.status !== 'imported' && b.status !== 'reconciled') return false
      if (String(b.statement_end || '') < end) return false

      // Check difference / reconciliation status if present on batch or nested recon
      const recon = b.reconciliation || b.bank_reconciliations?.[0] || null
      const diff = b.difference != null ? Number(b.difference) : recon?.difference != null ? Number(recon.difference) : null
      const recStatus = b.reconciliation_status || recon?.status || null
      if (recStatus === 'unbalanced') return false
      if (diff != null && Math.abs(diff) >= 1) return false

      return true
    })
  )
  const records = tx.length + bills.length
  const complete = records - noCat.length - noDoc.length
  return {
    month, records, complete: Math.max(0, complete),
    percent: records ? Math.round((Math.max(0, complete) / records) * 100) : null,
    banks: {
      total: banks.length,
      with_statement: withStatements.length,
      reconciled: reconciled.length,
    },
    checks: [
      { key: 'statements', done: banks.length > 0 && withStatements.length === banks.length, total: banks.length, ok: withStatements.length, missing: banks.filter((w) => !withStatements.includes(w)).map((w) => w.name) },
      { key: 'reconciliation', done: banks.length > 0 && reconciled.length === banks.length, total: banks.length, ok: reconciled.length, missing: banks.filter((w) => !reconciled.includes(w)).map((w) => w.name) },
      { key: 'bills', done: noDoc.length === 0 && bills.length > 0, total: bills.length, ok: bills.length - noDoc.length, missing: noDoc.map((d) => d.counterparty).filter(Boolean) },
      { key: 'categories', done: noCat.length === 0, total: tx.length, ok: tx.length - noCat.length, missing: noCat.map((t) => t.description).filter(Boolean) },
    ],
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
export function eventStage(e) {
  if (['paid', 'filed'].includes(e?.payment_status) || ['paid', 'filed'].includes(e?.status)) return 'done'
  if (e?.days != null && e.days < 0) return 'overdue'
  if (e?.amount_status === 'calculated' || e?.estimated_amount != null) return 'calculated'
  return 'todo'
}

/** Zero-dependency ZIP generator creating valid STORE archives (CRC-32 + local headers + central directory + EOCD) */
export function createZip(files) {
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
    dv.setUint16(6, 0, true)
    dv.setUint16(8, 0, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, 0, true)
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
    cdv.setUint16(8, 0, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, 0, true)
    cdv.setUint16(14, 0, true)
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
 * Builds structured accountant export data:
 * - summary: readiness %, complete/total records, reconciliation status, bank breakdown
 * - discrepancies: missing bank statements, unreconciled accounts, bills without docs, uncategorised transactions, unavailable files
 * - registry: list of transactions, debts, and their linked document status
 */
export function packageExportData({ month, companyName = '', businessId = '', transactions = [], debts = [], batches = [], wallets = [] }) {
  const readiness = closeReadiness({ month, transactions, debts, batches, wallets })
  const inM = (iso) => inMonth(iso, month)
  const monthTx = transactions.filter((t) => inM(txDate(t)))
  const monthDebts = debts.filter((d) => d.is_training !== true && d.status !== 'cancelled' && inM(d.due_date || d.created_at))

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
      document_links: d.document_links || [],
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
    package_version: '1.0',
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
      is_closed: readiness.percent === 100,
    },
    bank_accounts: {
      total_banks: readiness.banks.total,
      statements_uploaded: readiness.banks.with_statement,
      balances_reconciled: readiness.banks.reconciled,
      cash_accounts_excluded: wallets.filter((w) => !isBankWallet(w)).map((w) => ({ id: w.id, name: w.name, type: w.type })),
    },
    discrepancies: {
      missing_bank_statements: missingStatements,
      unreconciled_bank_statements: unreconciledStatements,
      bills_without_documents: missingBills,
      uncategorised_transactions: missingCategories,
    },
    records_registry: registry,
  }
}

/**
 * Creates downloadable ZIP accountant package with:
 * - summary.json
 * - discrepancies.json (including unavailable_files)
 * - records_registry.json
 * - documents/ folder with available original files
 */
export async function createAccountantZipPackage({
  month,
  companyName = '',
  businessId = '',
  transactions = [],
  debts = [],
  batches = [],
  wallets = [],
  documents = [],
}) {
  const exportData = packageExportData({ month, companyName, businessId, transactions, debts, batches, wallets })
  const unavailableFiles = []
  const filesToZip = [
    { name: 'documents/README.txt', data: `Financial documents for ${month} month close.\nUnavailable files are listed in discrepancies.json.\n` },
  ]

  for (const doc of documents) {
    const fileName = doc.file?.file_name || doc.file_name || `${doc.id}.bin`
    const rawContent = doc.file_content || doc.content
    const base64Content = doc.content_base64 || (typeof rawContent === 'string' && rawContent.startsWith('data:') ? rawContent.split(',')[1] : null)

    if (base64Content) {
      try {
        const binStr = atob(base64Content)
        const bytes = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
        filesToZip.push({ name: `documents/${fileName}`, data: bytes })
      } catch {
        unavailableFiles.push({ document_id: doc.id, file_name: fileName, reason: 'Failed to decode base64 file content' })
      }
    } else if (rawContent?.data && Array.isArray(rawContent.data)) {
      filesToZip.push({ name: `documents/${fileName}`, data: new Uint8Array(rawContent.data) })
    } else if (typeof rawContent === 'string') {
      filesToZip.push({ name: `documents/${fileName}`, data: rawContent })
    } else if (rawContent instanceof Uint8Array) {
      filesToZip.push({ name: `documents/${fileName}`, data: rawContent })
    } else {
      unavailableFiles.push({
        document_id: doc.id,
        file_name: fileName,
        reason: 'Original binary file storage not embedded in memory or inaccessible without signed storage URL',
      })
    }
  }

  const summary = {
    package_version: exportData.package_version,
    generated_at: exportData.generated_at,
    month: exportData.month,
    company: exportData.company,
    readiness: exportData.readiness,
    bank_accounts: exportData.bank_accounts,
  }

  const discrepancies = {
    company_name: exportData.company.name,
    month: exportData.month,
    ...exportData.discrepancies,
    unavailable_files: unavailableFiles,
  }

  filesToZip.push({ name: 'summary.json', data: JSON.stringify(summary, null, 2) })
  filesToZip.push({ name: 'discrepancies.json', data: JSON.stringify(discrepancies, null, 2) })
  filesToZip.push({ name: 'records_registry.json', data: JSON.stringify(exportData.records_registry, null, 2) })

  const zipBytes = createZip(filesToZip)
  const safeComp = (companyName || 'company').replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = `accountant-package-${safeComp}-${month}.zip`

  return {
    zipBytes,
    filename,
    summary,
    discrepancies,
    recordsRegistry: exportData.records_registry,
    unavailableFiles,
  }
}


