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
import { useMemo, useState } from 'react'
import { StatusBadge, Btn, Icon, LoadingSkeleton } from '../../shell/ui'
import {
  useWorkbench, WorkbenchToolbar, GroupHeader, MoreMenu, NoMatches, SelectionBar,
  monthGroup, DATE_OPTIONS, AMOUNT_OPTIONS,
} from './Workbench'
import {
  vaultVerdictOf, partitionDocuments, VAULT_TYPES, vaultLabel, shelfLabel, VAULT_SHELVES,
  needsClassificationReview, CLASSIFICATION_REVIEW_LABEL,
} from './companyVault'
import ReviewPanel, { RpCols, RpCol, RpActions } from './ReviewPanel'
import DocumentPreview from './DocumentPreview'
import {
  intakeOf, intakeBadges, intakeHeadline, intakeRowLines, intakeCopy, storedVsSuggested,
  typeLabelOf as intakeTypeLabel, directionLabelOf, statusLabelOf, statusLabelFor, nextActionLabels, taxLine, recordLabelOf,
  documentWorkflowState, primaryActionLabel,
  draftOffer, counterpartyOffer, isUnsupported,
  uploadIntentOf, readSourceLabel, conflictMessage,
} from './documentIntakeView'
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

/** Which financial record a document type should end up against.
 *
 *  The stored column decides whenever a human has set it. Only when it is still 'other'
 *  does the intake suggestion get a say — otherwise a recognised invoice offers nothing
 *  but "Classify", which is the dead end this page used to be. The suggestion changes
 *  which action is OFFERED; it never writes the column and never creates anything. */
