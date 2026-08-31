// Invoice Workbench — an action queue over real uploaded documents.
//
// RUNTIME SOURCE: there is no invoice table (migration 041 is an un-applied PROPOSAL and
// there are no /api/invoices routes), so rows come from GET /api/documents filtered to the
// invoice-like document_type values the backend actually defines:
//   vendor_invoice → payable side, customer_invoice → receivable side, tax_invoice → either.
// Rows are labelled "From uploaded documents" so nothing reads as an invoice record.
//
// WHAT IS GENUINELY REAL HERE:
//   • Create payable/receivable — POST /api/debts via the existing DebtFormModal, which the
//     user must submit. Nothing is auto-created.
//   • Link document → debt, and document → transaction — POST /api/documents/:id/links
//     ({target_type, target_id}), the same route the Document Center uses.
//   • Status, amounts, dates, links, source channel — all read from real fields.
//
// WHAT IS DELIBERATELY NOT CLAIMED:
//   • "Review complete" is not persistable — PATCH /api/documents/:id (rpc_document_update_
//     metadata) can write document_type/number/date/currency/gross_amount/counterparty id,
//     but NOT review_status. So no button pretends to mark a document reviewed.
//   • Tax/withholding is never computed — there is no tax engine behind this page.
import { useState, useMemo } from 'react'
import { StatusBadge, Btn, Icon, LoadingSkeleton } from '../../shell/ui'
import { inferService } from './InvoiceReviewDrawer'
import {
  useWorkbench, WorkbenchToolbar, GroupHeader, MoreMenu, NoMatches,
  monthGroup, DATE_OPTIONS, AMOUNT_OPTIONS,
} from './Workbench'
import './Invoices.css'

/* ── classification over real document_type values ────────────────────────── */

export const INVOICE_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice']
export const isInvoiceDoc = (d) => INVOICE_TYPES.includes(d.document_type)

// vendor → we owe (payable). customer → we are owed (receivable). tax_invoice can be
// either, so it is left undirected rather than guessed.
export function directionOf(d) {
  if (d.document_type === 'vendor_invoice') return 'payable'
  if (d.document_type === 'customer_invoice') return 'receivable'
  return null
}
const DIR_LABEL = { payable: 'Supplier invoice', receivable: 'Sales invoice' }

const has = (v) => v !== null && v !== undefined && v !== '' && Number(v) !== 0
export const amountOf = (d) => (has(d.gross_amount) ? Number(d.gross_amount) : null)
export const debtLink = (d) => (d.links || []).find((l) => l.target_type === 'debt') || null
export const txLink = (d) => (d.links || []).find((l) => l.target_type === 'transaction') || null

export function gapsOf(d) {
  const g = []
  if (amountOf(d) === null) g.push('amount')
  if (!d.document_date) g.push('date')
  if (!directionOf(d)) g.push('direction')
  return g
}

/** Row status — every branch is decided by a field or link that genuinely exists. */
export function statusOf(d) {
  const dl = debtLink(d)
  const tl = txLink(d)
  if (dl && tl) return 'closed'
  if (dl) return 'matchPayment'
  const gaps = gapsOf(d)
  if (gaps.length) return 'missing'
  const dir = directionOf(d)
  if (dir === 'payable') return 'readyPayable'
  if (dir === 'receivable') return 'readyReceivable'
  return 'review'
}

