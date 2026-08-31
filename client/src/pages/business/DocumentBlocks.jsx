// Document Workbench — an action queue over real uploaded evidence.
//
// Same product logic as the Invoice Workbench: row → Review → Link / Create record /
// Match / Archive. This page answers "what needs action right now?", not "how does the
// document process work?".
//
// EVERY FIELD IS REAL. GET /api/documents returns document_type, document_number,
// document_date, currency, gross_amount, extraction_status, review_status, archived_at,
// links[] and file.upload_channel.
//
// REAL MUTATIONS USED HERE (all user-confirmed, none automatic):
//   • PATCH /api/documents/:id  → rpc_document_update_metadata can write document_type,
//     so "Classify" is a genuine action.
//   • POST  /api/documents/:id/links {target_type, target_id} → debt or transaction.
//   • POST  /api/debts via the existing DebtFormModal → then linked to the document.
//   • POST  /api/documents/:id/archive
//
// NOT CLAIMED: review_status is NOT writable through the API, so nothing marks a document
// "reviewed". Extraction is never described as having run — extraction_status is shown
// verbatim, and a blank field reads as missing rather than as an AI result.
import { useMemo } from 'react'
import { StatusBadge, Btn, Icon, LoadingSkeleton } from '../../shell/ui'
import {
  useWorkbench, WorkbenchToolbar, GroupHeader, MoreMenu, NoMatches, SelectionBar,
  monthGroup, DATE_OPTIONS, AMOUNT_OPTIONS,
} from './Workbench'
import './Documents.css'

/* ── derivation over real fields ──────────────────────────────────────────── */

const has = (v) => v !== null && v !== undefined && v !== '' && Number(v) !== 0
export const amountOf = (d) => (has(d.gross_amount) ? Number(d.gross_amount) : null)
export const isLinked = (d) => Array.isArray(d.links) && d.links.length > 0
export const debtLink = (d) => (d.links || []).find((l) => l.target_type === 'debt') || null
export const txLink = (d) => (d.links || []).find((l) => l.target_type === 'transaction') || null

export const DOC_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong',
  'tax_billing', 'payment_proof', 'filing_confirmation', 'bank_document', 'other']
const TYPE_LABEL = {
  vendor_invoice: 'Supplier invoice', customer_invoice: 'Sales invoice',
  tax_invoice: 'Tax invoice', bukti_potong: 'Withholding slip', tax_billing: 'Tax billing',
  payment_proof: 'Payment proof', filing_confirmation: 'Filing confirmation',
  bank_document: 'Bank document', other: 'Unclassified',
}
export const typeLabel = (t) => TYPE_LABEL[t] || t || 'Unclassified'

export function gapsOf(d) {
  const g = []
  if (amountOf(d) === null) g.push('amount')
  if (!d.document_date) g.push('date')
  if (!d.document_type || d.document_type === 'other') g.push('type')
  if (!d.issuer_counterparty_id) g.push('counterparty')
  return g
}

