// Invoice Settlement V1 — what is owed, what has been paid, what remains, and
// whether this invoice may be closed.
//
// WHAT THIS PAGE NEVER DOES:
//   * pay anything, or contact a bank;
//   * close an invoice on its own — Close stays disabled until money, documents and
//     accountant review are all satisfied, and the reasons are listed on screen;
//   * invent a number. A missing invoice total shows "Needs review", never zero.
//
// The money path is the existing payment flow; this page records which transaction and
// which payment proof settled which invoice, and reports the remaining balance.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { PageHeader, Card, Btn, StatusBadge, Icon } from '../../shell/ui'
import './InvoiceSettlement.css'

const money = (n, ccy = 'IDR') =>
  n === null || n === undefined ? '—' : `${ccy} ${Number(n).toLocaleString('de-DE')}`

const STATUS_TONE = {
  unpaid: 'neutral', partially_paid: 'warning', paid: 'success',
  overpaid: 'danger', needs_review: 'warning',
}
const STATUS_LABEL = {
  unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Fully paid',
  overpaid: 'Overpaid — needs review', needs_review: 'Needs review',
}

export default function InvoiceSettlement() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [debts, setDebts] = useState([])
  const [selected, setSelected] = useState(null)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!token) return
    let on = true
    apiFetch('/debts', token)
      .then((r) => {
        if (!on) return
        const list = (Array.isArray(r) ? r : r.debts || [])
          .filter((d) => !['cancelled'].includes(d.status))
        setDebts(list)
      })
      .catch((e) => on && setErr(e.message || 'Could not load invoices'))
    return () => { on = false }
  }, [token])

  const load = useCallback(async (debtId) => {
    setBusy(true); setErr(null); setData(null); setSelected(debtId)
    try { setData(await apiFetch(`/invoices/${debtId}/settlement`, token)) }
    catch (e) { setErr(e.message || 'Could not load settlement') }
    finally { setBusy(false) }
  }, [token])

  const head = (
    <PageHeader eyebrow="Business Workspace" title="Invoice settlement"
      actions={<>
        <StatusBadge tone="neutral">Review-first</StatusBadge>
        <Btn sm variant="ghost" onClick={() => navigate('/business/payables')}>Payables</Btn>
      </>} />
  )

  const s = data?.settlement
  const c = data?.closeout

  return <>{head}
    <p className="is-note">
      <Icon.warn width="15" height="15" aria-hidden="true" />
      Settlement is measured against the invoice total including tax. CFO AI does not pay
      invoices and does not close them automatically — closing stays your decision.
    </p>

    <div className="is-grid">
      <Card title="Invoices">
        {debts.length === 0 && <p className="is-empty">No open invoices in this workspace.</p>}
        <ul className="is-list">
          {debts.map((d) => (
            <li key={d.id}>
              <button type="button"
                className={`is-item${selected === d.id ? ' is-on' : ''}`}
                onClick={() => load(d.id)}>
                <span className="is-item-top">
                  <span className="is-item-cp">{d.counterparty || 'Unnamed'}</span>
                  <span className="is-item-amt">{money(d.original_amount ?? d.amount, d.currency)}</span>
                </span>
                <span className="is-item-sub">
                  {d.type === 'payable' ? 'Payable' : 'Receivable'}
                  {d.description ? ` · ${String(d.description).slice(0, 46)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {busy && <Card title="Loading"><p className="is-empty">Loading settlement…</p></Card>}
      {err && !busy && <Card title="Settlement"><p className="is-err">{err}</p></Card>}

      {data && s && !busy && (
        <Card title="Settlement">
          <div className="is-head">
            <div>
              <span className="is-eyebrow">
                {data.invoice.type === 'payable' ? 'Payable' : 'Receivable'}
                {data.invoice.document_number ? ` · ${data.invoice.document_number}` : ''}
              </span>
              <h3 className="is-title">{data.invoice.counterparty}</h3>
              {data.invoice.description && <p className="is-sub">{data.invoice.description}</p>}
            </div>
            <StatusBadge tone={STATUS_TONE[s.status] || 'neutral'}>
              {STATUS_LABEL[s.status] || s.status}
            </StatusBadge>
          </div>

          {/* ── the balance: the decision on this page ──────────────────── */}
          <section className="is-sec">
            <div className="is-row"><span>Invoice total</span>
              <span className="is-mono">{money(s.invoice_total, data.invoice.currency)}</span></div>
            <div className="is-row"><span>Paid</span>
              <span className="is-mono is-pos">{money(s.paid_amount, data.invoice.currency)}</span></div>
            <div className="is-row is-row-strong"><span>Remaining</span>
              <span className="is-mono">{money(s.remaining_amount, data.invoice.currency)}</span></div>
            {s.over_paid_amount > 0 && (
              <p className="is-warn">Overpaid by {money(s.over_paid_amount, data.invoice.currency)}.</p>
            )}
            {s.payment_count > 0 && (
              <p className="is-hint">{s.payment_count} payment{s.payment_count === 1 ? '' : 's'} recorded.</p>
            )}
          </section>

          {/* Base-only context. Explicitly not the closeout target. */}
          {s.base_view && (
            <section className="is-sec is-context">
              <span className="is-label">Base amount context</span>
              <div className="is-row"><span>Base amount (DPP)</span>
                <span className="is-mono">{money(s.base_view.base_amount, data.invoice.currency)}</span></div>
              <div className="is-row"><span>Base remaining</span>
                <span className="is-mono">{money(s.base_view.base_remaining, data.invoice.currency)}</span></div>
              <p className="is-hint">{s.base_view.note}</p>
            </section>
          )}

          {/* ── documents ──────────────────────────────────────────────── */}
          <section className="is-sec">
            <span className="is-label">Linked documents</span>
            <ul className="is-checks">
              {(c?.checklist || []).map((d) => (
                <li key={d.key} className={d.present ? 'is-ok' : d.required ? 'is-missing' : ''}>
                  <span aria-hidden="true">{d.present ? '✓' : '□'}</span>
                  {d.label}
                  {!d.required && !d.present && <em> optional</em>}
                </li>
              ))}
            </ul>
          </section>

          {/* ── closeout ───────────────────────────────────────────────── */}
          <section className="is-sec">
            <span className="is-label">Closeout</span>
            <p className="is-state">{c?.state}</p>
            {!c?.can_close && (c?.blockers || []).length > 0 && (
              <ul className="is-blockers">
                {c.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
            <div className="is-actions">
              <Btn sm variant="ghost" onClick={() => navigate('/business/payables')}>Record a payment</Btn>
              <Btn sm variant="ghost" onClick={() => navigate('/business/documents')}>Link a document</Btn>
              <Btn sm variant="ghost" onClick={() => navigate('/business/accountant')}>Request accountant review</Btn>
              <Btn sm disabled={!c?.can_close}
                title={c?.can_close ? 'All closeout conditions are met' : (c?.blockers || [])[0]}>
                Close invoice
              </Btn>
            </div>
            {!c?.can_close && (
              <p className="is-hint">
                Close stays disabled until the balance is settled, the required documents are
                attached and the accountant has confirmed.
              </p>
            )}
          </section>

          {data.allocations && !data.allocations.matches_paid_amount && (
            <p className="is-warn">
              Recorded allocations ({money(data.allocations.total, data.invoice.currency)}) do not
              match the paid amount on this invoice. The payment is real; the audit trail is
              incomplete. Link each payment to its proof.
            </p>
          )}
        </Card>
      )}
    </div>
  </>
}
