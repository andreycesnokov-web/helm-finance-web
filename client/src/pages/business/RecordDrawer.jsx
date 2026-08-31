// Payable / Receivable detail drawer — the record as a financial object, not a table row.
//
// WHAT THE BACKEND ALREADY SUPPORTS (verified, no new routes):
//   • GET  /api/documents?debt_id=<id>      → the evidence linked to THIS record
//   • POST /api/documents/upload-complete   → accepts `link: { target_type, target_id }`,
//     so uploading evidence FOR a specific payable is one real call, not a global upload
//     the user then has to find again. `uploadDocument(token, file, meta, link)` already
//     threads it through.
//   • POST /api/documents/:id/links         → link an existing document to this debt
//   • PATCH /api/debts/:id                  → edit (real edit mode needs a real id)
//   • POST /api/debts/:id/pay               → records a payment AND creates the transaction,
//     storing linked_transaction_id
//
// WHAT DOES NOT EXIST: a route to attach an ALREADY-EXISTING transaction to a debt. Paying
// through the app is what creates that link. So "match an existing transaction" is shown as
// a readiness state and never faked. There is also no debt audit-log route, so activity
// history says so rather than inventing events.
import { useMemo, useState } from 'react'
import { StatusBadge, Btn, Icon, LoadingSkeleton } from '../../shell/ui'
import './RecordDrawer.css'

const money = (n, ccy = 'IDR') => `${ccy} ${Number(n || 0).toLocaleString('de-DE')}`
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

/** Evidence state for a debt — real signal only (attachments JSONB + linked documents). */
export function evidenceState(debt, linkedDocs) {
  const inline = Array.isArray(debt?.attachments) ? debt.attachments.length : 0
  const n = (linkedDocs?.length || 0) + inline + (debt?.attachment_url ? 1 : 0)
  return { count: n, complete: n > 0 }
}

const STATUS_TONE = (s) => (s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'partial' ? 'warning' : 'neutral')

