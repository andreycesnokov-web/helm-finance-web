// Add / edit counterparty (designs/AddCounterparty.dc.html). Creates through the EXISTING
// POST /api/counterparties and edits through the EXISTING PATCH /api/counterparties/:id.
// On create the server refuses a likely duplicate (409) with the candidates; we then ask
// "Is this <name>?" — open the existing one, or create anyway (create_new_anyway).
// Nothing is ever merged.
//
// Entity form (PT/CV/person/foreign/other), landlord/lender roles and payment terms are
// stored since batch 8 (P-04, migration 060, approved in DECISIONS.md). They are sent
// only when filled in, so a database without 060 still accepts the rest; if it is missing
// the server answers 409 and we say so. The accountant role and above may set them.
// Tax rates are listed from the verified rule engine (GET /api/accountant/rules), never
// typed here, and entity form never picks a rate on this screen.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Btn, Pill, Skeleton, ErrorBox } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { createCounterparty, updateCounterparty, actionError } from '../lib/actions'
import { npwpFormat, holderMatches } from '../lib/obligations'

const ROLES = [['vendor', 'cp.form.supplier'], ['customer', 'cp.form.customer'], ['both', 'cp.form.both'],
  ['landlord', 'cp.form.landlord'], ['lender', 'cp.form.lender']]
const FORMS = ['pt', 'cv', 'person', 'foreign', 'other']
const EMPTY = { role: 'vendor', legal_name: '', display_name: '', npwp: '', pkp_status: 'unknown', notes: '', address: '', phone: '', email: '', bank_name: '', account_number: '', account_name: '', default_category: '', entity_form: '', payment_terms_days: '' }
const fromRow = (c) => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c?.[k] == null ? EMPTY[k] : String(c[k])])),
  role: c?.role || 'other', legal_name: c?.legal_name || c?.name || '', bank_name: '', account_number: '', account_name: '' })
const ruleRate = (r) => { const p = r?.parameters || {}; const n = Number(p.rate ?? p.percent ?? p.tax_rate); return Number.isFinite(n) && n > 0 ? n : null }

