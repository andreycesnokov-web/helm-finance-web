// Invoice Hub v1 — commercial documents and payment obligations.
//
// WHY THIS IS A HUB AND NOT A LIST: migration 041 (invoices / invoice_line_items /
// invoice_counters) is an explicit, un-applied PROPOSAL, and there are no /api/invoices
// routes. So there is no invoice record to list. Rather than a "coming next" stub, this
// page explains the review-first architecture and connects the parts that DO exist today —
// Receivables, Payables, Documents, Transactions, Payment connections.
//
// DATA HONESTY:
//   • Sales / supplier / overdue / settled counts come from GET /api/debts, which is real,
//     and are labelled as coming FROM Receivables and Payables — never as invoice records.
//   • The review count comes from GET /api/documents when that endpoint is reachable
//     (it is plan-gated and may 403); otherwise the card says so instead of showing 0.
//   • Everything the backend cannot answer renders an explicit readiness state. No metric
//     is estimated, and no count is invented.
import { Card, StatusBadge, Btn, Icon } from '../../shell/ui'
import './Invoices.css'

/* ── summary ──────────────────────────────────────────────────────────────── */

export function InvoiceSummary({ debts, docs, loading, navigate }) {
  const live = debts.filter((d) => d.status !== 'cancelled')
  const sales = live.filter((d) => d.type === 'receivable')
  const supplier = live.filter((d) => d.type === 'payable')
  const overdue = live.filter((d) => d.status === 'overdue')
  // A settled or part-settled obligation had a payment recorded against it. That is the
  // closest honest analogue of "matched" until invoice↔transaction matching exists.
  const settled = live.filter((d) => d.status === 'paid' || d.status === 'partial')

  const cards = [
    { key: 'sales', label: 'Sales invoices', icon: 'down', tone: 'ink',
      value: loading ? null : sales.length, source: 'From receivables',
      body: 'Invoices you issued to customers.', cta: 'View receivables', to: '/business/receivables' },
    { key: 'supplier', label: 'Supplier invoices', icon: 'up', tone: 'ink',
      value: loading ? null : supplier.length, source: 'From payables',
      body: 'Invoices sent to you by suppliers.', cta: 'View payables', to: '/business/payables' },
    { key: 'review', label: 'Needs review', icon: 'doc', tone: 'ink',
      value: docs.available ? docs.needsReview : undefined,
      source: docs.available ? 'Documents awaiting review' : 'Document intake not connected',
      body: 'Uploaded documents waiting for extraction or confirmation.',
      cta: 'Open documents', to: '/business/documents' },
    { key: 'overdue', label: 'Overdue', icon: 'warn', tone: overdue.length ? 'warn' : 'ink',
      value: loading ? null : overdue.length, source: 'Past due date',
      body: 'Invoices or obligations past their due date.', cta: 'Open Radar', to: '/business/radar' },
    { key: 'matched', label: 'Matched / paid', icon: 'check', tone: 'ink',
      value: loading ? null : settled.length, source: 'Settled in receivables & payables',
      body: 'Obligations with a payment recorded against them.',
      cta: 'Open transactions', to: '/business/transactions' },
  ]

  return (
    <div className="inv-summary">
      {cards.map((c) => {
        const C = Icon[c.icon] || Icon.dot
        const unknown = c.value === undefined
        return (
          <article key={c.key} className="inv-sum">
            <header className="inv-sum-top">
              <span className={`inv-sum-ic ${c.tone}`}><C width="16" height="16" aria-hidden="true" /></span>
              <span className="inv-sum-label">{c.label}</span>
            </header>
            <span className={`inv-sum-value${unknown ? ' is-unknown' : ''}`}>
              {unknown ? '—' : c.value === null ? '·' : c.value}
            </span>
            <span className="inv-sum-source">{c.source}</span>
            <p className="inv-sum-body">{c.body}</p>
            <button type="button" className="inv-link" onClick={() => navigate(c.to)}>
              {c.cta}<Icon.chev width="12" height="12" aria-hidden="true" />
            </button>
          </article>
        )
      })}
    </div>
  )
}

/* ── intake ───────────────────────────────────────────────────────────────── */