export function statusOf(d) {
  if (d.archived_at) return 'archived'
  if (d.extraction_status === 'pending' || d.extraction_status === 'processing') return 'extracting'
  const reviewed = d.review_status === 'approved' || d.review_status === 'reviewed'
  const complete = gapsOf(d).length === 0
  if (reviewed && isLinked(d) && complete) return 'ready'
  if (!reviewed) return 'review'
  if (!isLinked(d)) return 'unlinked'
  return 'missing'
}
const STATUS = {
  ready: { label: 'Accounting-ready', tone: 'success' },
  review: { label: 'Needs review', tone: 'info' },
  extracting: { label: 'Extracting', tone: 'info' },
  unlinked: { label: 'Unlinked', tone: 'warning' },
  missing: { label: 'Missing data', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
}

const CHANNEL = { web: 'Upload', telegram: 'Telegram', email: 'Email', bank: 'Bank import', api: 'Provider' }
export const channelOf = (d) => CHANNEL[d.file?.upload_channel] || d.file?.upload_channel || null

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const money = (n, ccy = 'IDR') => `${ccy} ${Number(n).toLocaleString('de-DE')}`

/** Which financial record a document type should end up against. */
export function actionsFor(d) {
  const t = d.document_type
  if (t === 'vendor_invoice') return { create: 'payable', link: 'payable' }
  if (t === 'customer_invoice') return { create: 'receivable', link: 'receivable' }
  if (t === 'tax_invoice') return { link: 'both' }
  if (t === 'payment_proof' || t === 'bank_document') return { link: 'transaction' }
  return { classify: true, link: 'transaction' }
}

/* ── queues ───────────────────────────────────────────────────────────────── */

export const QUEUES = [
  { key: 'review', label: 'Needs review', match: (d) => !d.archived_at && ['review', 'extracting'].includes(statusOf(d)) },
  { key: 'unlinked', label: 'Unlinked', match: (d) => !d.archived_at && !isLinked(d) },
  { key: 'missing', label: 'Missing data', match: (d) => !d.archived_at && gapsOf(d).length > 0 },
  { key: 'ready', label: 'Accounting-ready', match: (d) => !d.archived_at && statusOf(d) === 'ready' },
  { key: 'archived', label: 'Archived', match: (d) => !!d.archived_at },
  { key: 'all', label: 'All documents', match: () => true },
]

/* ── summary ──────────────────────────────────────────────────────────────── */

export function DocumentSummary({ docs, loading }) {
  const n = (k) => docs.filter(QUEUES.find((q) => q.key === k).match).length
  const cards = [
    ['Needs review', 'review'], ['Unlinked', 'unlinked'], ['Missing data', 'missing'],
    ['Accounting-ready', 'ready'], ['Archived', 'archived'],
  ]
  return (
    <div className="doc-summary">
      {cards.map(([label, key]) => (
        <article key={key} className="doc-sum">
          <span className="doc-sum-label">{label}</span>
          <span className="doc-sum-value">{loading ? '·' : n(key)}</span>
        </article>
      ))}
    </div>
  )
}

/* ── work queue ───────────────────────────────────────────────────────────── */

// Filter/group/sort config — every accessor reads a field the API genuinely returns.
const makeDocCfg = (cpName) => ({
  text: (d) => [d.file?.file_name, d.document_number, d.document_type, d.currency,
    d.gross_amount, d.document_date, cpName(d.issuer_counterparty_id)].filter(Boolean).join(' '),
  date: (d) => d.document_date || null,
  amount: (d) => amountOf(d),
  // Needs-action ordering: unclassified and incomplete first, settled last.
  priority: (d) => {
    const st = statusOf(d)
    return { review: 0, extracting: 1, missing: 2, unlinked: 3, ready: 4, archived: 5 }[st] ?? 9
  },
  filters: [
    { key: 'type', label: 'Type',
      options: [{ value: '', label: 'All types' },
        ...DOC_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))],
      match: (d, v) => d.document_type === v },
    { key: 'status', label: 'Status',
      options: [{ value: '', label: 'All statuses' },
        ...['review', 'unlinked', 'missing', 'ready', 'archived']
          .map((k) => ({ value: k, label: QUEUES.find((q) => q.key === k).label }))],
      match: (d, v) => QUEUES.find((q) => q.key === v).match(d) },
    // Source options are derived from the rows, so no channel is offered that does not exist.
    { key: 'source', label: 'Source', allLabel: 'All sources',
      derive: (d) => (d.file?.upload_channel ? { value: d.file.upload_channel, label: channelOf(d) } : null),
      match: (d, v) => d.file?.upload_channel === v },
    { key: 'link', label: 'Link',
      options: [{ value: '', label: 'All' }, { value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Unlinked' }],
      match: (d, v) => (v === 'linked' ? isLinked(d) : !isLinked(d)) },
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
    { value: 'status', label: 'Status', of: (d) => ({ key: statusOf(d), label: STATUS[statusOf(d)].label }) },
    { value: 'type', label: 'Document type', of: (d) => ({ key: d.document_type || 'other', label: typeLabel(d.document_type) }) },
    { value: 'source', label: 'Source', of: (d) => ({ key: d.file?.upload_channel || 'unknown', label: channelOf(d) || 'Unknown source' }) },
    { value: 'month', label: 'Month', of: monthGroup((d) => d.document_date) },
    { value: 'counterparty', label: 'Counterparty',
      of: (d) => ({ key: d.issuer_counterparty_id || 'none', label: cpName(d.issuer_counterparty_id) || 'No counterparty' }) },
    { value: 'link', label: 'Link status', of: (d) => (isLinked(d) ? { key: 'l', label: 'Linked' } : { key: 'u', label: 'Unlinked' }) },
  ],
})

export function DocumentQueue({
  docs, loading, active, onSelect, cpName, selected, onToggle, onClearSel, onBulkArchive, busy,
  onReview, onView, onArchive, onCreate, onLink, onClassify, onUpload, navigate,
}) {
  const inQueue = docs.filter((QUEUES.find((q) => q.key === active) || QUEUES[0]).match)
  const cfg = useMemo(() => makeDocCfg(cpName), [cpName])
  const wb = useWorkbench(inQueue, cfg)
  if (loading) return <section className="doc-section"><LoadingSkeleton rows={5} height={20} /></section>

  return (
    <section className={`doc-section${wb.density === 'compact' ? ' is-compact' : ''}`}>
      <div className="doc-section-head">
        <div>
          <h2 className="doc-section-title">Document work queue</h2>
          <p className="doc-section-sub">AI extraction is reviewed before it affects your books.</p>
        </div>
        <Btn sm onClick={onUpload}>Upload document</Btn>
      </div>

      <div className="doc-tabs" role="tablist" aria-label="Document queues">
        {QUEUES.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === active}
            className={`doc-tab${t.key === active ? ' is-active' : ''}`} onClick={() => onSelect(t.key)}>
            {t.label}<span className="doc-tab-n">{docs.filter(t.match).length}</span>
          </button>
        ))}
      </div>

      <WorkbenchToolbar wb={wb} groups={cfg.groups}
        placeholder="Search documents, counterparty, amount, file name…"
        selection={<SelectionBar count={selected.size} busy={busy}
          onArchive={onBulkArchive} onClear={onClearSel} />} />

      {wb.visible.length === 0 ? (
        wb.activeCount > 0
          ? <NoMatches onClear={wb.clear} />
          : (
            <div className="doc-empty">
              <span className="doc-empty-ic"><Icon.doc width="19" height="19" aria-hidden="true" /></span>
              <div>
                <p className="doc-empty-title">Nothing needs action here</p>
                <p className="doc-note">Upload an invoice, receipt or statement to start.</p>
              </div>
              <Btn sm variant="ghost" onClick={onUpload}>Upload document</Btn>
            </div>
          )
      ) : (
        <div role="tabpanel">
          {wb.grouped.map((g) => (
            <div key={g.key}>
              <GroupHeader label={g.label} count={g.rows.length} />
              <div className="doc-rows">
                {g.rows.map((d) => {
                  const st = statusOf(d)
                  const a = actionsFor(d)
                  const gaps = gapsOf(d)
                  const amt = amountOf(d)
                  const dl = debtLink(d)
                  const cp = cpName(d.issuer_counterparty_id)
                  // Primary stays visible; the rest collapse so a narrow row never wraps
                  // into a wall of equal-weight buttons.
                  const primary = a.create
                    ? { label: `Create ${a.create}`, onClick: () => onCreate(d, a.create) }
                    : a.classify ? { label: 'Classify', onClick: () => onClassify(d) }
                      : { label: 'Review', onClick: () => onReview(d) }
                  const more = [
                    primary.label !== 'Review' && { label: 'Review', onClick: () => onReview(d) },
                    { label: 'View document', onClick: () => onView(d) },
                    a.link === 'payable' && !dl && { label: 'Link to payable', onClick: () => onLink(d, 'debt', 'payable') },
                    a.link === 'receivable' && !dl && { label: 'Link to receivable', onClick: () => onLink(d, 'debt', 'receivable') },
                    a.link === 'both' && !dl && { label: 'Link to payable', onClick: () => onLink(d, 'debt', 'payable') },
                    a.link === 'both' && !dl && { label: 'Link to receivable', onClick: () => onLink(d, 'debt', 'receivable') },
                    a.link === 'transaction' && !txLink(d) && { label: 'Link to transaction', onClick: () => onLink(d, 'transaction') },
                    dl && { label: 'Open record', onClick: () => navigate('/business/payables') },
                    !d.archived_at && { label: 'Archive', onClick: () => onArchive(d) },
                  ]
                  return (
                    <article key={d.id} className="doc-row">
                      <input type="checkbox" className="wb-check" checked={selected.has(d.id)}
                        onChange={() => onToggle(d.id)} aria-label={`Select ${d.file?.file_name || 'document'}`} />
                      <div className="doc-row-main">
                        <div className="doc-row-head">
                          <span className="doc-row-type">{typeLabel(d.document_type)}</span>
                          <StatusBadge tone={STATUS[st].tone}>{STATUS[st].label}</StatusBadge>
                          {channelOf(d) && <span className="doc-tag">{channelOf(d)}</span>}
                        </div>
                        <span className="doc-row-name">{d.file?.file_name || d.document_number || 'Untitled document'}</span>
                        <div className="doc-row-meta">
                          <span>{cp || <em>Counterparty needed</em>}</span>
                          <span>{fmtDate(d.document_date) || <em>Date needed</em>}</span>
                          <span className="doc-mono">{amt !== null ? money(amt, d.currency) : <em>Amount needed</em>}</span>
                          <span>{dl ? `Linked · record #${dl.target_id}` : txLink(d) ? `Linked · transaction #${txLink(d).target_id}` : <em>Unlinked</em>}</span>
                        </div>
                        {gaps.length > 0 && <span className="doc-row-gap">Missing {gaps.join(', ')}</span>}
                      </div>
                      <div className="doc-row-actions">
                        <Btn sm onClick={primary.onClick}>{primary.label}</Btn>
                        <MoreMenu items={more} />
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ── review drawer (aligned with the invoice drawer) ──────────────────────── */

export function DocumentReview({ doc, cpName, onClose, onView, onCreate, onLink, onClassify, onArchive }) {
  if (!doc) return null
  const a = actionsFor(doc)
  const st = statusOf(doc)
  const amt = amountOf(doc)
  const gaps = gapsOf(doc)
  const need = <em className="doc-need">Needs review</em>
  const fields = [
    ['Document type', typeLabel(doc.document_type)],
    ['Document number', doc.document_number || null],
    ['Date', fmtDate(doc.document_date)],
    ['Counterparty', cpName(doc.issuer_counterparty_id)],
    ['Amount', amt !== null ? money(amt, doc.currency) : null],
    ['Currency', doc.currency || null],
    ['Extraction status', doc.extraction_status || null],
  ]
  const suggestion = a.create === 'payable' ? 'Create a payable — this is money your business owes.'
    : a.create === 'receivable' ? 'Create a receivable — this is money expected from a customer.'
      : a.link === 'transaction' ? 'Link this to the transaction it explains.'
        : a.link === 'both' ? 'Link this to the payable or receivable it belongs to.'
          : 'Classify the document so the right action becomes available.'

  return (
    <div className="doc-drawer-scrim" onClick={onClose}>
      <aside className="doc-drawer" role="dialog" aria-modal="true" aria-label="Document review"
        onClick={(e) => e.stopPropagation()}>
        <header className="doc-drawer-head">
          <div>
            <span className="doc-drawer-eyebrow">{typeLabel(doc.document_type)}</span>
            <h2 className="doc-drawer-title">{doc.file?.file_name || doc.document_number || 'Document'}</h2>
          </div>
          <button type="button" className="doc-drawer-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>

        <section className="doc-drawer-sec">
          <span className="doc-drawer-label">Document</span>
          <div className="doc-kv"><span>Source</span><span>{channelOf(doc) || '—'}</span></div>
          <div className="doc-kv"><span>File</span><span>{doc.file?.file_name || '—'}</span></div>
          <Btn sm variant="ghost" onClick={() => onView(doc)}>View document</Btn>
        </section>

        <section className="doc-drawer-sec">
          <span className="doc-drawer-label">Extracted fields</span>
          {fields.map(([k, v]) => <div className="doc-kv" key={k}><span>{k}</span><span>{v || need}</span></div>)}
        </section>

        <section className="doc-drawer-sec">
          <span className="doc-drawer-label">Evidence status</span>
          <div className="doc-kv"><span>Status</span><span>{STATUS[st].label}</span></div>
          <div className="doc-kv"><span>Linked</span><span>{isLinked(doc) ? 'Yes' : 'Not linked'}</span></div>
          {gaps.length > 0 && <div className="doc-kv"><span>Missing</span><span>{gaps.join(', ')}</span></div>}
        </section>

        <section className="doc-drawer-sec">
          <span className="doc-drawer-label">Suggested action</span>
          <p className="doc-note">{suggestion}</p>
        </section>

        <footer className="doc-drawer-actions">
          {a.classify && <Btn onClick={() => onClassify(doc)}>Classify document</Btn>}
          {a.create && !debtLink(doc) && <Btn onClick={() => onCreate(doc, a.create)}>Create {a.create} draft</Btn>}
          {a.link === 'payable' && !debtLink(doc) && <Btn variant="ghost" onClick={() => onLink(doc, 'debt', 'payable')}>Link to existing payable</Btn>}
          {a.link === 'receivable' && !debtLink(doc) && <Btn variant="ghost" onClick={() => onLink(doc, 'debt', 'receivable')}>Link to existing receivable</Btn>}
          {a.link === 'both' && !debtLink(doc) && <>
            <Btn variant="ghost" onClick={() => onLink(doc, 'debt', 'payable')}>Link to payable</Btn>
            <Btn variant="ghost" onClick={() => onLink(doc, 'debt', 'receivable')}>Link to receivable</Btn>
          </>}
          {a.link === 'transaction' && !txLink(doc) && <Btn variant="ghost" onClick={() => onLink(doc, 'transaction')}>Link to transaction</Btn>}
          {!doc.archived_at && <Btn variant="ghost" onClick={() => onArchive(doc)}>Archive</Btn>}
          <p className="doc-note doc-note-muted">
            Marking a document reviewed is not stored yet — the review status field is
            read-only through the API.
          </p>
        </footer>
      </aside>
    </div>
  )
}

/* ── classify drawer — real: PATCH writes document_type ───────────────────── */

export function ClassifyDrawer({ doc, busy, error, onPick, onClose }) {
  if (!doc) return null
  return (
    <div className="doc-drawer-scrim" onClick={onClose}>
      <aside className="doc-drawer" role="dialog" aria-modal="true" aria-label="Classify document"
        onClick={(e) => e.stopPropagation()}>
        <header className="doc-drawer-head">
          <div>
            <span className="doc-drawer-eyebrow">{doc.file?.file_name || 'Document'}</span>
            <h2 className="doc-drawer-title">Classify document</h2>
          </div>
          <button type="button" className="doc-drawer-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>
        <p className="doc-note">
          Choosing the type decides which financial record this evidence can be attached to.
        </p>
        {error && <p className="doc-note doc-error">{error}</p>}
        <div className="doc-pick-list">
          {DOC_TYPES.map((t) => (
            <button key={t} type="button" className="doc-pick" disabled={busy || t === doc.document_type}
              onClick={() => onPick(t)}>
              <span className="doc-pick-title">{typeLabel(t)}</span>
              <span className="doc-pick-sub">{t}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

/* ── compact bottom strip ─────────────────────────────────────────────────── */

export function DocumentFlowStrip({ navigate, onUpload }) {
  return (
    <section className="doc-strip">
      <div className="doc-strip-main">
        <span className="doc-strip-title">How documents flow through the system</span>
        <span className="doc-strip-flow">Upload → Review → Link → Accounting-ready</span>
        <p className="doc-note">Documents are reviewed before they affect your books.</p>
      </div>
      <div className="doc-strip-actions">
        <Btn sm variant="ghost" onClick={onUpload}>Upload document</Btn>
        <Btn sm variant="ghost" onClick={() => navigate('/business/bank-import')}>Bank import</Btn>
        <Btn sm variant="ghost" onClick={() => navigate('/business/payment-connections')}>Payment connections</Btn>
        <span className="doc-tag">Telegram upload planned</span>
      </div>
    </section>
  )
}
