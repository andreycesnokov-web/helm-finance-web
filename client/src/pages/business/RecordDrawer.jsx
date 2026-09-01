// Payable / Receivable detail drawer — the record as a financial object, not a table row.
//
// WHAT THE BACKEND ALREADY SUPPORTS (verified against server/index.js, no new routes):
//   • GET    /api/documents?debt_id=<id>     → evidence linked to THIS record, each
//     link carrying { link_id, target_type, target_id } (attachLinks, index.js:11863)
//   • POST   /api/documents/upload-complete  → accepts link:{target_type,target_id}
//   • POST   /api/documents/:id/links        → link an existing document
//   • DELETE /api/documents/:id/links/:linkId → REAL unlink. rpc_document_unlink
//     (migration 036) deletes only the link row and writes an 'unlinked' audit event.
//     The file and the document survive — this is unlink, never delete.
//   • PATCH  /api/debts/:id                  → edit
//   • POST   /api/debts/:id/pay              → records payment AND creates the
//     transaction, storing linked_transaction_id
//
// WHAT DOES NOT EXIST, and is therefore shown as readiness-only, never simulated:
//   • Persisting an accounting-ready status (no debts column, no route writes
//     financial_documents.review_status).
//   • Persisting a "no payment proof because…" exception. debts.description is the
//     user's own description — writing an exception into it would corrupt real data.
//   • Attaching an ALREADY-EXISTING transaction. Paying through the app is what
//     creates that link.
//   • Any accountant approval / send-for-review route.
import { useState } from 'react'
import { StatusBadge, Btn, Icon, LoadingSkeleton } from '../../shell/ui'
import {
  compatibilityOf, COMPAT_LABEL, typeLabel, linkIdFor, otherLinksOf,
  duplicateWarning, evidenceOf, isPaid, readyGate, CAPABILITIES, CAPABILITY_NOTE,
} from './evidenceModel'
import './RecordDrawer.css'

const money = (n, ccy = 'IDR') => `${ccy || 'IDR'} ${Number(n || 0).toLocaleString('de-DE')}`
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

/** Evidence state for a debt — real signal only (attachments JSONB + linked documents). */
export function evidenceState(debt, linkedDocs) {
  const ev = evidenceOf(debt, linkedDocs)
  return { count: ev.count, complete: ev.complete }
}

const STATUS_TONE = (s) => (s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'partial' ? 'warning' : 'neutral')
const COMPAT_TONE = { suitable: 'success', caution: 'warning', unsuitable: 'danger' }

