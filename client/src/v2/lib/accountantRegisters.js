// Accountant handoff registers (CSV / XLSX / manifest / README) for a month or a quarter.
// Pure: every input is an existing, company-scoped API response (/api/transactions, /api/wallets, /api/debts,
// /api/payroll/runs, /api/business-funding, /api/pulse/profit-loss, /api/accountant/profile, the operation
// documents package). Nothing here calculates a tax, certifies a filing or invents ledger accounts: amounts are
// the recorded ones, taxes are what was ENTERED (e.g. payroll PPh 21), and every gap is listed, not hidden.

const pad = (n) => String(n).padStart(2, '0')
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A reporting period: a month ('2026-09') or a quarter ('2026-Q3'), with its exact first and last day. */
export function reportingPeriod(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || ''), q = /^(\d{4})-Q([1-4])$/.exec(key || '')
  if (m) {
    const y = Number(m[1]), mo = Number(m[2])
    if (mo < 1 || mo > 12) throw Error('invalid_period')
    return { kind: 'month', key, months: [key], start: `${key}-01`, end: `${key}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}` }
  }
  if (q) {
    const y = Number(q[1]), n = Number(q[2]), first = (n - 1) * 3 + 1
    const months = [0, 1, 2].map((i) => `${y}-${pad(first + i)}`)
    return { kind: 'quarter', key, months, start: `${months[0]}-01`, end: `${months[2]}-${pad(new Date(Date.UTC(y, first + 2, 0)).getUTCDate())}` }
  }
  throw Error('invalid_period')
}
export const quarterOf = (monthKey) => { const [y, m] = monthKey.split('-').map(Number); return `${y}-Q${Math.floor((m - 1) / 3) + 1}` }

const day = (t) => String(t?.transaction_date || t?.date || t?.created_at || '').slice(0, 10)
const inPeriod = (d, p) => DAY.test(d) && d >= p.start && d <= p.end
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
// Exact sums of IDR-style amounts given as strings/numbers with up to 2 decimals (no float drift in totals).
const cents = (v) => Math.round(num(v) * 100)
const fromCents = (c) => (c / 100)
// The ledger's own sign rule (fn_ledger_signed): income +, expense/payroll −, correction as signed, else 0.
const signed = (t) => (t.type === 'income' ? 1 : ['expense', 'payroll'].includes(t.type) ? -1 : t.type === 'correction' ? 1 : 0) * num(t.amount_original ?? t.amount_idr)

/** Safe, unique file name inside the archive: no directories, no traversal, no control characters. */
export function safeFileName(name, fallback = 'file') {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 150)
  return base && base !== '.' && base !== '..' ? base : fallback
}
export function uniqueName(name, taken, suffix) {
  if (!taken.has(name)) { taken.add(name); return name }
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
  let i = 0, out
  do { out = `${stem}_${suffix}${i ? '_' + i : ''}${ext}`; i++ } while (taken.has(out))
  taken.add(out); return out
}

