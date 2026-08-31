// AI Invoice Review — prepare a payable, show the tax logic, let the user confirm.
//
// "AI prepares the payable. You review the tax logic before it affects your books."
//
// ── WHAT IS REAL ─────────────────────────────────────────────────────────────
//   • Every invoice field shown comes from financial_documents (document_type,
//     document_number, document_date, currency, gross_amount, commercial_tax_amount,
//     issuer_counterparty_id).
//   • The tax rule lookup is a real call to GET /api/accountant/rules, which returns
//     active tax_rules for the workspace jurisdiction joined to official_sources.
//   • Creating the payable is POST /api/debts, user-submitted, then linked to the document.
//
// ── WHAT IS DELIBERATELY NOT FAKED ───────────────────────────────────────────
//   • THERE IS NO OCR. `extracted_json` is never written by any API route, so no line
//     items and no service description exist. Service type is therefore either absent or
//     INFERRED from the supplier name — and labelled exactly that way, never as extraction.
//   • The seeded tax_rules cover PPN (monthly) and PPh Badan (annual) only. No withholding
//     rule is seeded, so no rate is asserted. A rate only appears if the rule engine
//     actually returns one, or if the USER types one in Edit calculation — in which case it
//     is labelled a manual override.
//   • `withholding_records` exists in the schema (031) but NO API route touches it, so a
//     tax obligation cannot be stored. That is stated, never simulated.
//   • `debts` has no gross/net/tax columns, so the split is not persisted anywhere. The
//     drawer says so before the user commits.
import { useEffect, useMemo, useState } from 'react'
import { StatusBadge, Btn, Icon } from '../../shell/ui'
import './InvoiceReview.css'

/* ── defensive helpers ────────────────────────────────────────────────────────
   This drawer renders whatever the API happens to return. Every one of these
   degrades to a readable state instead of throwing — a tax page must never be the
   reason the workspace shows a blank screen. */