export default function AddCounterparty() {
  const t = useT()
  const nav = useNavigate()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const { id } = useParams()
  const editing = !!id
  const rules = useApi('/accountant/rules')
  const existing = useApi(editing ? `/counterparties/${encodeURIComponent(id)}` : null)
  const cp = existing.data?.counterparty || null
  const [f, setF] = useState(EMPTY)
  useEffect(() => { if (cp) setF(fromRow(cp)) }, [cp])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [dup, setDup] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const npwp = npwpFormat(f.npwp)
  const holder = holderMatches(f.account_name, f.legal_name)
  const withholding = useMemo(() => (rules.data?.rules || []).filter((r) => /withhold|pph/i.test(`${r.obligation_type} ${r.rule_code}`)), [rules.data])

  const terms = f.payment_terms_days === '' ? null : Number(f.payment_terms_days)
  const termsBad = terms != null && !(Number.isInteger(terms) && terms >= 0 && terms <= 365)

  const save = async (anyway = false) => {
    if (!f.legal_name.trim()) { setErr(t('cp.form.nameRequired')); return }
    if (termsBad) { setErr(t('cp.form.termsBad')); return }
    setBusy(true); setErr(null)
    // P-04 fields: sent when filled in, or when an edit clears a stored value.
    const taxFields = {
      ...(f.entity_form || (editing && cp?.entity_form) ? { entity_form: f.entity_form || null } : {}),
      ...(terms != null || (editing && cp?.payment_terms_days != null) ? { payment_terms_days: terms } : {}),
    }
    const body = {
      // On edit the role is sent only when changed: legacy rows may hold a type the role
      // list does not accept (e.g. 'supplier'), and resending it unchanged would be refused.
      role: editing && f.role === (cp?.role || 'other') ? undefined : f.role, legal_name: f.legal_name.trim(), display_name: f.display_name.trim() || undefined,
      npwp: f.npwp.trim() || null, pkp_status: f.pkp_status, notes: f.notes.trim() || null,
      address: f.address.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null,
      default_category: f.default_category.trim() || null,
      bank_accounts: f.account_number.trim() ? [{ bank_name: f.bank_name.trim() || null, account_number: f.account_number.trim(), account_name: f.account_name.trim() || null, is_primary: !editing }] : (editing ? undefined : []),
      ...taxFields,
      ...(anyway ? { create_new_anyway: true } : {}),
    }
    try {
      if (editing) await updateCounterparty(token, id, body)
      else await createCounterparty(token, body)
      invalidate()
      nav('/business/counterparties')
    } catch (e) {
      const code = actionError(e)
      if (e?.status === 409 && e?.data?.error === 'possible_duplicate_counterparty') setDup(e.data)
      else if (code === 'notApplied') setErr(t('cp.form.notApplied'))
      else if (code === 'forbidden') setErr(Object.keys(taxFields).length ? t('cp.form.taxForbidden') : t('dec.forbidden'))
      else setErr(code)
    } finally { setBusy(false) }
  }

  if (editing && existing.loading) return <><PageHead title={t('cp.form.editTitle')} back={{ to: '/business/counterparties', label: t('nav.counterparties') }} /><Card><Skeleton rows={6} /></Card></>
  if (editing && existing.error) return <><PageHead title={t('cp.form.editTitle')} back={{ to: '/business/counterparties', label: t('nav.counterparties') }} /><ErrorBox error={existing.error} onRetry={existing.reload} /></>

  const field = (k, label, extra = {}) => (
    <label className="v2-field">
      <span className="v2-field-label">{label}</span>
      <input className="v2-input" value={f[k]} onChange={set(k)} {...extra} />
    </label>
  )

  return (
    <div className="v2-page">
      <PageHead title={editing ? (cp?.display_name || cp?.name || t('cp.form.editTitle')) : t('screen.addCounterparty')} sub={editing ? t('cp.form.editSub') : t('cp.form.sub')} back={{ to: '/business/counterparties', label: t('nav.counterparties') }}
        actions={<><Btn to="/business/counterparties">{t('dec.cancel')}</Btn><Btn variant="primary" onClick={() => save(false)} disabled={busy}>{t('cp.form.save')}</Btn></>} />

      {!editing && <div className="v2-start4">
        <Link className="v2-card v2-start" to="/business/documents"><I.documents size={20} /><strong>{t('cp.form.fromDoc')}</strong><span className="v2-muted v2-small">{t('cp.form.fromDocHint')}</span></Link>
        <div className="v2-card v2-start is-off" aria-disabled="true"><I.search size={20} /><strong>{t('cp.form.fromNpwp')}</strong><span className="v2-muted v2-small">{t('cp.form.fromNpwpHint')}</span></div>
        <Link className="v2-card v2-start" to="/business/ai-cfo"><I.cfo size={20} /><strong>{t('cp.form.fromChat')}</strong><span className="v2-muted v2-small">{t('cp.form.fromChatHint')}</span></Link>
        <div className="v2-card v2-start is-on"><I.plus size={20} /><strong>{t('cp.form.byHand')}</strong><span className="v2-muted v2-small">{t('cp.form.byHandHint')}</span></div>
      </div>}

      {dup && (
        <div className="v2-banner v2-tone-warn" role="alert">
          <I.warn size={18} />
          <span className="v2-banner-text"><strong>{t('cp.form.dupQ', { name: dup.possible_matches?.[0]?.legal_name || dup.possible_matches?.[0]?.name || '' })}</strong> {dup.message}</span>
          <Btn to="/business/counterparties/manage">{t('cp.form.openExisting')}</Btn>
          <Btn variant="primary" onClick={() => save(true)} disabled={busy}>{t('cp.form.different')}</Btn>
        </div>
      )}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}

      <div className="v2-grid-detail">
        <Card title={t('cp.form.details')} className="v2-col">
          <div className="v2-field">
            <span className="v2-field-label" id="cp-role">{t('cp.form.theyAre')}</span>
            <div className="v2-seg v2-seg-wrap" role="radiogroup" aria-labelledby="cp-role">
              {ROLES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.role === k} aria-pressed={f.role === k} className="v2-seg-btn" onClick={() => setF((x) => ({ ...x, role: k }))}>{t(l)}</button>)}
            </div>
          </div>
          <div className="v2-field">
            <span className="v2-field-label" id="cp-form">{t('cp.form.entityType')}</span>
            <div className="v2-seg v2-seg-wrap" role="radiogroup" aria-labelledby="cp-form">
              {FORMS.map((k) => <button key={k} type="button" role="radio" aria-checked={f.entity_form === k} aria-pressed={f.entity_form === k} className="v2-seg-btn"
                onClick={() => setF((x) => ({ ...x, entity_form: x.entity_form === k ? '' : k }))}>{t(`cp.form.ef.${k}`)}</button>)}
            </div>
            <span className="v2-muted v2-small">{t('cp.form.entityHint')}</span>
          </div>
          {field('legal_name', t('cp.form.legalName'), { required: true, autoComplete: 'organization' })}
          {field('display_name', t('cp.form.shortName'))}
          <label className="v2-field">
            <span className="v2-field-label">NPWP</span>
            <input className="v2-input" value={f.npwp} onChange={set('npwp')} inputMode="numeric" aria-describedby="npwp-hint" />
            <span id="npwp-hint" className={`v2-small ${npwp === 'bad' ? 'v2-neg' : 'v2-muted'}`}>{t(`cp.form.npwp.${npwp}`)}</span>
          </label>
          <div className="v2-field">
            <span className="v2-field-label" id="cp-pkp">{t('cp.form.vat')}</span>
            <div className="v2-seg" role="radiogroup" aria-labelledby="cp-pkp">
              {[['pkp', 'PKP'], ['non_pkp', t('cp.form.notPkp')], ['unknown', t('cp.form.unknown')]].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={f.pkp_status === k} aria-pressed={f.pkp_status === k} className="v2-seg-btn" onClick={() => setF((x) => ({ ...x, pkp_status: k }))}>{l}</button>
              ))}
            </div>
          </div>
          {field('notes', t('cp.form.whatTheyDo'))}
          {field('address', t('cp.form.address'), { autoComplete: 'street-address' })}
          <div className="v2-field-row">
            {field('phone', t('cp.form.contact'), { autoComplete: 'tel' })}
            {field('email', t('cp.form.email'), { type: 'email', autoComplete: 'email' })}
          </div>
          <fieldset className="v2-fieldset">
            <legend className="v2-field-label">{editing ? t('cp.form.addBank') : t('cp.form.bank')}</legend>
            {editing && (cp?.bank_accounts || []).length > 0 && (
              <ul className="v2-moves">{cp.bank_accounts.map((a) => (
                <li key={a.id}><span>{[a.bank_name, a.account_name].filter(Boolean).join(' · ') || '—'}</span><span className="v2-num">···· {String(a.account_number || '').slice(-4)}</span></li>
              ))}</ul>
            )}
            <div className="v2-field-row">
              {field('bank_name', t('cp.form.bankName'))}
              {field('account_number', t('cp.form.accountNo'), { inputMode: 'numeric' })}
            </div>
            {field('account_name', t('cp.form.holder'))}
            {holder != null && <span className={`v2-small ${holder ? 'v2-pos' : 'v2-neg'}`}>{t(holder ? 'cp.form.holderOk' : 'cp.form.holderBad')}</span>}
          </fieldset>
          <div className="v2-field-row">
            {field('default_category', t('cp.form.category'))}
            <label className="v2-field">
              <span className="v2-field-label">{t('cp.form.terms')}</span>
              <input className="v2-input" type="number" inputMode="numeric" min={0} max={365} step={1} value={f.payment_terms_days} onChange={set('payment_terms_days')}
                aria-invalid={termsBad || undefined} aria-describedby="cp-terms-hint" />
              <span id="cp-terms-hint" className={`v2-small ${termsBad ? 'v2-neg' : 'v2-muted'}`}>{t(termsBad ? 'cp.form.termsBad' : 'cp.form.termsHint')}</span>
            </label>
          </div>
          <div className="v2-row-gap v2-row-end">
            <Btn to="/business/counterparties">{t('dec.cancel')}</Btn>
            <Btn variant="primary" onClick={() => save(false)} disabled={busy}>{t('cp.form.save')}</Btn>
          </div>
        </Card>

        <div className="v2-col">
          <Card title={t('cp.form.docsTitle')}>
            <ul className="v2-check">
              {['firstInvoice', 'npwpCard', 'contract', 'nib'].map((k) => (
                <li key={k}><span className="v2-check-mark" aria-hidden="true" />
                  <span className="v2-check-text"><span>{t(`cp.form.doc.${k}`)}</span><span className="v2-muted v2-small">{t(`cp.form.doc.${k}Hint`)}</span></span>
                  <Link to="/business/documents">{t('bill.upload')}</Link></li>
              ))}
            </ul>
          </Card>
          <Card title={t('cp.form.rulesTitle')}>
            {rules.loading ? null : withholding.length === 0 ? <p className="v2-muted">{t('cp.form.noRules')}</p> : (
              <ul className="v2-rules">
                {withholding.map((r) => (
                  <li key={r.id || r.rule_code}><span>{r.title || r.rule_code}</span>
                    {ruleRate(r) != null ? <Pill tone="info">{ruleRate(r)}%</Pill> : <Pill tone="neutral">{t('cp.form.rateNotSet')}</Pill>}</li>
                ))}
              </ul>
            )}
            <p className="v2-muted v2-small">{t('cp.form.rulesNote')}</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