/** Builds every register for the period from the scoped API data. */
export function buildRegisters({ period, company = {}, profile = null, transactions = [], wallets = [], debts = [], payrollRuns = [], funding = null, pnl = null, operationDocuments = [], docPaths = {}, classifications = [] }) {
  const biz = company.business_id
  const mine = (x) => !biz || !x?.business_id || String(x.business_id) === String(biz)
  const walletById = new Map(wallets.filter(mine).map((w) => [String(w.id), w]))
  const walletByName = new Map(wallets.filter(mine).map((w) => [w.name, w]))
  const walletOf = (t) => (t.wallet_id != null ? walletById.get(String(t.wallet_id)) : walletByName.get(t.source)) || null
  const txAll = transactions.filter(mine).filter((t) => t.is_training !== true)
  const txs = txAll.filter((t) => inPeriod(day(t), period)).sort((a, b) => day(a).localeCompare(day(b)) || String(a.id).localeCompare(String(b.id)))

  // P&L treatment of each operation, from the server's own cash-basis report (never recomputed here).
  const pnlById = new Map()
  for (const e of pnl?.entries || []) pnlById.set(String(e.transaction_id), `included: ${e.group}`)
  for (const e of pnl?.excluded || []) pnlById.set(String(e.transaction_id), `excluded: ${e.reason}`)
  for (const e of pnl?.exceptions || []) pnlById.set(String(e.transaction_id), `needs review: ${e.reason}`)
  // Financing evidence from the funding register.
  const fundingTx = new Map()
  for (const r of funding?.records || []) {
    if (r.received_transaction_id != null) fundingTx.set(String(r.received_transaction_id), `${r.instrument} received (${r.source_kind})`)
    for (const rep of r.repayments || []) if (rep.paid_transaction_id != null) fundingTx.set(String(rep.paid_transaction_id), `${r.instrument} repayment due ${rep.due_on}`)
  }
  // Documents linked to each operation (operation documents package of every month in the period).
  const docsByTx = new Map(), docsByDebt = new Map(), docIndex = new Map()
  for (const od of operationDocuments.filter(Boolean)) {
    for (const d of od.available_documents || []) docIndex.set(String(d.id), d)
    for (const o of od.operations || []) {
      const ids = (o.documents || []).map((d) => String(d.id))
      for (const p of o.payments || []) docsByTx.set(String(p.id), [...new Set([...(docsByTx.get(String(p.id)) || []), ...ids])])
      if (o.invoice?.id != null) docsByDebt.set(String(o.invoice.id), [...new Set([...(docsByDebt.get(String(o.invoice.id)) || []), ...ids])])
      for (const d of o.documents || []) docIndex.set(String(d.id), d)
    }
  }
  const pathsOf = (ids) => (ids || []).map((id) => docPaths[id]).filter(Boolean)
  // Backed by an imported statement: created from a row, or an existing operation a row was linked to.
  const onStatement = (t) => !!(t.bank_import_row_id || t.linked_statement_row_id || t.statement_batch_id)

  // 1. Transaction register.
  const T = {
    name: 'transactions', title: 'Transaction register',
    columns: ['date', 'transaction_id', 'type', 'direction', 'amount', 'currency', 'amount_idr', 'account', 'category', 'pnl_treatment', 'financing', 'transfer_id', 'counterparty', 'description', 'bank_statement_row', 'documents', 'document_files'],
    rows: txs.map((t) => {
      const w = walletOf(t), docs = docsByTx.get(String(t.id)) || []
      const dir = signed(t) > 0 ? 'in' : signed(t) < 0 ? 'out' : 'none'
      return [day(t), String(t.id), t.type, dir, num(t.amount_original), t.currency_original || 'IDR', t.amount_idr == null ? '' : num(t.amount_idr), w?.name || t.source || '',
        t.category || '', pnlById.get(String(t.id)) || 'not in report period/currency', fundingTx.get(String(t.id)) || (t.transfer_id ? 'own-account transfer' : ''),
        t.transfer_id || '', t.counterparty_name || '', t.description || '', onStatement(t) ? 'yes' : 'no', docs.length, pathsOf(docs).join('; ')]
    }),
  }
  // 2. Bank and cash movements per account: opening and closing come from the recorded operations (ledger rule).
  const accounts = [...walletById.values()].map((w) => {
    const of = txAll.filter((t) => walletOf(t) === w)
    const before = of.filter((t) => DAY.test(day(t)) && day(t) < period.start).reduce((s, t) => s + cents(signed(t)), 0)
    const inside = of.filter((t) => inPeriod(day(t), period))
    const incoming = inside.filter((t) => signed(t) > 0).reduce((s, t) => s + cents(signed(t)), 0)
    const outgoing = inside.filter((t) => signed(t) < 0).reduce((s, t) => s - cents(signed(t)), 0)
    const undated = of.filter((t) => !DAY.test(day(t))).length
    return { w, before, incoming, outgoing, count: inside.length, undated }
  })
  const A = {
    name: 'bank_cash_accounts', title: 'Bank and cash movements by account',
    columns: ['account', 'type', 'currency', 'opening_balance', 'money_in', 'money_out', 'closing_balance', 'operations_in_period', 'undated_operations'],
    rows: accounts.map(({ w, before, incoming, outgoing, count, undated }) => [w.name, w.type || '', w.currency || '', fromCents(before), fromCents(incoming), fromCents(outgoing), fromCents(before + incoming - outgoing), count, undated]),
  }
  // 3. Revenue and expense by P&L group and category (cash basis, the server report per month).
  const R = { name: 'pnl_cash_basis', title: 'Revenue and expenses by group and category (cash basis)', columns: ['month', 'group', 'category', 'amount', 'currency', 'basis'], rows: [] }
  for (const m of period.months) {
    const p = pnl?.periods?.[m]
    for (const [g, v] of Object.entries(p?.groups || {})) for (const c of v.categories || []) R.rows.push([m, g, c.name, num(c.total), pnl.currency || 'IDR', 'cash, not accrual'])
    if (p?.totals) for (const k of ['revenue', 'direct_cost', 'gross', 'operating_cost', 'ebitda', 'other_income', 'interest', 'tax', 'cash_result'])
      if (p.totals[k] != null) R.rows.push([m, 'TOTAL', k, num(p.totals[k]), pnl.currency || 'IDR', 'cash, not accrual'])
  }
  // 4. Financing: equity and loans, received and repaid in the period, outstanding at the end. Never revenue.
  const F = { name: 'financing', title: 'Financing and owner contributions (not operating income)', columns: ['record_id', 'instrument', 'source', 'lender', 'event', 'date', 'principal', 'interest', 'transaction_id', 'outstanding_at_period_end'], rows: [] }
  for (const r of (funding?.records || []).filter(mine)) {
    const repaidBy = (d) => (r.repayments || []).filter((x) => x.paid_on && x.paid_on <= d).reduce((s, x) => s + cents(x.principal), 0)
    const outstanding = r.instrument === 'loan' && r.received_on <= period.end ? fromCents(cents(r.amount) - repaidBy(period.end)) : ''
    if (inPeriod(r.received_on, period)) F.rows.push([r.id, r.instrument, r.source_kind, r.lender_name || '', 'received', r.received_on, num(r.amount), '', r.received_transaction_id ?? '', outstanding])
    for (const x of r.repayments || []) {
      if (x.paid_on && inPeriod(x.paid_on, period)) F.rows.push([r.id, r.instrument, r.source_kind, r.lender_name || '', 'repayment paid', x.paid_on, num(x.principal), num(x.interest), x.paid_transaction_id ?? '', outstanding])
      else if (!x.paid_on && inPeriod(x.due_on, period)) F.rows.push([r.id, r.instrument, r.source_kind, r.lender_name || '', 'repayment due, not paid', x.due_on, num(x.principal), num(x.interest), '', outstanding])
    }
    if (!inPeriod(r.received_on, period) && r.instrument === 'loan' && r.received_on <= period.end && outstanding !== '' && outstanding > 0)
      F.rows.push([r.id, r.instrument, r.source_kind, r.lender_name || '', 'balance carried', period.end, '', '', '', outstanding])
  }
  // 5. Receivables and payables: open at period end, or invoiced/due in the period.
  const debtRows = debts.filter(mine).filter((d) => d.is_training !== true && d.status !== 'cancelled' && d.approval_status !== 'rejected')
  const D = {
    name: 'receivables_payables', title: 'Receivables and payables',
    columns: ['debt_id', 'type', 'counterparty', 'invoice_number', 'invoice_date', 'due_date', 'amount', 'paid', 'remaining', 'currency', 'status', 'approval', 'overdue_at_period_end', 'documents', 'document_files'],
    rows: debtRows.filter((d) => {
      const created = String(d.invoice_date || d.created_at || '').slice(0, 10), remaining = num(d.original_amount ?? d.amount) - num(d.paid_amount)
      return inPeriod(created, period) || inPeriod(String(d.due_date || ''), period) || (created <= period.end && remaining > 0)
    }).map((d) => {
      const total = num(d.original_amount ?? d.amount), paid = num(d.paid_amount), remaining = fromCents(cents(total) - cents(paid)), docs = docsByDebt.get(String(d.id)) || []
      return [String(d.id), d.type, d.counterparty || '', d.invoice_number || '', String(d.invoice_date || '').slice(0, 10), String(d.due_date || '').slice(0, 10), total, paid, remaining, d.currency || 'IDR',
        d.status || '', d.approval_status || '', remaining > 0 && d.due_date && String(d.due_date).slice(0, 10) < period.end ? 'yes' : 'no', docs.length, pathsOf(docs).join('; ')]
    }),
  }
  // 6. Payroll register: what was ENTERED per person and month (gross, additions, PPh 21, BPJS split), and its bank status.
  const P = {
    name: 'payroll', title: 'Payroll register (amounts as entered; PPh 21 not calculated by CFO AI)',
    columns: ['period_month', 'run_status', 'employee', 'salary', 'additional_pay', 'other_earnings', 'gross', 'pph21_entered', 'bpjs_kesehatan', 'bpjs_tk_jp', 'bpjs_tk_jht', 'bpjs_unsplit', 'other_deductions', 'net', 'employer_bpjs', 'payment_status', 'bank_transaction_id', 'unpaid_net'],
    rows: [],
  }
  for (const run of payrollRuns.filter(mine).filter((r) => period.months.includes(r.period_month) && r.status !== 'cancelled')) {
    for (const pay of run.payroll_payments || []) {
      if (pay.status === 'cancelled') continue
      const it = {}; for (const i of pay.payroll_payment_items || []) it[i.item_type] = num(it[i.item_type]) + num(i.amount)
      const pphEntered = (pay.payroll_payment_items || []).some((i) => i.item_type === 'pph21')
      P.rows.push([run.period_month, run.status, pay.employee_name || '', num(it.salary), num(it.bonus), num(it.earnings), num(pay.gross_amount), pphEntered ? num(it.pph21) : 'not entered',
        num(it.bpjs_kes), num(it.bpjs_jp), num(it.bpjs_jht), num(it.bpjs), num(it.other), num(pay.net_amount), num(pay.employer_bpjs), pay.status, pay.transaction_id ?? '', pay.status === 'paid' ? 0 : num(pay.net_amount)])
    }
  }
  // 7. Missing documents: operations of the period without any linked original.
  const M = {
    name: 'missing_documents', title: 'Operations without a supporting document',
    columns: ['date', 'operation', 'direction', 'amount', 'currency', 'category', 'counterparty', 'status', 'what_is_missing'],
    rows: operationDocuments.filter(Boolean).flatMap((od) => (od.operations || []).filter((o) => o.status !== 'complete' && inPeriod(String(o.date || ''), period)).map((o) => [
      String(o.date || ''), o.key, o.direction || '', num(o.amount), o.currency || 'IDR', o.category || '', o.description || '', o.status || '',
      (o.requirements || []).filter((r) => r.mandatory && r.state === 'missing').map((r) => r.type).join('; ') || (o.status === 'clarification' ? 'clarification needed' : 'supporting document')])),
  }
  // 8. Items requiring the accountant's review (exceptions of the cash report, uncategorised, not matched to a statement).
  const E = { name: 'review_items', title: 'Items requiring manual verification', columns: ['date', 'transaction_id', 'amount', 'currency', 'reason', 'description'], rows: [] }
  for (const x of pnl?.exceptions || []) if (inPeriod(String(x.date || ''), period)) E.rows.push([x.date, String(x.transaction_id ?? ''), num(x.native_amount), x.currency || '', 'P&L: ' + x.reason, x.description || ''])
  for (const t of txs) {
    if (!t.category && !t.cashflow_category_id) E.rows.push([day(t), String(t.id), num(t.amount_original), t.currency_original || 'IDR', 'no category', t.description || ''])
    if (!onStatement(t) && !t.transfer_id && walletOf(t)?.type !== 'cash' && ['income', 'expense', 'payroll'].includes(t.type))
      E.rows.push([day(t), String(t.id), num(t.amount_original), t.currency_original || 'IDR', 'not matched to an imported bank statement row', t.description || ''])
  }
  // 9. Document map: every original in the archive and what it explains.
  const Dm = { name: 'document_map', title: 'Document to operation mapping', columns: ['document_id', 'file_in_package', 'document_type', 'document_date', 'linked_transactions', 'linked_bills'], rows: [] }
  for (const [id, path] of Object.entries(docPaths)) {
    const d = docIndex.get(id) || {}
    const txLinks = [...docsByTx.entries()].filter(([, ids]) => ids.includes(id)).map(([tx]) => tx)
    const debtLinks = [...docsByDebt.entries()].filter(([, ids]) => ids.includes(id)).map(([debt]) => debt)
    Dm.rows.push([id, path, d.document_type || '', String(d.document_date || '').slice(0, 10), txLinks.join('; '), debtLinks.join('; ')])
  }
  // 10. Tax preparation schedule: only what the data supports; nothing here is a calculated or certified tax.
  const tax = taxPreparation({ period, profile, payroll: P, transactions: T, debts: D })
  // 11. Classification and evidence: EVERY operation of the period (none is left out for a missing document).
  const C = classificationRegister({ txs, classifications, operationDocuments, docsByTx, docPaths, pnlById, walletOf })

  const sum = (rows, i, f = () => true) => fromCents(rows.filter(f).reduce((s, r) => s + cents(r[i]), 0))
  const totals = {
    transactions: { count: T.rows.length, money_in: sum(T.rows, 4, (r) => r[3] === 'in'), money_out: sum(T.rows, 4, (r) => r[3] === 'out') },
    payroll: { rows: P.rows.length, gross: sum(P.rows, 6), pph21_entered: sum(P.rows, 7, (r) => typeof r[7] === 'number'), bpjs_kesehatan: sum(P.rows, 8), bpjs_tk_jp: sum(P.rows, 9), bpjs_tk_jht: sum(P.rows, 10), bpjs_unsplit: sum(P.rows, 11), net: sum(P.rows, 13), unpaid_net: sum(P.rows, 17) },
    financing: { received: sum(F.rows, 6, (r) => r[4] === 'received'), principal_repaid: sum(F.rows, 6, (r) => r[4] === 'repayment paid'), interest_paid: sum(F.rows, 7, (r) => r[4] === 'repayment paid') },
    receivables_open: sum(D.rows, 8, (r) => r[1] === 'receivable'), payables_open: sum(D.rows, 8, (r) => r[1] === 'payable'),
    missing_documents: M.rows.length, review_items: E.rows.length,
    classification: C.summary,
  }
  return { tables: [T, A, R, F, D, P, M, E, Dm, tax.table, C.table], totals, tax }
}