/* ── one linked document, with the actions that fix a mistake ───────────────── */
function EvidenceItem({ doc, kind, debtId, busy, onView, onOpenDocuments, onUnlink }) {
  const [confirming, setConfirming] = useState(false)
  const compat = compatibilityOf(doc, kind)
  const linkId = linkIdFor(doc, debtId)
  const alsoLinked = otherLinksOf(doc, debtId).length
  const src = doc.file?.upload_channel

  return (
    <div className={`rec-ev rec-ev--${compat.level}`}>
      <div className="rec-ev-top">
        <span className="rec-ev-ic"><Icon.doc width="14" height="14" aria-hidden="true" /></span>
        <button type="button" className="rec-ev-name" onClick={() => onView(doc)} title="View document">
          {doc.file?.file_name || doc.document_number || 'Document'}
        </button>
        <StatusBadge tone={COMPAT_TONE[compat.level]}>{COMPAT_LABEL[compat.level]}</StatusBadge>
      </div>

      <div className="rec-ev-meta">
        <span>{typeLabel(doc.document_type)}</span>
        {doc.document_date && <span>{fmtDate(doc.document_date)}</span>}
        {doc.gross_amount != null && <span className="rec-mono">{money(doc.gross_amount, doc.currency)}</span>}
        {src && <span>via {src}</span>}
        {alsoLinked > 0 && <span>also linked to {alsoLinked} other record{alsoLinked > 1 ? 's' : ''}</span>}
      </div>

      {compat.reason && <p className="rec-ev-why">{compat.reason}</p>}
      {compat.disagreement && <p className="rec-ev-why rec-ev-why--muted">{compat.disagreement}</p>}

      {!confirming ? (
        <div className="rec-ev-acts">
          <button type="button" className="rec-link" onClick={() => onView(doc)}>View</button>
          <button type="button" className="rec-link" onClick={() => onOpenDocuments(doc)}>Open in Documents</button>
          {linkId ? (
            <button type="button" className="rec-link rec-link--warn" disabled={busy}
              onClick={() => setConfirming(true)}>Unlink from this record</button>
          ) : (
            <span className="rec-ev-nolink" title="This document has no link id for this record">
              Unlink unavailable
            </span>
          )}
        </div>
      ) : (
        <div className="rec-ev-confirm">
          <span>Unlink this document? The file stays in Documents — only the link to this record is removed.</span>
          <div className="rec-ev-acts">
            <Btn sm variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Btn>
            <Btn sm disabled={busy}
              onClick={() => { setConfirming(false); onUnlink(doc, linkId) }}>Unlink</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RecordDrawer({
  debt, kind, open, onClose, docs, docsLoading, busy, error, notice,
  onEdit, onUpload, onLinkDoc, onViewDoc, onPay, onOpenDocuments, onUnlink,
  focus, taxRule = null, rulesError = false,
}) {
  if (!open || !debt) return null
  const isPayable = kind !== 'receivable'
  const ev = evidenceOf(debt, docs)
  const gate = readyGate({ debt, kind, docs, taxRule, rulesError })
  const remaining = Number(debt.remaining_amount ?? debt.amount ?? 0)
  const paid = Number(debt.paid_amount || 0)
  const settled = isPaid(debt)
  const matched = !!debt.linked_transaction_id
  const paymentMissing = settled && !ev.hasPayment && !matched

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
          {/* Obligation and payment are separate proofs — never collapsed into one badge. */}
          <StatusBadge tone={ev.hasObligation ? 'success' : 'warning'}>
            {ev.hasObligation ? (isPayable ? 'Invoice attached' : 'Invoice attached') : 'Invoice needed'}
          </StatusBadge>
          {settled && (
            <StatusBadge tone={ev.hasPayment || matched ? 'success' : 'warning'}>
              {ev.hasPayment ? 'Payment proof attached' : matched ? 'Transaction matched' : 'Payment proof missing'}
            </StatusBadge>
          )}
          <span className="rec-amount">{money(remaining, debt.currency)}</span>
        </div>

        {notice && <p className="rec-note rec-note-ok">{notice}</p>}
        {error && <p className="rec-note rec-note-warn">{error}</p>}

        {paymentMissing && (
          <p className="rec-note rec-note-warn">
            <strong>Paid, but payment proof is missing.</strong> The invoice proves the obligation;
            it does not show the money moved.
          </p>
        )}

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
              ? 'The supplier invoice proves the obligation. A payment proof proves it was paid.'
              : 'The sales invoice proves the customer owes this. A payment proof proves it was received.'}
          </p>

          {docsLoading ? <LoadingSkeleton rows={2} height={16} /> : (
            <>
              {(docs || []).map((d) => (
                <EvidenceItem key={d.id} doc={d} kind={kind} debtId={debt.id} busy={busy}
                  onView={onViewDoc} onOpenDocuments={onOpenDocuments} onUnlink={onUnlink} />
              ))}
              {!docs?.length && (
                <p className="rec-note rec-note-muted">No document is linked to this record yet.</p>
              )}
              {ev.legacyCount > 0 && (
                <p className="rec-note rec-note-muted">
                  {ev.legacyCount} legacy attachment{ev.legacyCount > 1 ? 's' : ''} on this record
                  (added before the Document Center). No document type, so it cannot satisfy a
                  specific evidence requirement.
                </p>
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
            {paymentMissing && (
              <>
                <Btn sm onClick={() => onUpload(debt, 'payment_proof')} disabled={busy}>Upload payment proof</Btn>
                <Btn sm variant="ghost" onClick={() => onLinkDoc(debt, 'payment_proof')} disabled={busy}>Link payment proof</Btn>
              </>
            )}
          </div>
          <p className="rec-note rec-note-muted">{CAPABILITY_NOTE.matchExistingTransaction}</p>
        </section>

        {/* 4 — readiness */}
        <section className="rec-sec">
          <span className="rec-label">Accounting readiness</span>
          <ul className="rec-checks">
            {gate.items.map((c) => (
              <li key={c.key} className={c.ok ? 'is-ok' : c.notRequired ? 'is-na' : ''}>
                <span className="rec-check-mark" aria-hidden="true">
                  {c.ok && !c.notRequired ? <Icon.check width="11" height="11" /> : <Icon.dot width="6" height="6" />}
                </span>
                <span className="rec-check-body">
                  <span>{c.ok ? c.label : c.missing || c.label}</span>
                  {c.note && <span className="rec-check-note">{c.note}</span>}
                  {!c.ok && c.action && (
                    <button type="button" className="rec-link" disabled={busy}
                      onClick={() => {
                        if (c.action.kind === 'edit') onEdit(debt)
                        else if (c.action.kind === 'payment') onUpload(debt, 'payment_proof')
                        else if (c.action.kind === 'evidence') onUpload(debt)
                      }}>
                      {c.action.label}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* The gate. Nothing here writes anything — stated plainly, not implied. */}
          <div className="rec-gate">
            <Btn sm disabled title={gate.ready ? CAPABILITY_NOTE.persistReady : gate.reason}>
              Mark accounting-ready
            </Btn>
            <span className="rec-gate-why">
              {gate.ready ? CAPABILITY_NOTE.persistReady : gate.reason}
            </span>
          </div>
          {!CAPABILITIES.explainException && !gate.ready && (
            <p className="rec-note rec-note-muted">
              Recording an exception (“no payment proof because…”) needs a place to store it.
              {' '}{CAPABILITY_NOTE.explainException}
            </p>
          )}
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

export function DocPicker({ open, docs, busy, error, onPick, onClose, kind, linkedDocs, debtId, prefer }) {
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(null)   // { doc, compat, dup }

  if (!open) return null

  const t = q.trim().toLowerCase()
  const base = (docs || []).filter((d) => !d.archived_at)
  let list = t ? base.filter((d) => JSON.stringify(d).toLowerCase().includes(t)) : base
  // When the caller wants a specific role (payment proof), surface those first.
  if (prefer) {
    list = [...list].sort((a, b) => (b.document_type === prefer) - (a.document_type === prefer))
  }
  list = list.slice(0, 40)

  const review = (doc) => {
    const compat = compatibilityOf(doc, kind)
    const dup = duplicateWarning(doc, linkedDocs || [], debtId)
    // Straight through only when the document is credible and not a duplicate.
    if (compat.level === 'suitable' && !dup) return onPick(doc)
    setConfirm({ doc, compat, dup })
  }

  return (
    <div className="rec-scrim" onClick={onClose}>
      <aside className="rec-drawer" role="dialog" aria-modal="true" aria-label="Link existing document"
        onClick={(e) => e.stopPropagation()}>
        <header className="rec-head">
          <div className="rec-head-main">
            <span className="rec-eyebrow">Evidence</span>
            <h2 className="rec-title">Link existing document</h2>
            <p className="rec-sub">
              {prefer === 'payment_proof'
                ? 'Payment proofs are listed first — pick the one that shows this payment.'
                : 'Pick the document that proves this record.'}
            </p>
          </div>
          <button type="button" className="rec-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>

        {error && <p className="rec-note rec-note-warn">{error}</p>}

        {confirm ? (
          <div className="rec-confirm">
            <h3 className="rec-confirm-title">
              {confirm.dup ? 'Possible duplicate evidence' : 'This document may not support this record'}
            </h3>
            <div className="rec-ev rec-ev--plain">
              <div className="rec-ev-top">
                <span className="rec-ev-ic"><Icon.doc width="14" height="14" aria-hidden="true" /></span>
                <span className="rec-ev-name as-text">
                  {confirm.doc.file?.file_name || confirm.doc.document_number || 'Document'}
                </span>
              </div>
              <div className="rec-ev-meta">
                <span>{typeLabel(confirm.doc.document_type)}</span>
                {confirm.doc.document_date && <span>{fmtDate(confirm.doc.document_date)}</span>}
                {confirm.doc.gross_amount != null &&
                  <span className="rec-mono">{money(confirm.doc.gross_amount, confirm.doc.currency)}</span>}
              </div>
            </div>

            {confirm.dup && (
              <div className="rec-warn-block">
                <p className="rec-warn-lead">This document may already be attached to this record.</p>
                <ul className="rec-reasons">
                  {confirm.dup.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
            {confirm.compat.level !== 'suitable' && (
              <div className="rec-warn-block">
                <p className="rec-warn-lead">
                  {confirm.compat.level === 'unsuitable'
                    ? `This document may not support this ${kind === 'receivable' ? 'receivable' : 'payable'}.`
                    : 'This document may not be sufficient evidence on its own.'}
                </p>
                <ul className="rec-reasons">
                  <li>{confirm.compat.reason}</li>
                  {confirm.compat.disagreement && <li>{confirm.compat.disagreement}</li>}
                </ul>
              </div>
            )}

            <div className="rec-actions">
              <Btn sm variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Btn>
              {confirm.dup?.level === 'blocked' ? (
                <span className="rec-ev-nolink">Already attached — nothing to link.</span>
              ) : (
                <Btn sm onClick={() => { const d = confirm.doc; setConfirm(null); onPick(d) }} disabled={busy}>
                  Link anyway
                </Btn>
              )}
            </div>
            {/* Honest about the missing half: the user may proceed, but the reason
                for proceeding cannot be recorded anywhere yet. */}
            <p className="rec-note rec-note-muted">
              Linking with a written explanation is not available. {CAPABILITY_NOTE.explainException}
            </p>
          </div>
        ) : (
          <>
            <input className="rec-search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search file name, type or amount" aria-label="Search documents" />
            <div className="rec-picklist">
              {list.length === 0 && <p className="rec-note rec-note-muted">No documents to choose from.</p>}
              {list.map((d) => {
                const compat = compatibilityOf(d, kind)
                const already = !!linkIdFor(d, debtId)
                return (
                  <button key={d.id} type="button" className="rec-doc" disabled={busy || already}
                    onClick={() => review(d)}>
                    <span className="rec-doc-ic"><Icon.doc width="14" height="14" aria-hidden="true" /></span>
                    <span className="rec-doc-main">
                      <span className="rec-doc-name">{d.file?.file_name || d.document_number || 'Document'}</span>
                      <span className="rec-doc-sub">
                        {typeLabel(d.document_type)}
                        {d.document_date ? ` · ${fmtDate(d.document_date)}` : ''}
                        {d.gross_amount != null ? ` · ${money(d.gross_amount, d.currency)}` : ''}
                        {already ? ' · already attached here' : ''}
                      </span>
                    </span>
                    <StatusBadge tone={COMPAT_TONE[compat.level]}>{COMPAT_LABEL[compat.level]}</StatusBadge>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
