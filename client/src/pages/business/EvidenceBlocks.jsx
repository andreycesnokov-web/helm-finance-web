// Evidence / invoice-requirement UX.
//
// WHAT IS REAL vs WHAT IS NOT — this file is careful about the difference:
//
//   DEBTS (receivables / payables)  — REAL signal. `/api/debts` does select('*'), and
//     migration 019 put an `attachments` JSONB array on debts (plus the legacy single
//     `attachment_url`). So "does this obligation have evidence attached?" is answerable
//     today, and the badge on each row is a fact, not a guess.
//
//   TRANSACTIONS — NO signal. `/api/transactions` returns only
//     id, type, amount_original, currency_original, wallet_id, category, description,
//     transaction_date, source, created_at. `document_transaction_links` exists in the
//     schema (031) but nothing exposes it in bulk. So this file never claims a transaction
//     has or lacks evidence. It states the POLICY for that transaction type — what evidence
//     is normally expected — which is derived from the type the API does return.
//
//   EXCEPTIONS ("no invoice, here is why") — NOT PERSISTABLE. There is no
//     no_invoice_reason / evidence_status / accountant_review_status column anywhere, and
//     no route to write one. So no form here pretends to save an explanation. The capability
//     is shown as a documented, tagged gap instead.
import { Card, StatusBadge, Btn, Icon } from '../../shell/ui'
import './Evidence.css'

/* ── status vocabulary ────────────────────────────────────────────────────── */

// The full target model. `assignable` marks the states the current backend can actually
// support; the rest are shown in the legend so the vocabulary is agreed, but are never
// stamped on a record we cannot verify.
export const EVIDENCE_STATES = [
  { key: 'complete', label: 'Evidence complete', tone: 'ok', assignable: true,
    meaning: 'An invoice, receipt or other document is attached.' },
  { key: 'needed', label: 'Invoice needed', tone: 'warn', assignable: true,
    meaning: 'This normally requires an invoice or supporting document.' },
  { key: 'explain', label: 'Explanation needed', tone: 'warn', assignable: false,
    meaning: 'May not need an invoice, but what it is must be explained.' },
  { key: 'exception', label: 'No invoice — explained', tone: 'info', assignable: false,
    meaning: 'No invoice exists, and a reason has been recorded.' },
  { key: 'review', label: 'Needs review', tone: 'info', assignable: false,
    meaning: 'Evidence or explanation exists; an accountant should confirm it.' },
  { key: 'missing', label: 'Evidence missing', tone: 'danger', assignable: false,
    meaning: 'No document and no explanation.' },
]

const TONE_BADGE = { ok: 'success', warn: 'warning', info: 'info', danger: 'danger', neutral: 'neutral' }

/**
 * Evidence status for a debt — from data that genuinely exists.
 *
 * Only two states can be proven today: attached or not. We deliberately do NOT infer
 * "explained" or "missing", because distinguishing them needs a reason field the schema
 * does not have; guessing would put a wrong status on a real financial record.
 */
export function evidenceOfDebt(debt) {
  const list = Array.isArray(debt?.attachments) ? debt.attachments : []
  const hasDoc = list.length > 0 || !!debt?.attachment_url
  return hasDoc ? 'complete' : 'needed'
}

export function EvidenceBadge({ state, sm }) {
  const def = EVIDENCE_STATES.find((s) => s.key === state) || EVIDENCE_STATES[1]
  return (
    <span className={`ev-badge ev-badge--${def.tone}${sm ? ' is-sm' : ''}`}>
      {def.tone === 'ok'
        ? <Icon.check width="11" height="11" aria-hidden="true" />
        : <Icon.doc width="11" height="11" aria-hidden="true" />}
      {def.label}
    </span>
  )
}

/* ── receivables / payables panel ─────────────────────────────────────────── */

export function DebtEvidencePanel({ debts, kind, navigate }) {
  const withDoc = debts.filter((d) => evidenceOfDebt(d) === 'complete').length
  const without = debts.length - withDoc
  const isPayable = kind === 'payable'
  const pct = debts.length ? Math.round((withDoc / debts.length) * 100) : 0

  return (
    <Card title="Evidence readiness"
      action={<StatusBadge tone={without ? 'warning' : 'success'}>
        {withDoc} of {debts.length} documented
      </StatusBadge>}>
      <p className="ev-note">
        {isPayable
          ? 'This payable is money your business owes. Add the supplier invoice, receipt or contract before it is used in accounting reports.'
          : 'This receivable is money expected from a customer. Add the invoice, contract or agreement that proves why the customer owes this amount.'}
      </p>
      <div className="ev-meter">
        <span className="ev-meter-bar"><span className="ev-meter-fill" style={{ width: `${pct}%` }} /></span>
        <span className="ev-meter-label">{pct}% have a document attached</span>
      </div>
      {without > 0 && (
        <div className="ev-callout">
          <span className="ev-callout-ic"><Icon.doc width="16" height="16" aria-hidden="true" /></span>
          <div className="ev-callout-text">
            <strong>{without} {without === 1 ? 'record needs' : 'records need'} evidence</strong>
            <span>
              {isPayable ? 'Supplier invoice or evidence needed' : 'Invoice or agreement needed'} before
              {' '}{without === 1 ? 'it counts' : 'they count'} as accounting-ready.
            </span>
          </div>
          <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Upload document</Btn>
        </div>
      )}
      <p className="ev-note ev-note-muted">
        Upload the invoice, receipt or supporting document, then connect it during review.
        Recording a “no invoice, here is why” exception is not available yet — see Invoices
        for what that unlocks.
      </p>
    </Card>
  )
}