// Business purpose of an operation for the accountant (management vs accounting preparation, 24 Oct 2026):
// what a person set (GET /api/transaction-classifications), else what the server's P&L did with it. Labels only;
// nothing here decides tax treatment — a receipt never makes an expense deductible.
const PURPOSE_FROM_PNL = [[/^included: /, 'operating'], [/^excluded: (capital_purchase|asset_purchase)/, 'capital'],
  [/^excluded: personal_non_business/, 'personal'], [/^excluded: (financing|funding|own_account_transfer|transfer|non_pnl_movement|opening_or_correction)/, 'non_pnl'],
  [/^needs review: /, 'needs_review']]
const DOC_STATE = { complete: 'present', missing: 'missing', clarification: 'pending review' }

export function classificationRegister({ txs = [], classifications = [], operationDocuments = [], docsByTx = new Map(), docPaths = {}, pnlById = new Map(), walletOf = () => null }) {
  const cls = new Map(classifications.map((c) => [String(c.transaction_id), c]))
  const opStatus = new Map(), opDocs = new Map()
  for (const od of operationDocuments.filter(Boolean)) for (const o of od.operations || []) for (const p of o.payments || []) {
    opStatus.set(String(p.id), o.status)
    opDocs.set(String(p.id), [...new Set([...(opDocs.get(String(p.id)) || []), ...(o.documents || []).map((d) => String(d.id))])])
  }
  const docsOf = (id) => docsByTx.get(id) || opDocs.get(id) || []
  const table = { name: 'classification_evidence', title: 'Classification and evidence register',
    columns: ['transaction_id', 'date', 'direction', 'amount', 'currency', 'account', 'counterparty', 'category', 'business_purpose', 'purpose_source', 'pnl_treatment',
      'documents', 'document_files', 'accountant_review', 'reviewed_by', 'reviewed_at', 'tax_treatment', 'notes'], rows: [] }
  const s = { operations: 0, purpose_set: 0, purpose_marked_needs_review: 0, needs_review: 0, personal: 0, personal_amount: 0, missing_documents: 0, missing_documents_amount: 0,
    pending_document_review: 0, accountant_reviewed: 0, reviewed_by_other_role: 0, accountant_review_pending: 0, possible_fiscal_adjustment: 0 }
  for (const t of txs) {
    const id = String(t.id), c = cls.get(id) || null, pnl = pnlById.get(id) || ''
    const dir = t.type === 'income' ? 'in' : ['expense', 'payroll', 'bank_fee', 'fx_fee', 'network_fee'].includes(t.type) ? 'out' : 'other'
    const derived = (PURPOSE_FROM_PNL.find(([re]) => re.test(pnl)) || [])[1] || ''
    const purpose = c?.business_purpose || derived
    const ownMove = !!t.transfer_id || t.type === 'transfer' || t.source === 'wallet_opening_balance' || t.type === 'correction'
    const docs = docsOf(id)
    const docState = DOC_STATE[opStatus.get(id)] || (docs.length ? 'present' : ownMove ? 'not required' : 'missing')
    // Only a member with the accountant role makes an accountant's review; any other role's mark is shown as theirs.
    const reviewed = !!c?.accountant_reviewed_at
    const byAccountant = reviewed && c.accountant_reviewed_role === 'accountant'
    const notes = []
    if (c?.note) notes.push(c.note)
    if (purpose === 'personal') notes.push('personal / non-business: not an operating cost')
    if (purpose === 'needs_review' || !purpose) notes.push('business purpose unresolved')
    // Flagged by the FACT that no document is linked (whatever the evidence engine still asks): the accountant decides.
    const adjust = purpose === 'operating' && dir === 'out' && !docs.length && docState !== 'not required'
    if (adjust) notes.push('possible fiscal adjustment: no supporting document (accountant decides)')
    const amount = num(t.amount_original)
    table.rows.push([id, day(t), dir, amount, t.currency_original || 'IDR', walletOf(t)?.name || t.source || '', t.counterparty_name || t.counterparty || '',
      t.category || '', purpose || 'not determined', c?.business_purpose ? 'set by user' : derived ? 'from category / P&L' : 'not determined', pnl || 'not in report period/currency',
      docState, docs.map((d) => docPaths[d]).filter(Boolean).join('; '),
      byAccountant ? 'reviewed by accountant' : reviewed ? `marked reviewed by ${c.accountant_reviewed_role || 'a non-accountant role'} — not an accountant review` : 'pending accountant review',
      reviewed ? `${c.accountant_reviewed_by_name || ''} (${c.accountant_reviewed_role || '?'})` : '', reviewed ? String(c.accountant_reviewed_at).slice(0, 19) : '',
      purpose === 'personal' ? 'not a business expense — accountant review' : 'undetermined — accountant review', notes.join('; ')])
    s.operations++
    if (c?.business_purpose) s.purpose_set++
    if (c?.business_purpose === 'needs_review') s.purpose_marked_needs_review++
    if (purpose === 'needs_review' || !purpose) s.needs_review++
    if (purpose === 'personal') { s.personal++; s.personal_amount += Math.round(amount * 100) }
    if (docState === 'missing' && dir !== 'other') { s.missing_documents++; s.missing_documents_amount += Math.round(amount * 100) }
    if (docState === 'pending review') s.pending_document_review++
    if (byAccountant) s.accountant_reviewed++; else s.accountant_review_pending++
    if (reviewed && !byAccountant) s.reviewed_by_other_role++
    if (adjust) s.possible_fiscal_adjustment++
  }
  s.personal_amount /= 100; s.missing_documents_amount /= 100
  return { table, summary: s }
}