// `live: false` marks a channel that is designed but not wired yet. Those CTAs route to the
// nearest real page and say what is missing — never a dead link, never a false claim.
const INTAKE = [
  { key: 'upload', icon: 'cloud', title: 'Upload invoice', live: true,
    body: 'Upload a PDF, photo or document. AI extracts the details before review.',
    cta: 'Upload document', to: '/business/documents' },
  { key: 'telegram', icon: 'phone', title: 'Send via Telegram', live: false,
    tag: 'Planned flow',
    body: 'Forward invoices to the CFO AI Telegram bot. They arrive as drafts for review, never straight into your books.',
    cta: 'See the flow', to: null },
  { key: 'manual', icon: 'doc', title: 'Create manually', live: false,
    tag: 'Needs invoice records',
    body: 'Draft a sales or supplier invoice by hand. Until invoice records exist, obligations are recorded directly.',
    cta: 'Add a receivable', to: '/business/receivables' },
  { key: 'provider', icon: 'link', title: 'Import from payment provider', live: true,
    body: 'Connect incoming payments so settlements can be matched to what you are owed.',
    cta: 'Payment connections', to: '/business/payment-connections' },
]

export function InvoiceIntake({ navigate, onShowFlow }) {
  return (
    <section className="inv-section">
      <div className="inv-section-head">
        <div>
          <h2 className="inv-section-title">Invoice intake</h2>
          <p className="inv-section-sub">Every way a commercial document can enter the workspace.</p>
        </div>
      </div>
      <div className="inv-intake-grid">
        {INTAKE.map((a) => {
          const C = Icon[a.icon] || Icon.dot
          return (
            <article key={a.key} className={`inv-intake${a.live ? '' : ' is-planned'}`}>
              <header className="inv-intake-top">
                <span className="inv-intake-ic"><C width="17" height="17" aria-hidden="true" /></span>
                {a.tag && <span className="inv-tag">{a.tag}</span>}
              </header>
              <h3 className="inv-intake-title">{a.title}</h3>
              <p className="inv-intake-body">{a.body}</p>
              <button type="button" className="inv-btn"
                onClick={() => (a.to ? navigate(a.to) : onShowFlow())}>
                {a.cta}<Icon.chev width="13" height="13" aria-hidden="true" />
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/* ── review pipeline ──────────────────────────────────────────────────────── */

// The lifecycle, stated once. `state: 'live'` means the step is backed by something that
// exists today; 'planned' means the step is designed but not wired.
const PIPELINE = [
  { key: 'received', label: 'Received', state: 'live', note: 'Document arrives by upload or provider.' },
  { key: 'extracted', label: 'Extracted', state: 'live', note: 'AI reads the details from the file.' },
  { key: 'review', label: 'Needs review', state: 'live', note: 'You or your accountant confirm what was read.' },
  { key: 'confirmed', label: 'Confirmed invoice', state: 'planned', note: 'Becomes a sales or supplier invoice.' },
  { key: 'obligation', label: 'Receivable / payable', state: 'live', note: 'The obligation enters working capital.' },
  { key: 'matched', label: 'Matched to payment', state: 'planned', note: 'Linked to the transaction that settled it.' },
  { key: 'closed', label: 'Closed', state: 'live', note: 'Nothing outstanding remains.' },
]

export function ReviewPipeline() {
  return (
    <section className="inv-section">
      <div className="inv-section-head">
        <div>
          <h2 className="inv-section-title">Review pipeline</h2>
          <p className="inv-section-sub">
            Invoices do not affect financial reports until they are confirmed.
          </p>
        </div>
        <StatusBadge tone="neutral">Review-first</StatusBadge>
      </div>
      <ol className="inv-pipe">
        {PIPELINE.map((s, i) => (
          <li key={s.key} className={`inv-pipe-step is-${s.state}`}>
            <span className="inv-pipe-dot" aria-hidden="true">{i + 1}</span>
            <span className="inv-pipe-label">{s.label}</span>
            <span className="inv-pipe-note">{s.note}</span>
            {s.state === 'planned' && <span className="inv-pipe-tag">Planned</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ── work queues ──────────────────────────────────────────────────────────── */

const QUEUES = [
  { key: 'drafts', label: 'Drafts',
    body: 'Invoices saved but not yet issued will appear here.',
    unlock: 'Needs invoice records', to: null, toLabel: null },
  { key: 'review', label: 'Needs review',
    body: 'Uploaded invoices from Documents or Telegram appear here after extraction.',
    unlock: 'Lives in Documents today', to: '/business/documents', toLabel: 'Open documents' },
  { key: 'sales', label: 'Sales invoices',
    body: 'Confirmed customer invoices will appear here. Customer obligations are tracked in Receivables today.',
    unlock: 'Lives in Receivables today', to: '/business/receivables', toLabel: 'View receivables' },
  { key: 'supplier', label: 'Supplier invoices',
    body: 'Confirmed supplier invoices will appear here. Supplier obligations are tracked in Payables today.',
    unlock: 'Lives in Payables today', to: '/business/payables', toLabel: 'View payables' },
  { key: 'overdue', label: 'Overdue',
    body: 'Invoices past their due date, ranked by how late they are.',
    unlock: 'Lives in Radar today', to: '/business/radar', toLabel: 'Open Radar' },
  { key: 'matched', label: 'Matched / paid',
    body: 'Invoices matched with bank transactions or incoming payments will appear here.',
    unlock: 'Needs payment matching', to: '/business/transactions', toLabel: 'Open transactions' },
]

export function WorkQueues({ active, onSelect, navigate }) {
  const q = QUEUES.find((x) => x.key === active) || QUEUES[0]
  return (
    <section className="inv-section">
      <div className="inv-section-head">
        <div>
          <h2 className="inv-section-title">Work queues</h2>
          <p className="inv-section-sub">
            Where each kind of commercial document will be worked once invoice records exist.
          </p>
        </div>
      </div>
      <div className="inv-tabs" role="tablist" aria-label="Invoice work queues">
        {QUEUES.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === active}
            className={`inv-tab${t.key === active ? ' is-active' : ''}`}
            onClick={() => onSelect(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="inv-queue" role="tabpanel">
        <span className="inv-queue-ic"><Icon.doc width="19" height="19" aria-hidden="true" /></span>
        <div className="inv-queue-text">
          <h3 className="inv-queue-title">{q.label}</h3>
          <p className="inv-queue-body">{q.body}</p>
          <span className="inv-tag">{q.unlock}</span>
        </div>
        {q.to && (
          <Btn sm variant="ghost" onClick={() => navigate(q.to)}>{q.toLabel}</Btn>
        )}
      </div>
    </section>
  )
}

/* ── telegram flow ────────────────────────────────────────────────────────── */

const TG_FLOW = ['Telegram upload', 'Document intake', 'AI extraction', 'Review',
  'Invoice', 'Receivable / payable', 'Transaction match']

export function TelegramFlow() {
  return (
    <Card title="Invoices sent through Telegram"
      action={<StatusBadge tone="neutral">Planned flow</StatusBadge>}>
      <p className="inv-note">
        When an invoice is sent through Telegram it should first enter Document Intake. AI
        extracts the details, then you or your accountant confirms them. Only after
        confirmation does it become a sales or supplier invoice.
        {' '}<strong>Uploaded invoices are reviewed before they affect your books.</strong>
      </p>
      <ol className="inv-flow">
        {TG_FLOW.map((step, i) => (
          <li key={step} className="inv-flow-step">
            <span className="inv-flow-n" aria-hidden="true">{i + 1}</span>{step}
          </li>
        ))}
      </ol>
      <p className="inv-note inv-note-muted">
        Telegram invoice intake is not wired yet. Documents uploaded in the workspace already
        follow this review-first path.
      </p>
    </Card>
  )
}

/* ── architecture impact ──────────────────────────────────────────────────── */

const IMPACT = [
  { key: 'cash', icon: 'pulse', title: 'Cash forecast',
    body: 'Confirmed sales and supplier invoices sharpen the expected cash position.' },
  { key: 'wc', icon: 'transfer', title: 'Working capital',
    body: 'Sales invoices feed Receivables. Supplier invoices feed Payables.' },
  { key: 'radar', icon: 'radar', title: 'Radar',
    body: 'Overdue and upcoming invoices raise risk signals.' },
  { key: 'acct', icon: 'acct', title: 'AI Accountant',
    body: 'Invoice details help prepare accounting and tax review packages.' },
]

export function InvoiceImpact() {
  return (
    <section className="inv-section">
      <div className="inv-section-head">
        <div>
          <h2 className="inv-section-title">How invoices affect your finance system</h2>
          <p className="inv-section-sub">
            An invoice is evidence of an obligation. Confirming it is what lets the rest of the
            product reason about your cash.
          </p>
        </div>
      </div>
      <div className="inv-impact-grid">
        {IMPACT.map((m) => {
          const C = Icon[m.icon] || Icon.dot
          return (
            <article key={m.key} className="inv-impact">
              <span className="inv-impact-ic"><C width="16" height="16" aria-hidden="true" /></span>
              <h3 className="inv-impact-title">{m.title}</h3>
              <p className="inv-impact-body">{m.body}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