export function actionsFor(d) {
  const t = d.document_type
  if (t === 'vendor_invoice') return { create: 'payable', link: 'payable' }
  if (t === 'customer_invoice') return { create: 'receivable', link: 'receivable' }
  if (t === 'tax_invoice') return { link: 'both' }
  if (t === 'payment_proof' || t === 'bank_document') return { link: 'transaction' }
  const v2 = intakeOf(d)
  if (!t || t === 'other') {
    const offer = draftOffer(v2, { alreadyLinked: !!debtLink(d) })
    if (offer.show && offer.type === 'payable') return { create: 'payable', link: 'payable', fromIntake: true }
    if (offer.show && offer.type === 'receivable') return { create: 'receivable', link: 'receivable', fromIntake: true }
    if (v2?.direction === 'incoming_payment' || v2?.direction === 'outgoing_payment')
      return { classify: true, link: 'transaction', fromIntake: true }
  }
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

// Counts the two views the page is built around, plus the two states that decide
// whether the inbox is actually clean. Archived and accounting-ready still have
// their own queue tabs — they are not work, so they do not need a headline number.
export function documentCounts(docs = []) {
  const { evidence, vault } = partitionDocuments(docs)
  const live = (rows) => rows.filter((d) => !d.archived_at)
  const liveEvidence = live(evidence)
  const liveVault = live(vault)
  return {
    evidence: liveEvidence.length,
    vault: liveVault.length,
    // Needs review spans BOTH views: an unconfirmed vault suggestion is a real
    // open question, the same way an unreviewed invoice is.
    needsReview: liveEvidence.filter((d) => ['review', 'extracting'].includes(statusOf(d))).length
      + liveVault.filter((d) => !vaultVerdictOf(d)?.confirmed).length,
    unlinked: liveEvidence.filter((d) => !isLinked(d)).length,
    vaultSuggested: liveVault.filter((d) => !vaultVerdictOf(d)?.confirmed).length,
  }
}

export function DocumentSummary({ docs, loading, view, onView }) {
  const c = documentCounts(docs)
  const cards = [
    { key: 'inbox', label: 'Evidence inbox', value: c.evidence, meta: 'need accounting action' },
    { key: 'review', label: 'Needs review', value: c.needsReview, meta: 'across both views' },
    { key: 'inbox_unlinked', label: 'Unlinked evidence', value: c.unlinked, meta: 'not attached to a record' },
    { key: 'vault', label: 'Company vault', value: c.vault,
      meta: c.vaultSuggested ? `${c.vaultSuggested} suggested` : 'permanent company files' },
  ]
  const target = { inbox: 'inbox', review: 'inbox', inbox_unlinked: 'inbox', vault: 'vault' }
  return (
    <div className="doc-summary">
      {cards.map((card) => (
        <button key={card.key} type="button"
          className={`doc-sum${view === target[card.key] ? ' is-current' : ''}`}
          onClick={() => onView?.(target[card.key])}>
          <span className="doc-sum-label">{card.label}</span>
          <span className="doc-sum-value">{loading ? '·' : card.value}</span>
          <span className="doc-sum-meta">{card.meta}</span>
        </button>
      ))}
    </div>
  )
}

/* ── primary view switch: work queue vs storage ───────────────────────────── */

export function DocumentViewTabs({ view, onView, counts }) {
  const tabs = [
    { key: 'inbox', label: 'Evidence Inbox', n: counts.evidence },
    { key: 'vault', label: 'Company Vault', n: counts.vault },
  ]
  return (
    <div className="doc-views" role="tablist" aria-label="Document views">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === view}
          className={`doc-view${t.key === view ? ' is-active' : ''}`} onClick={() => onView(t.key)}>
          {t.label}<span className="doc-tab-n">{t.n}</span>
        </button>
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

/* ── the intake summary on a list row ─────────────────────────────────────────
   What intake concluded, in one glance: what the document is, which way it points,
   where it stands, and what it is still missing. A document nobody has analysed says
   so plainly and offers the one button that fixes that — never a blank space. */
export function IntakeRowSummary({ doc, onAnalyze, analyzing }) {
  const v2 = intakeOf(doc)
  if (!v2) {
    return (
      <div className="doc-ai-row">
        <span className="doc-ai-none">Not processed yet</span>
        {onAnalyze && (
          <button type="button" className="doc-ai-run" disabled={analyzing === doc.id}
            onClick={(e) => { e.stopPropagation(); onAnalyze(doc) }}>
            {analyzing === doc.id ? 'Analyzing…' : 'Analyze document'}
          </button>
        )}
      </div>
    )
  }
  const pair = storedVsSuggested(doc, typeLabel(doc.document_type))
  return (
    <div className="doc-ai-row">
      <span className="doc-ai-head">{intakeHeadline(v2)}</span>
      <span className="doc-ai-badges">
        {intakeBadges(v2).map((b) => (
          <StatusBadge key={b.key} tone={b.tone}>{b.label}</StatusBadge>
        ))}
      </span>
      {(pair.showPair || pair.showUploadedAs) && (
        <span className="doc-ai-pair">
          Stored type: {pair.storedLabel}
          {pair.showUploadedAs && <> · Uploaded as: {pair.uploadedAs}</>}
          {pair.showPair && <> · AI suggestion: {pair.suggestedLabel}</>}
        </span>
      )}
      {pair.conflict && <span className="doc-ai-conflict">{conflictMessage(doc)}</span>}
      {intakeRowLines(v2).map((l) => <span key={l} className="doc-ai-line">{l}</span>)}
    </div>
  )
}

export function DocumentQueue({
  docs, loading, active, onSelect, cpName, selected, onToggle, onClearSel, onBulkArchive, busy, blockCreate,
  onReview, onView, onArchive, onCreate, onLink, onClassify, onUpload, navigate,
  onAnalyze, analyzing, freshIds = null,
  // Inline review (desktop). Both default to inert, so the drawer path is unchanged.
  expandedId = null, renderPanel = null,
}) {
  const inQueue = docs.filter((QUEUES.find((q) => q.key === active) || QUEUES[0]).match)
  const cfg = useMemo(() => makeDocCfg(cpName), [cpName])
  const wb = useWorkbench(inQueue, cfg)
  if (loading) return <section className="doc-section"><LoadingSkeleton rows={5} height={20} /></section>

  return (
    <section className={`doc-section${wb.density === 'compact' ? ' is-compact' : ''}`}>
      <div className="doc-section-head">
        <div>
          <h2 className="doc-section-title">Evidence Inbox</h2>
          <p className="doc-section-sub">Documents that need accounting action.</p>
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
                  // Already created once without a link — offer linking, never a second create.
                  const blocked = blockCreate?.has(d.id)
                  // The row's primary button comes from the same workflow decision the
                  // detail panel uses, so the two can never disagree about what should
                  // happen next to this document.
                  const wf = documentWorkflowState(d)
                  const PRIMARY = {
                    create_payable: { label: 'Create payable', onClick: () => onCreate(d, 'payable') },
                    create_receivable: { label: 'Create receivable', onClick: () => onCreate(d, 'receivable') },
                    link_transaction: { label: 'Link to transaction', onClick: () => onLink(d, 'transaction') },
                    create_counterparty: { label: 'Review & confirm', onClick: () => onReview(d) },
                    save_supporting: { label: 'Review', onClick: () => onReview(d) },
                    review_confirm: { label: 'Review & confirm', onClick: () => onReview(d) },
                    review_fields: { label: 'Review', onClick: () => onReview(d) },
                    open_record: { label: 'Open record', onClick: () => navigate('/business/payables') },
                    analyze: { label: 'Classify', onClick: () => onClassify(d) },
                  }
                  const primary = blocked && !dl
                    ? { label: 'Link existing', onClick: () => onLink(d, 'debt', a.link === 'receivable' ? 'receivable' : 'payable') }
                    : (PRIMARY[wf.recommendedPrimaryAction] || { label: 'Review', onClick: () => onReview(d) })
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
                  const isOpen = expandedId === d.id
                  return (
                    <div key={d.id} className="doc-rowgroup">
                    <article className={`doc-row${isOpen ? ' is-rp-open' : ''}${freshIds?.has(d.id) ? ' is-fresh' : ''}`}>
                      <input type="checkbox" className="wb-check" checked={selected.has(d.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onToggle(d.id)} aria-label={`Select ${d.file?.file_name || 'document'}`} />
                      <div className="doc-row-main" role="button" tabIndex={0} aria-expanded={isOpen}
                        onClick={() => onReview(d)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReview(d) } }}>
                        <div className="doc-row-head">
                          <span className="doc-row-type">{typeLabel(d.document_type)}</span>
                          <StatusBadge tone={STATUS[st].tone}>{STATUS[st].label}</StatusBadge>
                          {/* A suggested company type no longer removes the row from
                              this list — it says so here instead. */}
                          {needsClassificationReview(d) && (
                            <StatusBadge tone="warning">{CLASSIFICATION_REVIEW_LABEL}</StatusBadge>
                          )}
                          {channelOf(d) && <span className="doc-tag">{channelOf(d)}</span>}
                        </div>
                        <IntakeRowSummary doc={d} onAnalyze={onAnalyze} analyzing={analyzing} />
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
                    {isOpen && renderPanel?.(d)}
                    </div>
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

export function DocumentReview({ doc, cpName, onClose, onView, onCreate, onLink, onClassify, onArchive,
  onAnalyze, analyzing, analyzeNote, onReviewFields }) {
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

        {/* The same intake conclusion the desktop panel shows, in the narrow layout. */}
        <section className="doc-drawer-sec">
          <span className="doc-drawer-label">AI Intake Result</span>
          <p className="doc-note">{intakeCopy(intakeOf(doc))}</p>
          {intakeOf(doc) && (
            <>
              <div className="doc-kv"><span>Type</span><span>{intakeTypeLabel(intakeOf(doc).document_type) || '—'}</span></div>
              <div className="doc-kv"><span>Direction</span><span>{directionLabelOf(intakeOf(doc).direction) || '—'}</span></div>
              <div className="doc-kv"><span>Status</span><span>{statusLabelFor(intakeOf(doc))}</span></div>
              {intakeRowLines(intakeOf(doc)).map((l) => <p key={l} className="doc-note">{l}</p>)}
            </>
          )}
          {onAnalyze && (
            <Btn sm variant="ghost" onClick={() => onAnalyze(doc)} disabled={analyzing === doc.id}>
              {analyzing === doc.id ? 'Analyzing…' : intakeOf(doc) ? 'Re-analyze' : 'Analyze document'}
            </Btn>
          )}
          {onReviewFields && (
            <Btn sm variant="ghost" onClick={() => onReviewFields(doc)}>
              {isUnsupported(intakeOf(doc)) ? 'Enter fields manually' : 'Review fields'}
            </Btn>
          )}
          {analyzeNote && <p className="doc-note">{analyzeNote}</p>}
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

/* ── review / enter the fields by hand ───────────────────────────────────────
   The route out of every blocked intake state — missing fields, no counterparty, and
   above all a scan CFO AI cannot read. Everything here is typed by the user and saved
   through the two existing endpoints:
     · PATCH /api/documents/:id                  → document_type (CHECK-valid column)
     · PATCH /api/documents/:id/financial-fields → reference, dates, base / tax / total
   Nothing is prefilled from the AI suggestion: a suggestion the user never looked at
   must not become a saved figure just because they pressed Save. */
export function ReviewFieldsDrawer({ doc, busy, error, note, onSave, onClose, inline = false }) {
  const v2 = intakeOf(doc)
  const [f, setF] = useState(() => ({
    document_type: doc?.document_type || 'other',
    document_number: doc?.document_number || '',
    document_date: doc?.document_date || '',
    currency: doc?.currency || 'IDR',
    commercial_base_amount: doc?.commercial_base_amount ?? '',
    commercial_tax_amount: doc?.commercial_tax_amount ?? '',
    gross_amount: doc?.gross_amount ?? '',
  }))
  if (!doc) return null
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }))

  const body = (
    <>
      {isUnsupported(v2) && (
        <p className="rp-note rp-note-amber">
          I cannot read this document automatically yet. Automatic extraction needs OCR/Vision.
          You can still record it by entering the values below.
        </p>
      )}
      {v2?.missing_fields?.length > 0 && (
        <p className="rp-note rp-note-amber">Intake is waiting on {v2.missing_fields.join(', ')}.</p>
      )}
      {error && <p className="rp-note rp-note-warn">{error}</p>}
      <div className="doc-field-grid">
        <label className="doc-field"><span>Document type</span>
          <select value={f.document_type} onChange={set('document_type')} disabled={busy}>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
        </label>
        <label className="doc-field"><span>Document / reference number</span>
          <input value={f.document_number} onChange={set('document_number')} disabled={busy} /></label>
        <label className="doc-field"><span>Document date</span>
          <input type="date" value={f.document_date || ''} onChange={set('document_date')} disabled={busy} /></label>
        <label className="doc-field"><span>Currency</span>
          <input value={f.currency} onChange={set('currency')} disabled={busy} /></label>
        <label className="doc-field"><span>Base / DPP</span>
          <input inputMode="decimal" value={f.commercial_base_amount} onChange={set('commercial_base_amount')} disabled={busy} /></label>
        <label className="doc-field"><span>Tax / PPN</span>
          <input inputMode="decimal" value={f.commercial_tax_amount} onChange={set('commercial_tax_amount')} disabled={busy} /></label>
        <label className="doc-field"><span>Total / gross</span>
          <input inputMode="decimal" value={f.gross_amount} onChange={set('gross_amount')} disabled={busy} /></label>
      </div>
      <p className="rp-note rp-note-muted">
        Leave the total blank and it is derived from base + tax. Saving updates this document
        only — it creates no payable, receivable or tax record.
      </p>
      {note && <p className="rp-note rp-note-muted">{note}</p>}
      <div className="doc-panel-acts">
        <Btn sm onClick={() => onSave(doc, f)} disabled={busy}>{busy ? 'Saving…' : 'Save fields'}</Btn>
        <Btn sm variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
      </div>
    </>
  )

  if (inline) {
    return (
      <ReviewPanel eyebrow={doc.file?.file_name || 'Document'} title="Review fields"
        sub="Values you enter here are stored on the document. Nothing is filled in for you."
        onClose={onClose}>{body}</ReviewPanel>
    )
  }
  return (
    <div className="doc-drawer-scrim" onClick={onClose}>
      <aside className="doc-drawer" role="dialog" aria-modal="true" aria-label="Review document fields"
        onClick={(e) => e.stopPropagation()}>
        <header className="doc-drawer-head">
          <div>
            <span className="doc-drawer-eyebrow">{doc.file?.file_name || 'Document'}</span>
            <h2 className="doc-drawer-title">Review fields</h2>
          </div>
          <button type="button" className="doc-drawer-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>
        {body}
      </aside>
    </div>
  )
}

export function ClassifyDrawer({ doc, busy, error, onPick, onClose, inline = false }) {
  if (!doc) return null
  const body = (
      <>
        <p className="doc-note">
          Choosing the type decides which financial record this evidence can be attached to.
        </p>
        {error && <p className="doc-note doc-error">{error}</p>}
        <div className="doc-pick-grid">
          {DOC_TYPES.map((t) => (
            <button key={t} type="button" className="doc-pick" disabled={busy || t === doc.document_type}
              onClick={() => onPick(t)}>
              <span className="doc-pick-title">{typeLabel(t)}</span>
              <span className="doc-pick-sub">{t}</span>
            </button>
          ))}
        </div>
      </>
  )
  if (inline) {
    return (
      <ReviewPanel eyebrow={doc.file?.file_name || 'Document'} title="Classify document"
        sub="Choosing the type decides which financial record this evidence can be attached to."
        onClose={onClose}>
        {error && <p className="rp-note rp-note-warn" style={{ marginBottom: 10 }}>{error}</p>}
        <div className="doc-pick-grid">
          {DOC_TYPES.map((t) => (
            <button key={t} type="button" className="doc-pick" disabled={busy || t === doc.document_type}
              onClick={() => onPick(t)}>
              <span className="doc-pick-title">{typeLabel(t)}</span>
              <span className="doc-pick-sub">{t}</span>
            </button>
          ))}
        </div>
      </ReviewPanel>
    )
  }
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
        {body}
      </aside>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   INLINE DOCUMENT REVIEW PANEL (desktop)

   Same derivations as the DocumentReview drawer — statusOf / gapsOf / actionsFor /
   vaultVerdictOf — laid out in three columns with the PREVIEW as the strongest
   element, because "what is this file?" is the question this page answers.

   The preview shows the file. It is not extraction: no value below is read from the
   document, and `extracted_json` is never written from here.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── AI Intake Result ─────────────────────────────────────────────────────────
   The whole point of the Document Center change: what intake worked out, and the
   actions that follow from it. Every action here is a user click that goes through an
   existing endpoint. NOTHING on this panel creates a counterparty, a payable, a
   receivable, a transaction or a tax record on its own. */
export function IntakeResult({
  doc, cpName, busy, analyzing, analyzeNote, cpSuggestion, cpBusy, cpError,
  onAnalyze, onReviewFields, onCreateDraft, onSuggestCounterparty, onCreateCounterparty,
  onLinkCounterparty, onViewCounterparty, onAccountantReview, onTaxSplit,
}) {
  const v2 = intakeOf(doc)
  const analysing = analyzing === doc.id

  if (!v2) {
    return (
      <RpCol label="AI Intake Result" emphasis>
        <p className="rp-note rp-note-muted">
          This document has not been analysed yet. Running the analysis reads the document
          and stores a review summary — it creates no records.
        </p>
        <div className="doc-panel-acts">
          <Btn sm onClick={() => onAnalyze(doc)} disabled={analysing || busy}>
            {analysing ? 'Analyzing…' : 'Analyze document'}
          </Btn>
        </div>
        {analyzeNote && <p className="rp-note rp-note-muted">{analyzeNote}</p>}
      </RpCol>
    )
  }

  const unsupported = isUnsupported(v2)
  const offer = draftOffer(v2, { alreadyLinked: !!debtLink(doc) })
  const cpOffer = counterpartyOffer(v2)
  const matchedName = cpOffer.matchedId ? cpName?.(cpOffer.matchedId) : null

  const intent = uploadIntentOf(doc)
  const conflict = conflictMessage(doc)

  return (
    <RpCol label="AI Intake Result" emphasis>
      <p className={`rp-note ${unsupported ? 'rp-note-amber' : ''}`}>{intakeCopy(v2)}</p>

      {/* Three separate readings, never merged: the column a person owns, what the user
          said they were uploading, and what the document itself says. */}
      <div className="rp-kv"><span>Stored type</span><span>{typeLabel(doc.document_type)}</span></div>
      {intent && (
        <div className="rp-kv"><span>Uploaded as</span><span>{intent.label}</span></div>
      )}
      {conflict && <p className="rp-note rp-note-amber">{conflict}</p>}

      <div className="rp-kv"><span>Document type suggestion</span>
        <span>{intakeTypeLabel(v2.document_type) || <em className="rp-miss">Unrecognised</em>}</span></div>
      <div className="rp-kv"><span>Confidence</span>
        <span>{String(v2.confidence || 'needs review').replace(/_/g, ' ')}</span></div>
      {readSourceLabel(v2) && (
        <div className="rp-kv"><span>Read by</span><span>{readSourceLabel(v2)}</span></div>
      )}
      <div className="rp-kv"><span>Direction</span>
        <span>{directionLabelOf(v2.direction) || <em className="rp-miss">Unknown</em>}</span></div>
      {v2.business_meaning && (
        <div className="rp-kv"><span>Business meaning</span><span>{v2.business_meaning}</span></div>
      )}
      <div className="rp-kv"><span>Status</span><span>{statusLabelFor(v2)}</span></div>
      <div className="rp-kv"><span>Suggested record</span>
        <span>{v2.suggested_record_type && v2.suggested_record_type !== 'none'
          ? recordLabelOf(v2.suggested_record_type)
          : <em className="rp-miss">None suggested</em>}</span></div>
      <div className="rp-kv"><span>Amount</span>
        <span className="rp-mono">{v2.amount != null
          ? money(v2.amount, v2.currency) : <em className="rp-miss">Not detected</em>}</span></div>

      {/* ── tax ─────────────────────────────────────────────────────────── */}
      <span className="rp-col-label" style={{ marginTop: 8 }}>Tax</span>
      <div className="rp-kv"><span>PPN</span>
        <span>{taxLine(v2)}</span></div>
      <div className="rp-kv"><span>Withholding / PPh</span>
        <span>{v2.accountant_review_required
          ? 'Needs accountant review'
          : String(v2.withholding_status || 'unknown').replace(/_/g, ' ')}</span></div>

      {/* ── counterparty ────────────────────────────────────────────────── */}
      <span className="rp-col-label" style={{ marginTop: 8 }}>Counterparty</span>
      {cpOffer.status === 'matched' ? (
        <>
          <p className="rp-note">Counterparty recognized: <strong>{matchedName || 'a record in your directory'}</strong></p>
          <div className="doc-panel-acts">
            {cpOffer.canLink && !doc.issuer_counterparty_id && (
              <Btn sm onClick={() => onLinkCounterparty(doc, cpOffer.matchedId)} disabled={busy || cpBusy}>Link counterparty</Btn>
            )}
            <Btn sm variant="ghost" onClick={() => onViewCounterparty(cpOffer.matchedId)}>View counterparty</Btn>
            <Btn sm variant="ghost" onClick={() => onSuggestCounterparty(doc)} disabled={cpBusy}>Change</Btn>
          </div>
        </>
      ) : cpOffer.status === 'possible_match' ? (
        <>
          <p className="rp-note rp-note-amber">Possible existing counterparty found. Confirm before anything is linked.</p>
          <div className="doc-panel-acts">
            {cpOffer.canLink && cpOffer.matchedId && !doc.issuer_counterparty_id && (
              <Btn sm onClick={() => onLinkCounterparty(doc, cpOffer.matchedId)} disabled={busy || cpBusy}>Use existing</Btn>
            )}
            <Btn sm variant="ghost" onClick={() => onSuggestCounterparty(doc)} disabled={cpBusy}>Review</Btn>
          </div>
        </>
      ) : (
        <>
          <p className="rp-note">Counterparty not found in your directory.</p>
          <div className="doc-panel-acts">
            <Btn sm variant="ghost" onClick={() => onSuggestCounterparty(doc)} disabled={cpBusy}>
              {cpBusy ? 'Reading document…' : 'Review and create counterparty'}
            </Btn>
          </div>
        </>
      )}
      {cpError && <p className="rp-note rp-note-warn">{cpError}</p>}
      {!cpOffer.canLink && <p className="rp-note rp-note-muted">{cpOffer.limitation}</p>}
      {doc.issuer_counterparty_id && (
        <p className="rp-note rp-note-muted">
          Already attached to {cpName?.(doc.issuer_counterparty_id) || 'a counterparty'}.
        </p>
      )}

      {/* The zero-write suggestion, once fetched. Creating is still a separate click. */}
      {cpSuggestion?.documentId === doc.id && (
        <div className="doc-cp-suggest">
          <div className="rp-kv"><span>Suggested profile</span>
            <span>{cpSuggestion.suggested_counterparty?.legal_name || <em className="rp-miss">No name read</em>}</span></div>
          {cpSuggestion.suggested_counterparty?.npwp && (
            <div className="rp-kv"><span>NPWP</span><span>{cpSuggestion.suggested_counterparty.npwp}</span></div>
          )}
          <div className="rp-kv"><span>Match</span><span>{String(cpSuggestion.status || '').replace(/_/g, ' ')}</span></div>
          {(cpSuggestion.warnings || []).map((w) => <p key={w} className="rp-note rp-note-amber">{w}</p>)}
          {/* The server decides whether a create may be offered. It refuses when the
              reader may have identified the user's own company, or when the name and
              tax number could not be tied to one party. */}
          {cpSuggestion.can_create === false && (
            <p className="rp-note rp-note-amber">
              {cpSuggestion.reason || cpSuggestion.role_reason
                || 'CFO AI may have identified your own company instead of the counterparty. '
                   + 'Review the document parties before continuing.'}
            </p>
          )}
          {(cpSuggestion.parties || []).length > 0 && (
            <div className="doc-cp-parties">
              {cpSuggestion.parties.map((p, i) => (
                <div key={i} className="rp-kv">
                  <span>{p.role === 'buyer_or_payer' ? 'Buyer / payer' : 'Issuer / receiver'}</span>
                  <span>{p.legal_name}{p.npwp ? ` · NPWP ${p.npwp}` : ''}
                    {p.is_business?.match ? ' · this business' : ''}</span>
                </div>
              ))}
            </div>
          )}
          <div className="doc-panel-acts">
            {cpSuggestion.can_create !== false && cpSuggestion.suggested_counterparty?.legal_name && (
              <Btn sm onClick={() => onCreateCounterparty(doc, cpSuggestion)} disabled={cpBusy}>Create counterparty</Btn>
            )}
            <Btn sm variant="ghost" onClick={() => onViewCounterparty(null)}>Edit before creating</Btn>
            <Btn sm variant="ghost" onClick={() => onSuggestCounterparty(null)}>Ignore</Btn>
          </div>
          <p className="rp-note rp-note-muted">
            Nothing has been created. Duplicate detection runs again when you confirm.
          </p>
        </div>
      )}

      {/* ── what is missing ─────────────────────────────────────────────── */}
      {(v2.missing_fields?.length > 0 || v2.blockers?.length > 0) && (
        <>
          <span className="rp-col-label" style={{ marginTop: 8 }}>Missing</span>
          {v2.missing_fields?.length > 0 && (
            <p className="rp-note rp-note-amber">Missing {v2.missing_fields.join(', ')}.</p>
          )}
          {(v2.blockers || []).map((b) => <p key={b} className="rp-note rp-note-amber">{b}</p>)}
        </>
      )}

      {/* ── next ────────────────────────────────────────────────────────── */}
      <span className="rp-col-label" style={{ marginTop: 8 }}>Next</span>
      <ol className="doc-ai-next">
        {nextActionLabels(v2).map((a) => <li key={a.key}>{a.label}</li>)}
      </ol>

      <div className="doc-panel-acts">
        <Btn sm variant="ghost" onClick={() => onReviewFields(doc)} disabled={busy}>
          {unsupported ? 'Enter fields manually' : 'Review fields'}
        </Btn>
        {offer.show && (
          <Btn sm onClick={() => onCreateDraft(doc, offer.type)} disabled={busy || !offer.enabled}>
            Create {offer.type} draft
          </Btn>
        )}
        {v2.ppn_detected && <Btn sm variant="ghost" onClick={onTaxSplit}>Open AI Tax Split</Btn>}
        <Btn sm variant="ghost" onClick={onAccountantReview}>Request accountant review</Btn>
        <Btn sm variant="ghost" onClick={() => onAnalyze(doc)} disabled={analysing || busy}>
          {analysing ? 'Analyzing…' : 'Re-analyze'}
        </Btn>
      </div>
      {offer.show && !offer.enabled && <p className="rp-note rp-note-amber">{offer.reason}</p>}
      {analyzeNote && <p className="rp-note rp-note-muted">{analyzeNote}</p>}
      <p className="rp-note rp-note-muted">
        CFO AI suggests; you confirm. Running the analysis stores a review summary only —
        no counterparty, payable, receivable, transaction or tax record is created by it.
        {v2.processed_at && ` Last analysed ${new Date(v2.processed_at).toLocaleString('en-GB')}.`}
      </p>
    </RpCol>
  )
}

export function DocumentReviewPanel({
  doc, cpName, getSignedUrl, busy,
  onClose, onView, onDownload, onCreate, onLink, onClassify, onArchive,
  onReclassify, onMoveToVault, onOpenAccountant,
  // intake surface — all optional, so any other caller of this panel is unchanged
  analyzing, analyzeNote, cpSuggestion, cpBusy, cpError, onAnalyze, onReviewFields,
  onSuggestCounterparty, onCreateCounterparty, onLinkCounterparty, onViewCounterparty, onTaxSplit,
}) {
  if (!doc) return null
  const a = actionsFor(doc)
  const st = statusOf(doc)
  const amt = amountOf(doc)
  const gaps = gapsOf(doc)
  const dl = debtLink(doc)
  const tl = txLink(doc)
  const vault = vaultVerdictOf(doc)
  const intake = doc.extracted_json?.ai_intake || null
  // The single source of truth for what this panel may offer.
  const wf = documentWorkflowState(doc)
  const need = <em className="rp-miss">Needs review</em>

  const suggestion = vault
    ? 'This looks like a permanent company document. Confirm its classification to keep it in the Company Vault.'
    : a.create === 'payable' ? 'Create a payable — this is money your business owes.'
      : a.create === 'receivable' ? 'Create a receivable — this is money expected from a customer.'
        : a.link === 'transaction' ? 'Link this to the transaction it explains.'
          : a.link === 'both' ? 'Link this to the payable or receivable it belongs to.'
            : 'Classify the document so the right action becomes available.'

  return (
    <ReviewPanel
      eyebrow={vault ? vault.label : typeLabel(doc.document_type)}
      title={doc.file?.file_name || doc.document_number || 'Document'}
      sub={vault ? 'Permanent company / compliance file.' : 'Accounting evidence — review, then link it to a record.'}
      chips={<>
        <StatusBadge tone={vault ? (vault.confirmed ? 'success' : 'warning') : STATUS[st].tone}>
          {vault ? (vault.confirmed ? 'Confirmed' : 'Suggested') : STATUS[st].label}
        </StatusBadge>
        {intakeBadges(intakeOf(doc)).map((b) => (
          <StatusBadge key={b.key} tone={b.tone}>{b.label}</StatusBadge>
        ))}
        {channelOf(doc) && <span className="doc-tag">{channelOf(doc)}</span>}
      </>}
      onClose={onClose}>

      <RpCols>
        {/* ── 1 — the file itself ────────────────────────────────────────── */}
        <RpCol label="Document preview">
          <DocumentPreview doc={doc} getSignedUrl={getSignedUrl} />
        </RpCol>

        {/* ── 2 — fields and classification ──────────────────────────────── */}
        <RpCol label="Fields & classification">
          <div className="rp-kv"><span>Stored type</span><span>{typeLabel(doc.document_type)}</span></div>
          {/* Stored column and AI suggestion side by side — never merged, never overwritten. */}
          {storedVsSuggested(doc, typeLabel(doc.document_type)).showPair && (
            <div className="rp-kv"><span>AI suggestion</span>
              <span>{storedVsSuggested(doc, typeLabel(doc.document_type)).suggestedLabel}
                {' '}<em className="doc-ai-hint">needs confirmation</em></span></div>
          )}
          <div className="rp-kv"><span>Document number</span><span>{doc.document_number || need}</span></div>
          <div className="rp-kv"><span>Date</span><span>{fmtDate(doc.document_date) || need}</span></div>
          <div className="rp-kv"><span>Counterparty</span><span>{cpName?.(doc.issuer_counterparty_id) || need}</span></div>
          <div className="rp-kv"><span>Amount</span>
            <span className="rp-mono">{amt !== null ? money(amt, doc.currency) : need}</span></div>
          <div className="rp-kv"><span>Currency</span><span>{doc.currency || need}</span></div>
          <div className="rp-kv"><span>Extraction status</span><span>{doc.extraction_status || need}</span></div>
          <div className="rp-kv"><span>Source</span><span>{channelOf(doc) || '—'}</span></div>

          {intake ? (
            <>
              <span className="rp-col-label" style={{ marginTop: 8 }}>AI intake classification</span>
              {/* vaultLabel() falls back to "Company document", which would be wrong for a
                  finance intake type — so it is only used for actual vault types. */}
              <div className="rp-kv"><span>Classified as</span>
                <span>{vault ? vaultLabel(intake.doc_type) : (intake.doc_type || 'Unclassified').replace(/_/g, ' ')}</span></div>
              <div className="rp-kv"><span>Status</span>
                <span>{String(intake.classification_status || 'needs review').replace(/_/g, ' ')}</span></div>
              {intake.confidence && <div className="rp-kv"><span>Confidence</span><span>{intake.confidence}</span></div>}
            </>
          ) : (
            <p className="rp-note rp-note-muted">
              No stored classification for this document yet.
            </p>
          )}

          {vault && (
            <p className={`rp-note ${vault.confirmed ? 'rp-note-muted' : 'rp-note-amber'}`}>
              {vault.note}
              {vault.source === 'filename' && ' · matched on the file name, nothing was saved'}
            </p>
          )}

          {gaps.length > 0 && (
            <p className="rp-note rp-note-amber">Missing {gaps.join(', ')}.</p>
          )}
          <p className="rp-note rp-note-muted">
            Fields come from the stored record. A blank field means nothing was entered — the
            AI Intake Result alongside is a suggestion and is never written into these fields
            for you.
          </p>
        </RpCol>

        {/* ── 3 — the workflow column ──────────────────────────────────────
            AI Intake Result and Actions & routing are ONE cell of the grid. As
            separate columns they made a fourth, which wrapped onto a second row and
            left Actions stranded far below the tall document preview. */}
        <div className="rp-workflow-stack">
        {onAnalyze && (
          <IntakeResult doc={doc} cpName={cpName} busy={busy}
            analyzing={analyzing} analyzeNote={analyzeNote}
            cpSuggestion={cpSuggestion} cpBusy={cpBusy} cpError={cpError}
            onAnalyze={onAnalyze} onReviewFields={onReviewFields}
            onCreateDraft={onCreate} onSuggestCounterparty={onSuggestCounterparty}
            onCreateCounterparty={onCreateCounterparty} onLinkCounterparty={onLinkCounterparty}
            onViewCounterparty={onViewCounterparty}
            onAccountantReview={onOpenAccountant} onTaxSplit={onTaxSplit} />
        )}

        {/* ── 3 — routing and actions ─────────────────────────────────────
            Everything offered here comes from documentWorkflowState, the single
            decision the panel makes. Before that existed this column keyed off the
            stored document_type alone, so a document whose reading said "direction
            unknown, no record suggested" still had "Create payable draft" as its
            primary button. */}
        <RpCol label="Actions & routing" emphasis>
          <div className="rp-kv"><span>Evidence status</span><span>{STATUS[st].label}</span></div>
          <div className="rp-kv"><span>Linked</span>
            <span>{dl ? `Record #${dl.target_id}` : tl ? `Transaction #${tl.target_id}` : <em className="rp-miss">Not linked</em>}</span></div>
          <div className="rp-kv"><span>Next step</span>
            <span>{primaryActionLabel(wf.recommendedPrimaryAction)}</span></div>

          <p className={`rp-note ${wf.warningReason ? 'rp-note-amber' : ''}`}>
            {wf.warningReason || suggestion}
          </p>

          <div className="doc-panel-acts">
            {!vault && wf.mustReviewFirst && (
              <Btn sm onClick={() => onReviewFields?.(doc)} disabled={busy}>Review &amp; confirm</Btn>
            )}
            {!vault && wf.canShowCreatePayable && !dl && (
              <Btn sm onClick={() => onCreate(doc, 'payable')} disabled={busy}>Create payable draft</Btn>
            )}
            {!vault && wf.canShowCreateReceivable && !dl && (
              <Btn sm onClick={() => onCreate(doc, 'receivable')} disabled={busy}>Create receivable draft</Btn>
            )}
            {!vault && wf.canShowCreatePayable && !dl && (
              <Btn sm variant="ghost" onClick={() => onLink(doc, 'debt', 'payable')} disabled={busy}>Link to payable</Btn>
            )}
            {!vault && wf.canShowCreateReceivable && !dl && (
              <Btn sm variant="ghost" onClick={() => onLink(doc, 'debt', 'receivable')} disabled={busy}>Link to receivable</Btn>
            )}
            {!vault && wf.canShowLinkTransaction && !tl && (
              <Btn sm variant="ghost" onClick={() => onLink(doc, 'transaction')} disabled={busy}>Link to transaction</Btn>
            )}
            {vault && onReclassify && (
              <Btn sm onClick={() => onReclassify(doc)} disabled={busy}>
                {vault.confirmed ? 'Change classification' : 'Confirm classification'}
              </Btn>
            )}
            {vault && onOpenAccountant && (
              <Btn sm variant="ghost" onClick={onOpenAccountant}>Open in AI Accountant</Btn>
            )}
            {/* Both directions of the Inbox/Vault separation stay reachable from here. */}
            {vault
              ? <Btn sm variant="ghost" onClick={() => onClassify(doc)} disabled={busy}>Move to Evidence Inbox</Btn>
              : onMoveToVault && <Btn sm variant="ghost" onClick={() => onMoveToVault(doc)} disabled={busy}>Move to Company Vault</Btn>}
            {!vault && <Btn sm variant="ghost" onClick={() => onClassify(doc)} disabled={busy}>Reclassify</Btn>}
          </div>
        </RpCol>
        </div>
      </RpCols>

      <RpActions>
        <Btn sm variant="ghost" onClick={() => onView(doc)}>View document</Btn>
        {onDownload && <Btn sm variant="ghost" onClick={() => onDownload(doc)}>Download</Btn>}
        {!doc.archived_at && <Btn sm variant="ghost" onClick={() => onArchive(doc)} disabled={busy}>Archive</Btn>}
        <Btn sm variant="ghost" onClick={onClose}>Close</Btn>
        <span className="rp-note rp-note-muted" style={{ marginLeft: 'auto' }}>
          Marking a document reviewed is not stored — review_status is read-only through the API.
        </span>
      </RpActions>
    </ReviewPanel>
  )
}

/* ── Company Vault ─────────────────────────────────────────────────────────
   Permanent company and compliance files. A storage area, not a work queue:
   calmer surface, no bulk selection, no "create record" action, and the only
   open question a row can carry is whether its classification is right.

   Nothing here is moved or hidden. The vault is a VIEW over the same
   /api/documents rows, decided by companyVault.vaultVerdictOf. */

const VAULT_SOURCE_BADGE = {
  confirmed: { label: 'Confirmed', tone: 'success' },
  classified: { label: 'Suggested', tone: 'warning' },
  filename: { label: 'Suggested', tone: 'warning' },
}

export function CompanyVault({
  docs, loading, onView, onDownload, onReclassify, onArchive, onOpenAccountant, onUpload,
  onMoveToInbox, onReview, expandedId = null, renderPanel = null,
}) {
  const [q, setQ] = useState('')
  const [onlyReview, setOnlyReview] = useState(false)

  const shelves = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = docs.filter((d) => {
      const v = vaultVerdictOf(d)
      if (onlyReview && v?.confirmed) return false
      if (!needle) return true
      return [d.file?.file_name, d.document_number, v?.label, v?.docType]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
    return VAULT_SHELVES
      .map((s) => ({ ...s, rows: rows.filter((d) => vaultVerdictOf(d)?.shelf === s.key) }))
      .filter((s) => s.rows.length > 0)
  }, [docs, q, onlyReview])

  const shown = shelves.reduce((n, s) => n + s.rows.length, 0)

  if (loading) return <section className="doc-vault"><LoadingSkeleton rows={4} height={20} /></section>

  return (
    <section className="doc-vault">
      <div className="doc-section-head">
        <div>
          <h2 className="doc-section-title">Company Vault</h2>
          <p className="doc-section-sub">Permanent company and compliance files.</p>
        </div>
        <Btn sm variant="ghost" onClick={onUpload}>Upload document</Btn>
      </div>

      {docs.length > 0 && (
        <div className="doc-vault-bar">
          <input type="search" className="doc-vault-search" value={q} placeholder="Search company files…"
            onChange={(e) => setQ(e.target.value)} aria-label="Search company files" />
          <label className="doc-vault-toggle">
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Needs classification review
          </label>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="doc-vault-empty">
          <p className="doc-empty-title">No company documents yet</p>
          <p className="doc-note">
            NIB, NPWP, BPJS, OSS licences, akta and company certificates land here instead of the
            work queue. Upload one, or classify an existing document as a company document.
          </p>
        </div>
      ) : shown === 0 ? (
        <div className="doc-vault-empty">
          <p className="doc-empty-title">No company files match</p>
          <Btn sm variant="ghost" onClick={() => { setQ(''); setOnlyReview(false) }}>Clear</Btn>
        </div>
      ) : shelves.map((s) => (
        <div key={s.key}>
          <GroupHeader label={s.label} count={s.rows.length} />
          <div className="doc-rows">
            {s.rows.map((d) => {
              const v = vaultVerdictOf(d)
              const badge = VAULT_SOURCE_BADGE[v.source]
              const linked = isLinked(d)
              const more = [
                { label: 'View document', onClick: () => onView(d) },
                { label: 'Download', onClick: () => onDownload(d) },
                { label: 'Open in AI Accountant', onClick: onOpenAccountant },
                { label: v.confirmed ? 'Change classification' : 'Reclassify', onClick: () => onReclassify(d) },
                { label: 'Move to Evidence Inbox', onClick: () => onMoveToInbox(d) },
                !d.archived_at && { label: 'Archive', onClick: () => onArchive(d) },
              ]
              const isOpen = expandedId === d.id
              return (
                <div key={d.id} className="doc-rowgroup">
                <article className={`doc-row doc-vrow${v.confirmed ? '' : ' is-suggested'}${isOpen ? ' is-rp-open' : ''}`}>
                  <div className="doc-row-main"
                    role={onReview ? 'button' : undefined} tabIndex={onReview ? 0 : undefined}
                    aria-expanded={onReview ? isOpen : undefined}
                    onClick={onReview ? () => onReview(d) : undefined}
                    onKeyDown={onReview ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReview(d) } } : undefined}>
                    <div className="doc-row-head">
                      <span className="doc-row-type">{v.label}</span>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                      {channelOf(d) && <span className="doc-tag">{channelOf(d)}</span>}
                      {d.archived_at && <span className="doc-tag">Archived</span>}
                    </div>
                    <span className="doc-row-name">{d.file?.file_name || d.document_number || 'Untitled document'}</span>
                    <div className="doc-row-meta">
                      <span>{shelfLabel(v.shelf)}</span>
                      <span>Uploaded {fmtDate(d.created_at) || '—'}</span>
                    </div>
                    {!v.confirmed && (
                      <span className="doc-vrow-note">
                        {v.note}
                        {v.source === 'filename' && ' · matched on the file name, nothing was saved'}
                      </span>
                    )}
                    {linked && (
                      <span className="doc-row-gap">
                        Linked to a financial record — a company document is not evidence for one.
                      </span>
                    )}
                  </div>
                  <div className="doc-row-actions">
                    <Btn sm onClick={() => (onReview ? onReview(d) : onView(d))}>
                      {onReview ? 'Review' : 'View'}
                    </Btn>
                    <MoreMenu items={more} />
                  </div>
                </article>
                {isOpen && renderPanel?.(d)}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <p className="doc-note doc-note-muted">
        Company documents are separated by classification, not moved — every file is still in
        the same document store and nothing here is deleted. Confirming a type saves it, so the
        document stays out of the work queue.
      </p>
    </section>
  )
}

/* ── reclassify drawer — real: PATCH /ai-accountant/documents/:id/classification
       persists the intake type and marks it manually confirmed ─────────────── */

export function VaultReclassifyDrawer({ doc, busy, error, onPick, onClose, inline = false }) {
  if (!doc) return null
  const v = vaultVerdictOf(doc)
  if (inline) {
    return (
      <ReviewPanel eyebrow={doc.file?.file_name || 'Document'} title="Classify company document"
        sub={v?.confirmed
          ? `Currently confirmed as ${v.label}.`
          : `Currently ${v ? `suggested as ${v.label}` : 'unclassified'}. Confirming saves the type, so this document stays out of the Evidence Inbox.`}
        onClose={onClose}>
        {error && <p className="rp-note rp-note-warn" style={{ marginBottom: 10 }}>{error}</p>}
        <div className="doc-pick-grid">
          {VAULT_TYPES.map((t) => (
            <button key={t} type="button" className="doc-pick"
              disabled={busy || (v?.confirmed && t === v.docType)}
              onClick={() => onPick(t)}>
              <span className="doc-pick-title">{vaultLabel(t)}</span>
              <span className="doc-pick-sub">{t}</span>
            </button>
          ))}
        </div>
        <p className="rp-note rp-note-muted" style={{ marginTop: 12 }}>
          Not a company document? Use “Move to Evidence Inbox” on the row — that gives it an
          accounting type and returns it to the work queue.
        </p>
      </ReviewPanel>
    )
  }
  return (
    <div className="doc-drawer-scrim" onClick={onClose}>
      <aside className="doc-drawer" role="dialog" aria-modal="true" aria-label="Reclassify company document"
        onClick={(e) => e.stopPropagation()}>
        <header className="doc-drawer-head">
          <div>
            <span className="doc-drawer-eyebrow">{doc.file?.file_name || 'Document'}</span>
            <h2 className="doc-drawer-title">Classify company document</h2>
          </div>
          <button type="button" className="doc-drawer-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>
        <p className="doc-note">
          {v?.confirmed
            ? `Currently confirmed as ${v.label}.`
            : `Currently ${v ? `suggested as ${v.label}` : 'unclassified'}. Confirming saves the type, so this document stays out of the Evidence Inbox.`}
        </p>
        {error && <p className="doc-note doc-error">{error}</p>}
        <div className="doc-pick-list">
          {VAULT_TYPES.map((t) => (
            <button key={t} type="button" className="doc-pick"
              disabled={busy || (v?.confirmed && t === v.docType)}
              onClick={() => onPick(t)}>
              <span className="doc-pick-title">{vaultLabel(t)}</span>
              <span className="doc-pick-sub">{t}</span>
            </button>
          ))}
        </div>
        <p className="doc-note doc-note-muted">
          Not a company document? Use “Move to Evidence Inbox” on the row — that gives it an
          accounting type and returns it to the work queue.
        </p>
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