export const asArray = (v) => (Array.isArray(v) ? v : Array.isArray(v?.rules) ? v.rules : [])
export function safeMoney(n, ccy = 'IDR') {
  const x = Number(n)
  if (!Number.isFinite(x)) return null
  return `${ccy || 'IDR'} ${Math.round(x).toLocaleString('de-DE')}`
}
export function safeDate(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
export const getRuleTitle = (rule) =>
  rule?.official_sources?.title || rule?.title || rule?.rule_code || 'Configured tax rule'

const money = (n, ccy = 'IDR') => safeMoney(n, ccy) ?? `${ccy || 'IDR'} 0`
const fmtDate = (v) => safeDate(v)

/**
 * Service-type guess from the supplier name. This is a HEURISTIC, not extraction — the
 * caller renders it with an explicit "inferred, needs review" label so it can never be
 * mistaken for something the system read off the document.
 */
const SERVICE_HINTS = [
  { re: /paralegal|legal|lawyer|advocat|notar|law\b/i, label: 'Legal / paralegal service', taxHint: 'services' },
  { re: /consult|advisor|audit|account/i, label: 'Professional / consulting service', taxHint: 'services' },
  { re: /rent|lease|sewa/i, label: 'Rent / lease', taxHint: 'rent' },
  { re: /cloud|software|saas|hosting|subscription/i, label: 'Software / subscription', taxHint: 'services' },
  { re: /logistic|freight|courier|shipping/i, label: 'Logistics / freight', taxHint: 'services' },
]
export function inferService(name) {
  if (!name) return null
  const hit = SERVICE_HINTS.find((h) => h.re.test(name))
  return hit ? { label: hit.label, taxHint: hit.taxHint, inferred: true } : null
}

/** A withholding rule from the real engine, if the jurisdiction has one active. */
export function findWithholdingRule(input) {
  const rules = asArray(input)
  if (!rules.length) return null
  const r = rules.find((x) =>
    /withhold/i.test(x.obligation_type || '') || /pph[_ ]?23/i.test(x.rule_code || ''))
  if (!r) return null
  const p = r.parameters || {}
  const rate = Number(p.rate ?? p.percent ?? p.tax_rate)
  return { rule: r, rate: Number.isFinite(rate) && rate > 0 ? rate : null }
}

const Conf = ({ level }) => (
  <span className={`ir-conf ir-conf--${level}`}>
    {level === 'high' ? 'High confidence' : level === 'med' ? 'Inferred — needs review' : 'Needs review'}
  </span>
)

export default function InvoiceReviewDrawer({
  doc, open, cpName, rules, rulesLoading, rulesError, busy, error,
  onClose, onView, onCreate, onLinkExisting,
}) {
  const supplier = cpName?.(doc?.issuer_counterparty_id) || null
  const nameGuess = inferService(supplier || doc?.file?.file_name)
  const engine = useMemo(() => findWithholdingRule(rules), [rules])

  // Local-only calculation state. Nothing here is persisted — stated in the UI.
  const [edit, setEdit] = useState(false)
  const [service, setService] = useState('')
  const [treatment, setTreatment] = useState('review')   // review | none | withhold
  const [rate, setRate] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!doc) return
    setEdit(false); setService(''); setNote('')
    setTreatment(engine?.rate ? 'withhold' : 'review')
    setRate(engine?.rate ? String(engine.rate) : '')
  }, [doc, engine])

  if (!open || !doc) return null

  const gross = Number(doc.gross_amount || 0)
  const ccy = doc.currency || 'IDR'
  const serviceLabel = service || nameGuess?.label || null
  const rateNum = Number(rate)
  const rateValid = treatment === 'withhold' && Number.isFinite(rateNum) && rateNum > 0 && rateNum < 100
  const withheld = rateValid ? Math.round(gross * (rateNum / 100)) : null
  const net = withheld === null ? null : gross - withheld
  const rateSource = engine?.rate && String(engine.rate) === rate ? 'engine' : 'manual'

  // Minimum data required before anything may be created.
  const missing = []
  if (!supplier) missing.push('supplier')
  if (!gross) missing.push('amount')
  if (!ccy) missing.push('currency')
  if (!doc.document_date) missing.push('invoice date')
  if (!doc.document_type) missing.push('document type')

  const state = missing.length ? 'missing'
    : treatment === 'withhold' && rateValid ? 'ready'
      : treatment === 'none' ? 'readyGross' : 'review'

  const primary = {
    missing: { label: 'Complete review first', disabled: true },
    ready: { label: `Create net payable: ${money(net, ccy)}`, amount: net, disabled: false },
    readyGross: { label: `Create gross payable: ${money(gross, ccy)}`, amount: gross, disabled: false },
    review: { label: 'Create draft & send for review', amount: gross, disabled: false },
  }[state]

  const fields = [
    ['Document type', doc.document_type, doc.document_type ? 'high' : 'low'],
    ['Supplier', supplier, supplier ? 'high' : 'low'],
    ['Invoice number', doc.document_number, doc.document_number ? 'high' : 'low'],
    ['Invoice date', fmtDate(doc.document_date), doc.document_date ? 'high' : 'low'],
    ['Currency', ccy, 'high'],
    ['Gross amount', gross ? money(gross, ccy) : null, gross ? 'high' : 'low'],
    ['Service type', serviceLabel, service ? 'high' : (nameGuess ? 'med' : 'low')],
  ]

  return (
    <div className="ir-scrim" onClick={onClose}>
      <aside className="ir-drawer" role="dialog" aria-modal="true" aria-label="Review supplier invoice"
        onClick={(e) => e.stopPropagation()}>

        <header className="ir-head">
          <div>
            <span className="ir-eyebrow">Review supplier invoice</span>
            <h2 className="ir-title">{supplier || doc.file?.file_name || 'Supplier invoice'}</h2>
            <p className="ir-sub">AI prepared a payable suggestion. Review tax before this affects your books.</p>
          </div>
          <button type="button" className="ir-x" onClick={onClose} aria-label="Close">
            <Icon.plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </header>

        <div className="ir-chips">
          <StatusBadge tone="info">AI suggestion · needs confirmation</StatusBadge>
          <span className="ir-gross">{money(gross, ccy)}</span>
          <Btn sm variant="ghost" onClick={() => onView(doc)}>View document</Btn>
        </div>
        {error && <p className="ir-note ir-warn">{error}</p>}

        {/* 1 — AI understanding */}
        <section className="ir-sec">
          <span className="ir-label">AI understanding</span>
          {fields.map(([k, v, conf]) => (
            <div className="ir-kv" key={k}>
              <span>{k}</span>
              <span>{v || <em className="ir-miss">Needs review</em>} <Conf level={conf} /></span>
            </div>
          ))}
          {!service && nameGuess && (
            <p className="ir-note ir-note-muted">
              Service type inferred from the supplier name — not read from the document. There is
              no text extraction behind this yet, so confirm it before relying on the tax logic.
            </p>
          )}
        </section>

        {/* 2 — tax suggestion */}
        <section className="ir-sec">
          <span className="ir-label">Tax suggestion</span>
          {rulesLoading ? <p className="ir-note">Checking the tax rule engine…</p> : rulesError ? (
            <p className="ir-note ir-note-amber">
              Tax rule engine unavailable — accountant review required. Nothing is calculated
              from an engine we could not reach.
            </p>
          ) : engine?.rate ? (
            <>
              <div className="ir-kv"><span>Tax candidate</span><span>{engine.rule.rule_code || engine.rule.title || 'Withholding rule'}</span></div>
              <div className="ir-kv"><span>Suggested rate</span><span>{engine.rate}%</span></div>
              <div className="ir-kv"><span>Source</span><span>{getRuleTitle(engine.rule)}</span></div>
              <p className="ir-note">
                Based on the detected service type this is a likely withholding candidate.
                Accountant confirmation is required before payment.
              </p>
            </>
          ) : (
            <>
              <p className="ir-note ir-note-amber">
                No withholding rule is active for this workspace, so CFO AI does not assert a
                rate. {nameGuess?.taxHint === 'services'
                  ? 'Legal or professional services may require withholding — review before payment.'
                  : 'Review whether withholding applies before payment.'}
              </p>
              <div className="ir-kv"><span>Tax candidate</span><span>Needs accountant review</span></div>
              <div className="ir-kv"><span>Suggested rate</span><span><em className="ir-miss">Not asserted</em></span></div>
              <p className="ir-note ir-note-muted">
                A rate can be entered manually below; it is treated as your override, not as a
                system determination.
              </p>
            </>
          )}
        </section>

        {/* 3 — payment breakdown: the visual centre */}
        <section className="ir-sec ir-break">
          <span className="ir-label">Payment breakdown</span>
          <div className="ir-row"><span>Gross invoice amount</span><span className="ir-mono">{money(gross, ccy)}</span></div>
          <div className="ir-row">
            <span>Less: withholding tax {rateValid ? `(${rateNum}%)` : ''}</span>
            <span className="ir-mono">{withheld === null ? <em className="ir-miss">Needs review</em> : `− ${money(withheld, ccy)}`}</span>
          </div>
          <div className="ir-row ir-row-total">
            <span>Net amount to pay supplier</span>
            <span className="ir-mono">{net === null ? <em className="ir-miss">Not calculated yet</em> : money(net, ccy)}</span>
          </div>

          <div className="ir-cards">
            <div className="ir-card">
              <span className="ir-card-k">You pay supplier</span>
              <span className="ir-card-v">{net === null ? money(gross, ccy) : money(net, ccy)}</span>
            </div>
            <div className="ir-card ir-card--tax">
              <span className="ir-card-k">You withhold for tax</span>
              <span className="ir-card-v">{withheld === null ? '—' : money(withheld, ccy)}</span>
            </div>
          </div>
          {withheld !== null && (
            <p className="ir-note ir-note-muted">
              Withholding shown at a {rateSource === 'engine' ? 'rate from the tax rule engine' : 'rate you entered manually'}.
              Accountant review is still required.
            </p>
          )}
        </section>

        {/* edit calculation — local only */}
        <section className="ir-sec">
          <div className="ir-sec-head">
            <span className="ir-label">Calculation</span>
            <Btn sm variant="ghost" onClick={() => setEdit((v) => !v)}>{edit ? 'Done' : 'Edit calculation'}</Btn>
          </div>
          {edit && (
            <div className="ir-form">
              <label className="ir-field">
                <span>Service type</span>
                <input value={service} onChange={(e) => setService(e.target.value)}
                  placeholder={nameGuess?.label || 'e.g. legal service'} />
              </label>
              <label className="ir-field">
                <span>Tax treatment</span>
                <select value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                  <option value="review">Needs accountant review</option>
                  <option value="withhold">Apply withholding</option>
                  <option value="none">No withholding</option>
                </select>
              </label>
              {treatment === 'withhold' && (
                <label className="ir-field">
                  <span>Withholding rate (%)</span>
                  <input type="number" min="0" max="99" step="0.1" value={rate}
                    onChange={(e) => setRate(e.target.value)} placeholder="e.g. 2" />
                </label>
              )}
              <label className="ir-field ir-field-wide">
                <span>Reason / note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Why this treatment was chosen" />
              </label>
              <p className="ir-note ir-note-muted">
                Calculation edits are used for this payable creation. Persistent tax review
                storage requires backend support.
              </p>
            </div>
          )}
        </section>

        {/* 4 — what will be created */}
        <section className="ir-sec">
          <span className="ir-label">After confirmation</span>
          <ol className="ir-will">
            <li>
              <strong>Supplier payable</strong>
              <span>{supplier || 'Supplier'} · {money(primary.amount ?? gross, ccy)}</span>
            </li>
            <li className="is-blocked">
              <strong>Tax withholding obligation</strong>
              <span>
                {withheld === null ? 'Not determined' : `${money(withheld, ccy)} candidate`} · Tax
                obligation creation requires backend support, so nothing is recorded against DJP.
              </span>
            </li>
            <li>
              <strong>Evidence link</strong>
              <span>This invoice is attached to the payable as supporting document.</span>
            </li>
          </ol>
          <p className="ir-note ir-note-muted">
            The gross / tax / net split is not stored — payables have no tax breakdown fields yet.
            Only the amount you confirm below is recorded.
          </p>
          {missing.length > 0 && (
            <p className="ir-note ir-note-amber">Missing before creation: {missing.join(', ')}.</p>
          )}
        </section>

        <footer className="ir-actions">
          <Btn onClick={() => onCreate({
            doc, amount: primary.amount, gross, withheld, net, rate: rateValid ? rateNum : null,
            treatment, service: serviceLabel, note, state,
          })} disabled={primary.disabled || busy}>{primary.label}</Btn>
          <Btn variant="ghost" onClick={() => setTreatment('none')} disabled={busy}>Mark tax not applicable</Btn>
          <Btn variant="ghost" onClick={() => onLinkExisting(doc)} disabled={busy}>Link existing payable</Btn>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        </footer>
      </aside>
    </div>
  )
}