const STATUS = {
  review: { label: 'Needs review', tone: 'info' },
  readyPayable: { label: 'Ready to create payable', tone: 'warning' },
  readyReceivable: { label: 'Ready to create receivable', tone: 'warning' },
  matchPayment: { label: 'Match payment', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  missing: { label: 'Missing data', tone: 'warning' },
}
export const statusLabel = (k) => (STATUS[k] || STATUS.review).label

const idr = (n, ccy = 'IDR') => `${ccy} ${Number(n).toLocaleString('de-DE')}`
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

/* ── summary ──────────────────────────────────────────────────────────────── */

export function InvoiceSummary({ docs, loading }) {
  const s = (k) => docs.filter((d) => statusOf(d) === k).length
  const cards = [
    { k: 'review', label: 'Needs review', value: loading ? null : s('review') + s('missing'),
      note: 'Invoice-like documents not yet confirmed' },
    { k: 'ready', label: 'Ready to create', value: loading ? null : s('readyPayable') + s('readyReceivable'),
      note: 'Enough data, no linked record yet' },
    { k: 'linked', label: 'Linked to payable / receivable', value: loading ? null : docs.filter((d) => debtLink(d)).length,
      note: 'Evidence attached to an obligation' },
    { k: 'match', label: 'Ready to match payment', value: loading ? null : s('matchPayment'),
      note: 'Linked to a record, not to a payment' },
    { k: 'closed', label: 'Closed / matched', value: loading ? null : s('closed'),
      note: 'Linked to both a record and a payment' },
  ]
  return (
    <div className="inv-summary">
      {cards.map((c) => (
        <article key={c.k} className="inv-sum">
          <span className="inv-sum-label">{c.label}</span>
          <span className="inv-sum-value">{c.value === null ? '·' : c.value}</span>
          <span className="inv-sum-body">{c.note}</span>
        </article>
      ))}
    </div>
  )
}

/* ── queue ────────────────────────────────────────────────────────────────── */

// Filter/group/sort config. Every accessor reads a field GET /api/documents returns, or a
// link the API genuinely attached — nothing is inferred.
const makeInvCfg = (cpName) => ({
  text: (d) => [d.file?.file_name, d.document_number, d.document_type, d.currency,
    d.gross_amount, d.document_date, cpName(d.issuer_counterparty_id),
    DIR_LABEL[directionOf(d)], statusLabel(statusOf(d))].filter(Boolean).join(' '),
  date: (d) => d.document_date || null,
  amount: (d) => amountOf(d),
  priority: (d) => ({ missing: 0, review: 1, readyPayable: 2, readyReceivable: 2,
    matchPayment: 3, closed: 4 }[statusOf(d)] ?? 9),
  filters: [
    { key: 'direction', label: 'Direction',
      options: [{ value: '', label: 'All directions' },
        { value: 'payable', label: 'Supplier invoices' }, { value: 'receivable', label: 'Sales invoices' }],
      match: (d, v) => directionOf(d) === v },
    { key: 'status', label: 'Status',
      options: [{ value: '', label: 'All statuses' },
        { value: 'review', label: 'Needs review' },
        { value: 'ready', label: 'Ready to create' },
        { value: 'matchPayment', label: 'Match payment' },
        { value: 'closed', label: 'Closed' },
        { value: 'missing', label: 'Missing data' }],
      match: (d, v) => {
        const st = statusOf(d)
        if (v === 'ready') return st === 'readyPayable' || st === 'readyReceivable'
        return st === v
      } },
    { key: 'link', label: 'Link',
      options: [{ value: '', label: 'All' },
        { value: 'none', label: 'Not linked' },
        { value: 'payable', label: 'Linked to payable' },
        { value: 'receivable', label: 'Linked to receivable' },
        { value: 'transaction', label: 'Linked to transaction' }],
      match: (d, v) => {
        if (v === 'none') return !debtLink(d) && !txLink(d)
        if (v === 'transaction') return !!txLink(d)
        return !!debtLink(d) && directionOf(d) === v
      } },
    // Derived from the rows present, so no source is offered that does not exist here.
    { key: 'source', label: 'Source', allLabel: 'All sources',
      derive: (d) => (d.file?.upload_channel
        ? { value: d.file.upload_channel, label: d.file.upload_channel === 'telegram' ? 'Telegram' : d.file.upload_channel === 'bank' ? 'Bank import' : 'Upload' }
        : null),
      match: (d, v) => d.file?.upload_channel === v },
    { key: 'date', label: 'Date', options: DATE_OPTIONS,
      match: (d, v) => {
        const m = (d.document_date || '').slice(0, 7)
        if (v === 'none') return !d.document_date
        if (v === 'this') return m === new Date().toISOString().slice(0, 7)
        const l = new Date(); l.setMonth(l.getMonth() - 1)
        return m === l.toISOString().slice(0, 7)
      } },
    { key: 'amount', label: 'Amount', options: AMOUNT_OPTIONS,
      match: (d, v) => (v === 'has' ? amountOf(d) !== null : amountOf(d) === null) },
  ],
  groups: [
    { value: 'status', label: 'Status', of: (d) => ({ key: statusOf(d), label: statusLabel(statusOf(d)) }) },
    { value: 'direction', label: 'Direction',
      of: (d) => ({ key: directionOf(d) || 'none', label: DIR_LABEL[directionOf(d)] || 'Direction needed' }) },
    { value: 'counterparty', label: 'Counterparty',
      of: (d) => ({ key: d.issuer_counterparty_id || 'none', label: cpName(d.issuer_counterparty_id) || 'No counterparty' }) },
    { value: 'month', label: 'Month', of: monthGroup((d) => d.document_date) },
    { value: 'link', label: 'Link status',
      of: (d) => (debtLink(d) || txLink(d) ? { key: 'l', label: 'Linked' } : { key: 'u', label: 'Not linked' }) },
  ],
})

export function InvoiceQueue({ docs, loading, cpName, blockCreate, onReview, onView, onCreate, onLinkDebt, onMatch, onUpload, navigate }) {
  const cfg = useMemo(() => makeInvCfg(cpName), [cpName])
  const wb = useWorkbench(docs, cfg)

  if (loading) return <section className="inv-section"><LoadingSkeleton rows={5} height={20} /></section>

  if (!docs.length) {
    return (
      <section className="inv-section">
        <div className="inv-empty">
          <span className="inv-empty-ic"><Icon.doc width="20" height="20" aria-hidden="true" /></span>
          <div>
            <p className="inv-empty-title">Upload a supplier or sales invoice to start.</p>
            <p className="inv-note">
              Invoices appear here as soon as a document is uploaded with an invoice type.
              Nothing affects your books until you confirm it.
            </p>
          </div>
          <div className="inv-empty-actions">
            <Btn sm onClick={onUpload}>Upload invoice</Btn>
            <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Open documents</Btn>
          </div>
        </div>
      </section>
    )
  }

  const renderRow = (d) => {
    const st = statusOf(d)
    const dir = directionOf(d)
    const dl = debtLink(d)
    const amt = amountOf(d)
    const cp = cpName(d.issuer_counterparty_id)
    // Name-based inference only — there is no OCR, so this is never presented as extracted.
    const svc = dir === 'payable' ? inferService(cp || d.file?.file_name) : null
    // Primary stays visible, the rest collapse — a long row never becomes a button wall.
    // A record already created for this document but not yet linked must not offer
    // "Create" again — that is how duplicates happen.
    const blocked = blockCreate?.has(d.id)
    const primary = !dl && dir === 'payable' && !blocked
      ? { label: 'Review tax & payable', onClick: () => onReview(d) }
      : !dl && dir && !blocked
      ? { label: `Create ${dir}`, onClick: () => onCreate(d, dir) }
      : blocked && !dl
        ? { label: 'Link existing', onClick: () => onLinkDebt(d) }
      : dl && !txLink(d)
        ? { label: 'Match payment', onClick: () => onMatch(d) }
        : { label: 'Review', onClick: () => onReview(d) }
    const more = [
      primary.label !== 'Review' && { label: 'Review', onClick: () => onReview(d) },
      { label: 'View document', onClick: () => onView(d) },
      !dl && { label: 'Link existing', onClick: () => onLinkDebt(d) },
      dl && { label: `Open ${dir === 'receivable' ? 'receivable' : 'payable'}`,
        onClick: () => navigate(dir === 'receivable' ? '/business/receivables' : '/business/payables') },
    ]
    return (
      <article key={d.id} className="inv-row">
        <div className="inv-row-main">
          <div className="inv-row-head">
            <span className="inv-row-dir">{dir ? DIR_LABEL[dir] : 'Invoice · direction needed'}</span>
            <StatusBadge tone={STATUS[st].tone}>{STATUS[st].label}</StatusBadge>
            {d.file?.upload_channel === 'telegram' && <span className="inv-tag">Telegram</span>}
          </div>
          <span className="inv-row-name">{d.file?.file_name || d.document_number || 'Untitled invoice'}</span>
          <div className="inv-row-meta">
            <span>{cp || <em>Counterparty needed</em>}</span>
            <span>{fmtDate(d.document_date) || <em>Date needed</em>}</span>
            <span className="inv-mono">{amt !== null ? idr(amt, d.currency) : <em>Amount needed</em>}</span>
            <span>{dl ? `Linked · ${dir === 'receivable' ? 'receivable' : 'payable'} #${dl.target_id}` : <em>Not linked</em>}</span>
          </div>
          {/* Service type is a name-based inference, never extraction — labelled as such. */}
          {dir === 'payable' && !dl && (
            <span className="inv-row-tax">
              {svc ? `${svc.label} — inferred, needs review` : 'Service type needs review'}
              {' · Tax review needed'}
            </span>
          )}
        </div>
        <div className="inv-row-actions">
          <Btn sm onClick={primary.onClick}>{primary.label}</Btn>
          <MoreMenu items={more} />
        </div>
      </article>
    )
  }

  return (
    <section className={`inv-section${wb.density === 'compact' ? ' is-compact' : ''}`}>
      <div className="inv-section-head">
        <div>
          <h2 className="inv-section-title">Invoice queue</h2>
          <p className="inv-section-sub">
            From uploaded documents · {wb.visible.length} of {docs.length} shown
          </p>
        </div>
        <Btn sm onClick={onUpload}>Upload invoice</Btn>
      </div>

      <WorkbenchToolbar wb={wb} groups={cfg.groups}
        placeholder="Search invoices, supplier, customer, amount, file name…" />

      {wb.visible.length === 0
        ? <NoMatches onClear={wb.clear} />
        : wb.grouped.map((g) => (
          <div key={g.key}>
            <GroupHeader label={g.label} count={g.rows.length} />
            <div className="inv-rows">{g.rows.map(renderRow)}</div>
          </div>
        ))}
    </section>
  )
}

/* ── review drawer ────────────────────────────────────────────────────────── */

/* ── link picker (debts or transactions) ──────────────────────────────────── */

export function LinkPicker({ open, kind, doc, rows, busy, error, onPick, onClose }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows.slice(0, 40)
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(t)).slice(0, 40)
  }, [q, rows])
  if (!open) return null
  const isDebt = kind === 'debt'
  return (
    <div className="inv-drawer-scrim" onClick={onClose}>
      <aside className="inv-drawer" role="dialog" aria-modal="true"
        aria-label={isDebt ? 'Link to an existing record' : 'Match to a payment'}
        onClick={(e) => e.stopPropagation()}>
        <header className="inv-drawer-head">
          <div>
            <span className="inv-drawer-eyebrow">{doc?.file?.file_name || 'Invoice'}</span>
            <h2 className="inv-drawer-title">{isDebt ? 'Link to existing record' : 'Match to a payment'}</h2>
          </div>
          <button type="button" className="inv-drawer-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>
        <p className="inv-note">
          {isDebt
            ? 'Attach this invoice as evidence for a receivable or payable that already exists.'
            : 'Attach this invoice to the transaction that settled it.'}
        </p>
        <input className="inv-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={isDebt ? 'Search counterparty or amount' : 'Search description or amount'} />
        {error && <p className="inv-note inv-error">{error}</p>}
        <div className="inv-pick-list">
          {list.length === 0 && <p className="inv-note inv-note-muted">Nothing to choose from yet.</p>}
          {list.map((r) => (
            <button key={r.id} type="button" className="inv-pick" disabled={!!busy}
              onClick={() => onPick(r)}>
              <span className="inv-pick-main">
                <span className="inv-pick-title">
                  {isDebt ? (r.counterparty || r.description || `Record #${r.id}`) : (r.description || r.type)}
                </span>
                <span className="inv-pick-sub">
                  {isDebt
                    ? `${r.type} · due ${(r.due_date || '').slice(0, 10) || '—'} · ${r.status}`
                    : `${r.type} · ${(r.transaction_date || r.created_at || '').slice(0, 10)}`}
                </span>
              </span>
              <span className="inv-mono inv-pick-amt">
                {idr(isDebt ? (r.remaining_amount ?? r.amount ?? 0) : (r.amount_original ?? 0), r.currency_original || 'IDR')}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

/* ── compact footer strip ─────────────────────────────────────────────────── */

export function InvoiceFooterNote({ navigate }) {
  return (
    <section className="inv-strip">
      <span className="inv-strip-ic"><Icon.phone width="16" height="16" aria-hidden="true" /></span>
      <p className="inv-note">
        <strong>Uploaded invoices are reviewed before they affect your books.</strong> Confirming
        an invoice creates a receivable or payable and links the document as evidence. Telegram
        intake is planned and will land in the same queue for review.
      </p>
      <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Open documents</Btn>
    </section>
  )
}