/** What the accountant may need to prepare, from the data AND the company's recorded tax profile. */
export function taxPreparation({ period, profile, payroll, transactions, debts }) {
  const p = profile || {}
  const rows = [], missing = []
  const need = (field, label) => { if (p[field] == null || p[field] === '') missing.push(label) }
  need('legal_entity_type', 'legal entity type (PT / PT PMA / CV / perorangan)'); need('npwp', 'company NPWP'); need('pkp_status', 'PKP status'); need('tax_regime', 'tax regime')
  const months = period.months
  const pphByMonth = new Map(), withoutPph = new Map()
  for (const r of payroll.rows) {
    if (typeof r[7] === 'number') pphByMonth.set(r[0], (pphByMonth.get(r[0]) || 0) + Math.round(r[7] * 100)); else withoutPph.set(r[0], (withoutPph.get(r[0]) || 0) + 1)
  }
  for (const m of months) {
    if (pphByMonth.has(m) || withoutPph.has(m)) rows.push([m, 'PPh 21/26 (employees)', 'SPT Masa PPh 21/26 · Coretax DJP', pphByMonth.has(m) ? pphByMonth.get(m) / 100 : '',
      'entered on the payroll register, not calculated by CFO AI', withoutPph.get(m) ? `${withoutPph.get(m)} payroll line(s) without PPh 21` : '', 'Coretax e-Bupot BPMP/BP21 needs per-employee NIK/NPWP, PTKP status and NITKU, which CFO AI does not hold'])
  }
  const taxPaid = transactions.rows.filter((r) => /tax|pph|ppn|pajak|djp|налог/i.test(`${r[8]} ${r[9]} ${r[12]} ${r[13]}`) && r[3] === 'out')
  for (const r of taxPaid) rows.push([r[0].slice(0, 7), 'Tax payment recorded', 'evidence for the accountant (billing code / NTPN to be matched)', r[4], `transaction ${r[1]}: ${r[13]}`, '', 'not a calculated liability'])
  // Same normalisation as server/lib/pkpStatus.js: only an explicit registration counts ("not_registered" does not).
  const pkp = String(p.pkp_status || p.vat_status || '').trim().toLowerCase().replace(/\s+/g, '_')
  if (['pkp', 'pkp_registered', 'registered', 'yes', 'true'].includes(pkp)) rows.push([period.key, 'PPN', 'SPT Masa PPN · Coretax DJP (e-Faktur)', '', 'company is PKP: output/input VAT needs tax invoices (Faktur Pajak)', 'CFO AI holds no Faktur Pajak register', 'accountant prepares from tax invoices'])
  else rows.push([period.key, 'PPN', 'only if the company is PKP', '', pkp ? `PKP status recorded as "${p.pkp_status || p.vat_status}"` : 'PKP status not recorded', '', 'not assessed'])
  const vendorBills = debts.rows.filter((r) => r[1] === 'payable')
  if (vendorBills.length) rows.push([period.key, 'PPh 23/26 (services from vendors)', 'SPT Masa PPh Unifikasi · Coretax DJP (e-Bupot BPPU/BPNR)', '', `${vendorBills.length} vendor bill(s) in the period`, 'withholding applicability per bill is not classified', 'accountant decides per service type and vendor'])
  if (p.foreign_owned === true || /^(true|yes)$/i.test(String(p.foreign_owned ?? '')) || /pma/i.test(String(p.legal_entity_type || ''))) rows.push([period.key, 'LKPM (investment activity report)', 'quarterly, OSS (BKPM) — not Coretax', '', 'company recorded as foreign-owned / PT PMA', '', 'prepared in OSS'])
  rows.push([period.key, 'SPT Tahunan PPh Badan', 'annual, Coretax DJP', '', 'needs statutory (accrual) financial statements', 'CFO AI provides a cash-basis estimate only; no general ledger or trial balance yet', 'not prepared here'])
  const table = { name: 'tax_preparation', title: 'Tax preparation schedule. ' + PACKAGE_LABEL,
    columns: ['period', 'item', 'where it is filed', 'amount_recorded', 'basis', 'gaps', 'note'], rows }
  return { table, missing_profile: missing }
}

