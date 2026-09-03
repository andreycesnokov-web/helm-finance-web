// AI Tax Split V1 — the invoice → tax → accountant workflow.
//
// The promise this page keeps: after entering an invoice the owner knows what to pay the
// vendor, what to remit to DJP, what documents are missing, and what the accountant must
// confirm. Every number is a SUGGESTION.
//
// WHAT THIS PAGE NEVER DOES:
//   * pay anything, or contact a bank or Coretax;
//   * create a record without an explicit click;
//   * present a tax treatment as final. Only land/building rent auto-calculates, because
//     it is the only treatment whose rate and base are cited to archived official text
//     (PP 34/2017) — and even that rests on a knowledge-base candidate still under review.
//
// Records are created through the EXISTING business-scoped routes: POST /api/debts for the
// vendor and tax payables, POST /api/reminders for the deadline. The only new write is an
// advisory row in tax_treatments via POST /api/tax-split/review.
import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { PageHeader, Card, Btn, StatusBadge, Icon } from '../../shell/ui'
import './TaxSplit.css'

const money = (n, ccy = 'IDR') =>
  n === null || n === undefined ? '—' : `${ccy} ${Number(n).toLocaleString('de-DE')}`

const CONF_TONE = { High: 'success', Medium: 'warning' }
const TREATMENTS = [
  { value: '', label: 'Detect automatically' },
  { value: 'rent_land_building', label: 'Land / building rent' },
  { value: 'service_fee', label: 'Service fee' },
  { value: 'equipment_capex', label: 'Equipment / machine purchase' },
  { value: 'unknown', label: 'Unclear' },
]

/* Tracker vocabulary. V1 records these; it does not automate them. */
const TRACKER = [
  ['tax_suggested', 'Tax suggested'],
  ['waiting_for_accountant_review', 'Waiting for accountant review'],
  ['billing_code_needed', 'Billing code needed'],
  ['billing_code_created', 'Billing code created'],
  ['tax_payment_due', 'Tax payment due'],
  ['tax_paid', 'Tax paid'],
  ['proof_uploaded', 'Proof uploaded'],
  ['bukti_potong_prepared', 'Bukti potong prepared'],
  ['reported', 'Reported'],
  ['closed', 'Closed'],
]

const BLANK = {
  invoice_number: '', vendor_name: '', vendor_npwp: '', invoice_date: '',
  due_date: '', description: '', gross_amount: '', currency: 'IDR', treatment_key: '',
}