export default function RecordDrawer({
  debt, kind, open, onClose, docs, docsLoading, busy, error,
  onEdit, onUpload, onLinkDoc, onViewDoc, onPay, onOpenDocuments, focus,
}) {
  if (!open || !debt) return null
  const isPayable = kind === 'payable'
  const ev = evidenceState(debt, docs)
  const remaining = Number(debt.remaining_amount ?? debt.amount ?? 0)
  const paid = Number(debt.paid_amount || 0)
  const settled = debt.status === 'paid'

  // Readiness is a transparent checklist over real fields — never a score.
  const checks = [
    { k: 'evidence', label: 'Evidence attached', ok: ev.complete,
      miss: 'No document linked to this record yet.' },
    { k: 'fields', label: 'Amount, date and counterparty complete',
      ok: !!(debt.counterparty && debt.due_date && Number(debt.original_amount ?? debt.amount)),
      miss: 'Some details are still missing.' },
    { k: 'payment', label: 'Payment recorded', ok: paid > 0,
      miss: 'No payment has been recorded against this record.' },
  ]

  return (
    <div className="rec-scrim" onClick={onClose}>
      <aside className="rec-drawer" role="dialog" aria-modal="true"
        aria-label={isPayable ? 'Payable details' : 'Receivable details'}
        onClick={(e) => e.stopPropagation()}>

        <header className="rec-head">
          <div className="rec-head-main">
            <span className="rec-eyebrow">{isPayable ? 'Payable details' : 'Receivable details'}</span>
            <h2 className="rec-title">{debt.counterparty || debt.description || 'Record'}</h2>
            <p className="rec-sub">
              {isPayable ? 'Money your business needs to pay.' : 'Money owed to your business.'}
            </p>
          </div>
          <button type="button" className="rec-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>

        <div className="rec-chips">
          <StatusBadge tone={STATUS_TONE(debt.status)}>
            {debt.status}{debt.days_overdue > 0 ? ` · ${debt.days_overdue}d` : ''}
          </StatusBadge>
          <StatusBadge tone={ev.complete ? 'success' : 'warning'}>
            {ev.complete ? 'Evidence complete' : 'Invoice needed'}
          </StatusBadge>
          <span className="rec-amount">{money(remaining, debt.currency)}</span>
        </div>

        {settled && !ev.complete && (
          <p className="rec-note rec-note-warn">
            This record is paid, but still needs evidence. Paid does not mean accounting-ready.
          </p>
        )}
        {error && <p className="rec-note rec-note-warn">{error}</p>}

        {/* 1 — summary */}
        <section className="rec-sec">
          <span className="rec-label">Summary</span>
          {[
            ['Counterparty', debt.counterparty],
            ['Amount', money(debt.original_amount ?? debt.amount, debt.currency)],
            ['Currency', debt.currency || 'IDR'],
            ['Due date', fmtDate(debt.due_date)],
            ['Status', debt.status],
            ['Paid', money(paid, debt.currency)],
            ['Remaining', money(remaining, debt.currency)],
            ['Description', debt.description],
          ].map(([k, v]) => (
            <div className="rec-kv" key={k}>
              <span>{k}</span><span>{v || <em className="rec-miss">Not set</em>}</span>
            </div>
          ))}
          <Btn sm variant="ghost" onClick={() => onEdit(debt)}>Edit details</Btn>
        </section>

        {/* 2 — evidence */}
        <section className={`rec-sec${focus === 'evidence' ? ' is-focus' : ''}`}>
          <span className="rec-label">Evidence</span>
          <p className="rec-note">
            {isPayable
              ? 'Add the supplier invoice, receipt or contract that proves this obligation.'
              : 'Add the invoice, contract or agreement that proves why the customer owes this amount.'}
          </p>

          {docsLoading ? <LoadingSkeleton rows={2} height={16} /> : (
            <>
              <div className="rec-kv"><span>Linked documents</span><span>{docs?.length ?? 0}</span></div>
              {(docs || []).map((d) => (
                <button key={d.id} type="button" className="rec-doc" onClick={() => onViewDoc(d)}>
                  <span className="rec-doc-ic"><Icon.doc width="14" height="14" aria-hidden="true" /></span>
                  <span className="rec-doc-main">
                    <span className="rec-doc-name">{d.file?.file_name || d.document_number || 'Document'}</span>
                    <span className="rec-doc-sub">
                      {d.document_type || 'untyped'}
                      {d.document_date ? ` · ${fmtDate(d.document_date)}` : ''}
                      {d.gross_amount ? ` · ${money(d.gross_amount, d.currency)}` : ''}
                    </span>
                  </span>
                </button>
              ))}
              {!docs?.length && !ev.complete && (
                <p className="rec-note rec-note-muted">No document is linked to this record yet.</p>
              )}
            </>
          )}

          <div className="rec-actions">
            <Btn sm onClick={() => onUpload(debt)} disabled={busy}>Upload evidence</Btn>
            <Btn sm variant="ghost" onClick={() => onLinkDoc(debt)} disabled={busy}>Link existing document</Btn>
            <Btn sm variant="ghost" onClick={() => onOpenDocuments(debt)}>Open documents</Btn>
          </div>
        </section>

        {/* 3 — payments */}
        <section className="rec-sec">
          <span className="rec-label">Payments</span>
          <div className="rec-kv"><span>Paid</span><span>{money(paid, debt.currency)}</span></div>
          <div className="rec-kv"><span>Remaining</span><span>{money(remaining, debt.currency)}</span></div>
          <div className="rec-kv">
            <span>Linked transaction</span>
            <span>{debt.linked_transaction_id ? `#${debt.linked_transaction_id}` : <em className="rec-miss">None</em>}</span>
          </div>
          <div className="rec-actions">
            {!settled && (
              <Btn sm onClick={() => onPay(debt)} disabled={busy}>
                {isPayable ? 'Pay now' : 'Mark received'}
              </Btn>
            )}
          </div>
          <p className="rec-note rec-note-muted">
            Recording a payment here creates the transaction and links it. Attaching an
            already-existing transaction to this record needs backend support.
          </p>
        </section>

        {/* 4 — readiness */}
        <section className="rec-sec">
          <span className="rec-label">Accounting readiness</span>
          <ul className="rec-checks">
            {checks.map((c) => (
              <li key={c.k} className={c.ok ? 'is-ok' : ''}>
                <span className="rec-check-mark" aria-hidden="true">
                  {c.ok ? <Icon.check width="11" height="11" /> : <Icon.dot width="6" height="6" />}
                </span>
                <span>{c.ok ? c.label : c.miss}</span>
              </li>
            ))}
          </ul>
          <p className="rec-note rec-note-muted">
            Accountant review status is not stored yet — that field is read-only through the API.
          </p>
        </section>

        {/* 5 — activity */}
        <section className="rec-sec">
          <span className="rec-label">Activity</span>
          <p className="rec-note rec-note-muted">Activity history requires audit log support.</p>
        </section>
      </aside>
    </div>
  )
}

/* ── picker for linking an existing document to this record ───────────────── */

export function DocPicker({ open, docs, busy, error, onPick, onClose }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = docs.filter((d) => !d.archived_at)
    if (!t) return base.slice(0, 40)
    return base.filter((d) => JSON.stringify(d).toLowerCase().includes(t)).slice(0, 40)
  }, [q, docs])
  if (!open) return null
  return (
    <div className="rec-scrim" onClick={onClose}>
      <aside className="rec-drawer" role="dialog" aria-modal="true" aria-label="Link existing document"
        onClick={(e) => e.stopPropagation()}>
        <header className="rec-head">
          <div className="rec-head-main">
            <span className="rec-eyebrow">Evidence</span>
            <h2 className="rec-title">Link existing document</h2>
            <p className="rec-sub">Unlinked documents are listed first — pick the one that proves this record.</p>
          </div>
          <button type="button" className="rec-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>
        <input className="rec-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search file name, type or amount" aria-label="Search documents" />
        {error && <p className="rec-note rec-note-warn">{error}</p>}
        <div className="rec-picklist">
          {list.length === 0 && <p className="rec-note rec-note-muted">No documents to choose from.</p>}
          {list.map((d) => (
            <button key={d.id} type="button" className="rec-doc" disabled={busy} onClick={() => onPick(d)}>
              <span className="rec-doc-ic"><Icon.doc width="14" height="14" aria-hidden="true" /></span>
              <span className="rec-doc-main">
                <span className="rec-doc-name">{d.file?.file_name || d.document_number || 'Document'}</span>
                <span className="rec-doc-sub">
                  {d.document_type || 'untyped'}
                  {d.document_date ? ` · ${fmtDate(d.document_date)}` : ''}
                  {d.gross_amount ? ` · ${money(d.gross_amount, d.currency)}` : ''}
                  {(d.links || []).length ? ' · already linked elsewhere' : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