const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) || /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? '"' + s.replace(/"/g, '""') + '"' : s }
/** RFC 4180 CSV, UTF-8 with BOM (Excel opens Cyrillic/Indonesian text correctly). Formula-like text is quoted. */
export function toCsv(table) {
  return '﻿' + [table.columns, ...table.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export async function sha256Hex(bytes) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const h = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const PACKAGE_LABEL = 'Prepared for Accountant Review — Not a Direct Coretax Import File'

export function readmeText({ period, company, totals, missingProfile = [], unavailable = 0, unavailableSources = [], isComplete = false, generatedAt }) {
  const lines = [
    `CFO AI — accountant handoff package`, PACKAGE_LABEL, '',
    `Company: ${company.name || ''}`, `Period: ${period.key} (${period.start} to ${period.end}, both days included)`, `Generated: ${generatedAt}`,
    `Package status: ${isComplete ? 'complete for review (accountant sign-off still required)' : 'INCOMPLETE — see discrepancies.json and the PDF'} · Filed: NO`, '',
    'WHAT IS INSIDE',
    '  accountant-summary.pdf      readable summary, readiness checks and exceptions',
    '  registers/*.csv             UTF-8 CSV, one file per register (comma separated, ISO dates, plain numbers)',
    '  *_Registers.xlsx            the same registers as worksheets',
    '  documents/                  original files exactly as uploaded (PDF/JPG/PNG/CSV)',
    '  manifest.json / .csv        every file with SHA-256, record counts and totals',
    '  summary.json, discrepancies.json, records_registry.json, operation-documents.json   machine-readable detail',
    '',
    'TOTALS (recorded amounts)',
    `  Operations: ${totals.transactions.count} · money in ${totals.transactions.money_in} · money out ${totals.transactions.money_out}`,
    `  Payroll: gross ${totals.payroll.gross} · PPh 21 entered ${totals.payroll.pph21_entered} · BPJS Kesehatan ${totals.payroll.bpjs_kesehatan} · BPJS TK JP ${totals.payroll.bpjs_tk_jp} · BPJS TK JHT ${totals.payroll.bpjs_tk_jht} · net ${totals.payroll.net} · unpaid net ${totals.payroll.unpaid_net}`,
    `  Financing (not income): received ${totals.financing.received} · principal repaid ${totals.financing.principal_repaid} · interest paid ${totals.financing.interest_paid}`,
    `  Receivables still open ${totals.receivables_open} · payables still open ${totals.payables_open} (invoiced by ${period.end}, unpaid when this package was built)`,
    `  Operations without a document: ${totals.missing_documents} · items for manual verification: ${totals.review_items} · originals not retrievable: ${unavailable}`,
    ...(totals.classification ? [
      '',
      'CLASSIFICATION AND EVIDENCE (registers/11_classification_evidence.csv — every operation, none left out)',
      `  Operations ${totals.classification.operations} · business purpose set by a person ${totals.classification.purpose_set} · purpose unresolved ${totals.classification.needs_review}`,
      `  Personal / non-business paid from company accounts: ${totals.classification.personal} (${totals.classification.personal_amount}) — not operating costs`,
      `  Without a supporting document: ${totals.classification.missing_documents} (${totals.classification.missing_documents_amount}) · document check pending: ${totals.classification.pending_document_review}`,
      `  Accountant review: ${totals.classification.accountant_reviewed} reviewed by an accountant · ${totals.classification.accountant_review_pending} pending (of which ${totals.classification.reviewed_by_other_role} marked by the owner or another non-accountant role) · possible fiscal adjustments flagged: ${totals.classification.possible_fiscal_adjustment}`,
      '  Tax treatment is undetermined for every operation: a receipt does not make an expense deductible; the accountant decides.',
    ] : []),
    '',
    'LIMITATIONS — THE ACCOUNTANT MUST CHECK',
    '  * The P&L is a CASH-BASIS estimate from classified money movements. It is NOT a statutory accrual income statement.',
    '    There is no general ledger, trial balance or balance sheet in this package.',
    '  * Taxes are not calculated or certified by CFO AI. PPh 21 is the amount ENTERED on payroll; tax payments are listed as evidence.',
    '  * Financing (owner equity, loans received, principal repaid) is listed separately and is never operating income.',
    '  * Nothing in this package is a Coretax XML import file. Coretax imports use the official DJP XML templates',
    '    (e.g. BPMP / BP21 for PPh 21, BPPU / BPNR for PPh Unifikasi, e-Faktur for PPN); they need NIK/NPWP, NITKU,',
    '    PTKP status and tax object codes that CFO AI does not hold. Source: pajak.go.id, Template XML dan Converter Excel ke XML.',
    '  * Monthly SPT Masa and annual SPT Tahunan are filed in Coretax DJP. Quarterly LKPM (when it applies) is filed in OSS, not Coretax.',
    '  * Generating or downloading this package does NOT mean anything was filed. Filing status needs the accountant\'s confirmation (e.g. BPE / NTPN).',
    ...(missingProfile.length ? ['', 'TAX PROFILE FIELDS NOT RECORDED: ' + missingProfile.join('; ')] : []),
    ...(unavailableSources.length ? ['', 'SOURCES NOT AVAILABLE WHEN BUILT (their registers are incomplete): ' + unavailableSources.join('; ')] : []),
    '', 'Synthetic test packages carry synthetic data only.', '',
  ]
  return lines.join('\r\n')
}