/* ── transaction evidence policy ──────────────────────────────────────────── */

// What evidence a transaction type normally needs. This is POLICY derived from the `type`
// the API returns — never a claim about whether a document is actually attached.
const TX_POLICY = {
  income: { need: 'invoice', label: 'Invoice or contract normally expected' },
  expense: { need: 'invoice', label: 'Receipt or supplier invoice normally expected' },
  payroll: { need: 'explain', label: 'No invoice — payroll record and explanation expected' },
  transfer: { need: 'explain', label: 'Internal movement — no invoice, explanation expected' },
  correction: { need: 'explain', label: 'Adjustment — explanation expected' },
  bank_fee: { need: 'explain', label: 'Bank fee — statement line, no invoice' },
  fx_fee: { need: 'explain', label: 'FX fee — statement line, no invoice' },
  network_fee: { need: 'explain', label: 'Network fee — statement line, no invoice' },
  owner_injection: { need: 'explain', label: 'Owner contribution — agreement or note expected' },
  owner_withdrawal: { need: 'explain', label: 'Owner withdrawal — agreement or note expected' },
  funding_in: { need: 'invoice', label: 'Funding — agreement expected' },
  funding_out: { need: 'invoice', label: 'Funding — agreement expected' },
}
const DEFAULT_POLICY = { need: 'explain', label: 'Evidence or explanation expected' }

export const txPolicy = (type) => TX_POLICY[type] || DEFAULT_POLICY

export function TxPolicyChip({ type }) {
  const p = txPolicy(type)
  return <span className={`ev-chip ev-chip--${p.need}`}>{p.need === 'invoice' ? 'Invoice expected' : 'Explanation expected'}</span>
}

export function TransactionEvidencePanel({ navigate }) {
  return (
    <Card title="Evidence policy"
      action={<StatusBadge tone="neutral">Review-first</StatusBadge>}>
      <p className="ev-note">
        Every receivable, payable or transaction should have evidence. If there is no invoice,
        explain why — so your accountant can rely on the books.
      </p>
      <ul className="ev-policy">
        <li>
          <span className="ev-chip ev-chip--invoice">Invoice expected</span>
          <span>Supplier payments, rent, equipment, services, inventory and marketing normally
            have a receipt or supplier invoice.</span>
        </li>
        <li>
          <span className="ev-chip ev-chip--explain">Explanation expected</span>
          <span>Bank and FX fees, payroll, tax, internal transfers, owner contributions and cash
            withdrawals often have no invoice — they still need a purpose and a category.</span>
        </li>
      </ul>
      <div className="ev-callout ev-callout--plain">
        <span className="ev-callout-ic"><Icon.warn width="16" height="16" aria-hidden="true" /></span>
        <div className="ev-callout-text">
          <strong>Per-transaction evidence status is not readable yet</strong>
          <span>
            Documents can already be linked to a transaction in the data model, but the
            transactions API does not return that link, so this page shows what each type
            normally needs rather than what each row actually has.
          </span>
        </div>
        <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Open documents</Btn>
      </div>
    </Card>
  )
}

/* ── invoices hub: evidence readiness ─────────────────────────────────────── */

export function EvidenceReadiness({ debts, loading, navigate }) {
  const live = debts.filter((d) => d.status !== 'cancelled')
  const recMissing = live.filter((d) => d.type === 'receivable' && evidenceOfDebt(d) === 'needed').length
  const payMissing = live.filter((d) => d.type === 'payable' && evidenceOfDebt(d) === 'needed').length

  const cards = [
    { key: 'rec', label: 'Receivables missing invoice', value: loading ? null : recMissing,
      source: 'From attachments on receivables', cta: 'View receivables', to: '/business/receivables' },
    { key: 'pay', label: 'Payables missing invoice', value: loading ? null : payMissing,
      source: 'From attachments on payables', cta: 'View payables', to: '/business/payables' },
    { key: 'tx', label: 'Transactions missing evidence', value: undefined,
      source: 'Requires evidence-status backend support', cta: 'Open transactions', to: '/business/transactions' },
    { key: 'exc', label: 'No-invoice explanations pending review', value: undefined,
      source: 'Requires evidence-status backend support', cta: 'Open documents', to: '/business/documents' },
  ]

  return (
    <section className="inv-section">
      <div className="inv-section-head">
        <div>
          <h2 className="inv-section-title">Evidence readiness</h2>
          <p className="inv-section-sub">
            Every receivable, payable or transaction should have evidence. If there is no
            invoice, explain why. Confirmed invoices create receivables and payables;
            transactions should be matched to the document that proves them.
          </p>
        </div>
        <StatusBadge tone="neutral">Evidence-first</StatusBadge>
      </div>
      <div className="ev-grid">
        {cards.map((c) => (
          <article key={c.key} className="ev-card">
            <span className="ev-card-label">{c.label}</span>
            <span className={`ev-card-value${c.value === undefined ? ' is-unknown' : ''}`}>
              {c.value === undefined ? '—' : c.value === null ? '·' : c.value}
            </span>
            <span className="ev-card-source">{c.source}</span>
            <button type="button" className="inv-link" onClick={() => navigate(c.to)}>
              {c.cta}<Icon.chev width="12" height="12" aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
      <div className="ev-legend">
        <span className="ev-legend-label">Evidence states</span>
        <ul className="ev-legend-list">
          {EVIDENCE_STATES.map((s) => (
            <li key={s.key}>
              <EvidenceBadge state={s.key} sm />
              <span className="ev-legend-meaning">{s.meaning}</span>
              {!s.assignable && <span className="ev-legend-tag">Needs backend support</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