export default function TaxSplit() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { active } = useWorkspace()

  const [form, setForm] = useState(BLANK)
  const [split, setSplit] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState({})          // action key → outcome text
  const [tracker, setTracker] = useState('tax_suggested')
  // Duplicate protection. `done` disables each button after a success, but React state
  // is asynchronous: a fast double-click can fire the handler twice before a re-render.
  // This ref is the synchronous guard, so each action creates at most ONE financial
  // record. A failed action is released again so a genuine retry still works.
  const guard = useRef(new Set())

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const suggest = useCallback(async (e) => {
    e?.preventDefault()
    setBusy(true); setErr(null); setDone({}); guard.current.clear()
    try {
      const r = await apiFetch('/tax-split/suggest', token, {
        method: 'POST',
        body: { ...form, gross_amount: form.gross_amount === '' ? null : Number(form.gross_amount) },
      })
      setSplit(r.split); setTracker('tax_suggested')
    } catch (e2) { setErr(e2.message || 'Could not build a suggestion') }
    finally { setBusy(false) }
  }, [form, token])

  // Each action is a separate, explicit write through an existing route.
  const act = async (key, fn, okMsg) => {
    if (guard.current.has(key)) return           // in flight, or already succeeded
    guard.current.add(key)
    setBusy(true); setErr(null)
    try { const out = await fn(); setDone((d) => ({ ...d, [key]: okMsg(out) })) }
    catch (e2) { guard.current.delete(key); setErr(e2.message || 'Action failed') }
    finally { setBusy(false) }
  }

  const createVendorPayable = () => act('create_vendor_payable', () =>
    apiFetch('/debts', token, { method: 'POST', body: {
      type: 'payable',
      counterparty: split.invoice.vendor_name || 'Vendor',
      description: `${split.detected_label} — ${split.invoice.invoice_number || 'invoice'} (net of withholding, AI Tax Split suggestion)`,
      amount: split.vendor_payment_amount,
      currency: split.invoice.currency,
      due_date: split.invoice.due_date || null,
      source_channel: 'web',
    } }), (d) => `Vendor payable #${d?.id ?? '—'} created for ${money(split.vendor_payment_amount, split.invoice.currency)}`)

  const createTaxPayable = () => act('create_tax_payable', () =>
    apiFetch('/debts', token, { method: 'POST', body: {
      type: 'payable',
      counterparty: 'DJP',
      description: `${split.tax_type} on ${split.invoice.invoice_number || 'invoice'} — ${split.invoice.vendor_name || 'vendor'} (AI Tax Split suggestion, pending accountant review)`,
      amount: split.tax_payment_amount,
      currency: split.invoice.currency,
      source_channel: 'web',
    } }), (d) => `Tax payable #${d?.id ?? '—'} created for ${money(split.tax_payment_amount, split.invoice.currency)}`)

  // Suggested only, and editable: V1 does not assert a statutory deadline.
  const addDeadline = () => act('add_tax_deadline', () => {
    // POST /api/reminders is shared with Personal, so it does not resolve a business
    // itself. Refuse rather than create a reminder with no business_id.
    if (!active?.id) throw new Error('No active business workspace — open this page from a business workspace')
    const base = split.invoice.invoice_date ? new Date(split.invoice.invoice_date) : new Date()
    const d = new Date(base.getFullYear(), base.getMonth() + 1, 10)
    return apiFetch('/reminders', token, { method: 'POST', body: {
      business_id: active?.id,
      title: `Suggested: remit ${split.tax_type} for ${split.invoice.invoice_number || 'invoice'} — confirm date with accountant`,
      due_date: d.toISOString().slice(0, 10),
    } })
  }, () => 'Suggested deadline added — edit it once your accountant confirms the statutory date')

  const requestReview = () => act('request_accountant_review', () =>
    apiFetch('/tax-split/review', token, { method: 'POST', body: {
      ...form,
      gross_amount: Number(form.gross_amount) || 0,
      review_status: 'sent_to_accountant_review',
    } }), (r) => { setTracker('waiting_for_accountant_review')
      return `Recorded for accountant review — review #${r?.treatment?.id ?? '—'}` })

  const head = (
    <PageHeader eyebrow="Business Workspace" title="AI Tax Split"
      actions={<>
        <StatusBadge tone="neutral">Suggestion · review-first</StatusBadge>
        <Btn sm variant="ghost" onClick={() => navigate('/business/accountant')}>AI Accountant</Btn>
      </>} />
  )

  const canAct = (k) => !!split?.next_actions?.find((a) => a.key === k)?.enabled

  return <>{head}
    <p className="ts-disclaimer">
      <Icon.warn width="15" height="15" aria-hidden="true" />
      CFO AI provides suggested tax treatment based on available invoice data. Final tax treatment
      must be reviewed by your accountant or tax advisor.
    </p>

    <div className="ts-grid">
      {/* ── input ─────────────────────────────────────────────────────── */}
      <Card title="Test AI Tax Split">
        <form className="ts-form" onSubmit={suggest}>
          <label className="ts-field"><span>Invoice number</span>
            <input value={form.invoice_number} onChange={set('invoice_number')} placeholder="INV-001" /></label>
          <label className="ts-field"><span>Vendor</span>
            <input value={form.vendor_name} onChange={set('vendor_name')} placeholder="PT ABC Properti" /></label>
          <label className="ts-field"><span>Vendor NPWP <em>optional</em></span>
            <input value={form.vendor_npwp} onChange={set('vendor_npwp')} placeholder="00.000.000.0-000.000" /></label>
          <label className="ts-field"><span>Invoice date</span>
            <input type="date" value={form.invoice_date} onChange={set('invoice_date')} /></label>
          <label className="ts-field"><span>Due date <em>optional</em></span>
            <input type="date" value={form.due_date} onChange={set('due_date')} /></label>
          <label className="ts-field"><span>Currency</span>
            <input value={form.currency} onChange={set('currency')} /></label>
          <label className="ts-field ts-field-wide"><span>Description</span>
            <input value={form.description} onChange={set('description')}
              placeholder="Office rent September 2026" /></label>
          <label className="ts-field"><span>Gross amount</span>
            <input type="number" min="0" step="1" value={form.gross_amount}
              onChange={set('gross_amount')} placeholder="10000000" /></label>
          <label className="ts-field"><span>Treatment</span>
            <select value={form.treatment_key} onChange={set('treatment_key')}>
              {TREATMENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></label>
          <div className="ts-form-actions">
            <Btn type="submit" disabled={busy}>Analyze invoice</Btn>
            <Btn type="button" variant="ghost" disabled={busy}
              onClick={() => { setForm(BLANK); setSplit(null); setDone({}); setErr(null); guard.current.clear() }}>
              Clear</Btn>
          </div>
        </form>
        {err && <p className="ts-err">{err}</p>}
      </Card>

      {/* ── result ────────────────────────────────────────────────────── */}
      {split && (
        <Card title="AI Tax Split" className="ts-result">
          <div className="ts-head">
            <div>
              <span className="ts-detected">{split.detected_label}</span>
              <h3 className="ts-title">{split.invoice.vendor_name || 'Vendor'}</h3>
              <p className="ts-sub">
                {split.invoice.invoice_number || 'No invoice number'}
                {split.invoice.invoice_date ? ` · ${split.invoice.invoice_date}` : ''}
              </p>
            </div>
            <StatusBadge tone={CONF_TONE[split.confidence_score] || 'info'}>
              Confidence: {split.confidence_score}
            </StatusBadge>
          </div>

          {/* how the type was decided — never presented as extraction */}
          <p className="ts-note">
            Type detected from the {split.detection.matched_on === 'none' ? 'invoice you entered'
              : split.detection.matched_on.replace('_', ' ')}
            {split.detection.overridden_by_user ? ' — overridden by you' : ''}. No document text was read.
          </p>

          {split.missing_data.length > 0 && (
            <p className="ts-warn">Missing before anything can be created: {split.missing_data.join(', ')}.</p>
          )}

          {/* ── the split ──────────────────────────────────────────── */}
          <section className="ts-sec">
            <span className="ts-label">Suggested withholding</span>
            {split.auto_calculated ? (
              <>
                <div className="ts-kv"><span>{split.tax_type}</span>
                  <span className="ts-mono">{money(split.tax_payment_amount, split.invoice.currency)}</span></div>
                <div className="ts-kv"><span>Rate</span><span>{(split.tax_rate * 100).toFixed(0)}%</span></div>
                <div className="ts-kv"><span>Tax base</span><span>{split.tax_base_label}</span></div>
                {split.tax_base_note && <p className="ts-note">{split.tax_base_note}</p>}
                <p className="ts-note">
                  Based on <strong>{split.official_rule_reference}</strong>. This rule is a knowledge-base
                  candidate with status <code>{split.kb_status}</code> — it has not been activated or legally
                  verified, so your accountant must confirm it.
                </p>
              </>
            ) : (
              <>
                <p className="ts-warn"><strong>{split.tax_type}.</strong> No amount is calculated.</p>
                <ul className="ts-reasons">{split.review_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </>
            )}
          </section>

          {/* ── payment instruction: the decision ───────────────────── */}
          <section className="ts-sec ts-pay">
            <span className="ts-label">Payment instruction</span>
            <div className="ts-row"><span>Gross amount</span>
              <span className="ts-mono">{money(split.gross_amount, split.invoice.currency)}</span></div>
            <div className="ts-cards">
              <div className="ts-card">
                <span className="ts-card-k">Pay vendor</span>
                <span className="ts-card-v">{money(split.payment_instruction.pay_vendor, split.invoice.currency)}</span>
              </div>
              <div className="ts-card ts-card--tax">
                <span className="ts-card-k">Pay tax to DJP</span>
                <span className="ts-card-v">{money(split.payment_instruction.pay_tax_to_djp, split.invoice.currency)}</span>
              </div>
            </div>
            <p className={split.auto_calculated ? 'ts-warn' : 'ts-note'}>{split.payment_instruction.warning}</p>
          </section>

          {split.tax_payment_guide.length > 0 && (
            <section className="ts-sec">
              <span className="ts-label">Tax payment guide</span>
              <ol className="ts-guide">{split.tax_payment_guide.map((g) => <li key={g}>{g}</li>)}</ol>
              <p className="ts-note">
                CFO AI does not pay tax and does not submit to Coretax. These are the steps you or your
                accountant perform, and the proof you upload back here.
              </p>
            </section>
          )}

          <section className="ts-sec">
            <span className="ts-label">Required documents</span>
            <ul className="ts-docs">{split.required_documents.map((d) => <li key={d}>{d}</li>)}</ul>
          </section>

          {split.asset_hook && (
            <section className="ts-sec ts-hook">
              <span className="ts-label">Company asset</span>
              <p className="ts-note">
                This invoice may represent a company asset. Creating one is not available yet —
                it is recorded here so it can be offered after accountant review.
              </p>
            </section>
          )}

          {/* ── actions ─────────────────────────────────────────────── */}
          <section className="ts-sec">
            <span className="ts-label">Required actions</span>
            <div className="ts-actions">
              <Btn sm disabled={busy || !!done.create_vendor_payable || !canAct('create_vendor_payable')}
                onClick={createVendorPayable}>
                {done.create_vendor_payable ? 'Vendor payable created' : 'Create vendor payable'}</Btn>
              <Btn sm disabled={busy || !!done.create_tax_payable || !canAct('create_tax_payable')}
                onClick={createTaxPayable}>
                {done.create_tax_payable ? 'Tax payable created' : 'Create tax payable'}</Btn>
              <Btn sm variant="ghost" disabled={busy || !!done.add_tax_deadline || !canAct('add_tax_deadline')}
                onClick={addDeadline}>
                {done.add_tax_deadline ? 'Deadline added' : 'Add tax deadline'}</Btn>
              <Btn sm variant="ghost" disabled title="Available once the tax payable exists and a proof document is uploaded">
                Upload tax payment proof</Btn>
              <Btn sm variant="ghost" disabled title="Prepared in Coretax e-Bupot; CFO AI records it, it does not file it">
                Prepare bukti potong</Btn>
              <Btn sm variant="ghost"
                disabled={busy || !!done.request_accountant_review || !canAct('request_accountant_review')}
                onClick={requestReview}>
                {done.request_accountant_review ? 'Sent to accountant' : 'Request accountant review'}</Btn>
            </div>
            {!split.auto_calculated && (
              <p className="ts-note">
                {split.currency_supported === false
                  ? `Payable actions are disabled because this invoice is in ${split.invoice.currency}. `
                    + 'V1 suggests a split for IDR invoices only — a non-IDR amount needs FX and tax-base '
                    + 'confirmation from your accountant before any rupiah is remitted to DJP.'
                  : 'Payable actions are disabled because no split is suggested. Confirm the treatment with your accountant first.'}
              </p>
            )}
            {Object.entries(done).map(([k, v]) => <p className="ts-ok" key={k}>{v}</p>)}
          </section>

          {/* ── tracker ─────────────────────────────────────────────── */}
          <section className="ts-sec">
            <span className="ts-label">Tax payment status</span>
            <ol className="ts-track">
              {TRACKER.map(([k, l], i) => {
                const at = TRACKER.findIndex(([x]) => x === tracker)
                return <li key={k} className={i < at ? 'is-past' : i === at ? 'is-now' : ''}>{l}</li>
              })}
            </ol>
            <p className="ts-note">
              V1 records these states; it does not automate them. Nothing advances without a person.
            </p>
          </section>
        </Card>
      )}
    </div>
  </>
}
