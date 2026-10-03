// Add counterparty v2 (designs/AddCounterparty). Saves through the EXISTING
// POST /api/counterparties, which runs the server's duplicate check first and
// answers 409 with possible matches. We never merge: the owner either opens the
// existing record or explicitly says "Different company" (create_new_anyway,
// which the server audits). Tax treatment is shown only as an explanation of the
// engine's rules — no rate is decided here.
// "From a document / NPWP / chat" starts are honest "not available yet" states.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { apiFetch } from '../../lib/api'
import { Page, Card, Btn, Ico, Note, Tabs } from '../ui'
import { useV2T } from '../lib/i18n'
import { useV2Invalidate } from '../lib/data'
import { P } from '../routes'
import { TYPE_TO_ROLE, counterpartyBody, holderMatches } from '../lib/derive'

// UI type → existing counterparty role (server CP_ROLES). Landlord / lender have
// no role yet — proposal in _specs/design-v2/PROPOSALS.md.





const EMPTY = { type: 'supplier', legal_name: '', display_name: '', npwp: '', pkp_status: 'unknown', address: '', email: '', phone: '', notes: '', bank_name: '', bank_number: '', bank_holder: '' }

function Field({ label, children, hint }) {
  return <label className="v2-field"><span className="v2-field-label">{label}</span>{children}{hint && <span className="v2-field-hint">{hint}</span>}</label>
}

export default function AddCounterparty() {
  const { t } = useV2T()
  const { token } = useAuth()
  const navigate = useNavigate()
  const invalidate = useV2Invalidate()
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [dup, setDup] = useState(null)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const match = holderMatches(f.bank_holder, f.legal_name)
  const npwpDigits = f.npwp.replace(/\D/g, '')
  const npwpOk = !f.npwp || npwpDigits.length === 15 || npwpDigits.length === 16

  const save = async (anyway = false) => {
    if (!f.legal_name.trim()) { setErr(t('acp.nameRequired')); return }
    setBusy(true); setErr(null)
    try {
      await apiFetch('/counterparties', token, { method: 'POST', body: { ...counterpartyBody(f), ...(anyway ? { create_new_anyway: true } : {}) } })
      invalidate('/counterparties')
      navigate(P.counterparties)
    } catch (e) {
      if (e.status === 409 && e.code === 'possible_duplicate_counterparty') setDup(e.data)
      else setErr(e.message || 'Request failed')
    } finally { setBusy(false) }
  }

  const crumb = <Link to={P.counterparties} className="v2-crumb"><Ico name="chevLeft" size={16} />{t('nav.counterparties')}</Link>
  return (
    <Page narrow title={t('screen.addCounterparty')} sub={t('acp.sub')}
      actions={<><Btn to={P.counterparties}>{t('common.cancel')}</Btn><Btn variant="primary" onClick={() => save(false)} disabled={busy}>{t('acp.save')}</Btn></>}>
      {crumb}
      <Card title={t('acp.start')}>
        <div className="v2-startgrid">
          {['doc', 'npwp', 'chat'].map((k) => (
            <div key={k} className="v2-startopt is-off"><Ico name={k === 'doc' ? 'upload' : k === 'npwp' ? 'search' : 'send'} size={18} />
              <div><div className="v2-strong">{t(`acp.start_${k}`)}</div><div className="v2-small is-muted">{t('state.notYet')}</div></div></div>))}
          <div className="v2-startopt is-on"><Ico name="doc" size={18} /><div><div className="v2-strong">{t('acp.start_hand')}</div><div className="v2-small is-muted">{t('acp.start_hand_sub')}</div></div></div>
        </div>
      </Card>

      {dup && <Card className="v2-dupcard">
        <h2 className="v2-h3">{t('acp.dupTitle')}</h2>
        <p className="v2-cardsub">{dup.message || t('acp.dupBody')}</p>
        {(dup.possible_matches || []).slice(0, 3).map((m, i) => <div key={i} className="v2-small v2-strong">· {m.legal_name || m.display_name || m.name}</div>)}
        <div className="v2-row-actions">
          <Btn variant="primary" to={P.counterparties}>{t('acp.dupSame')}</Btn>
          <Btn onClick={() => { setDup(null); save(true) }} disabled={busy}>{t('acp.dupDifferent')}</Btn>
        </div>
        <p className="v2-small is-muted">{t('acp.neverMerge')}</p>
      </Card>}

      <Card title={t('acp.who')}>
        <div className="v2-form">
          <Field label={t('acp.theyAre')}>
            <Tabs label={t('acp.theyAre')} active={f.type} onChange={(v) => setF((p) => ({ ...p, type: v }))} items={[
              { key: 'supplier', label: t('cp.supplier') }, { key: 'customer', label: t('cp.customer') }, { key: 'both', label: t('cp.both') },
              { key: 'landlord', label: t('acp.landlord'), disabled: true }, { key: 'lender', label: t('acp.lender'), disabled: true }]} />
          </Field>
          <div className="v2-form-2">
            <Field label={t('acp.legalName')}><input className="v2-input" value={f.legal_name} onChange={set('legal_name')} required /></Field>
            <Field label={t('acp.shortName')}><input className="v2-input" value={f.display_name} onChange={set('display_name')} /></Field>
            <Field label="NPWP" hint={npwpOk ? t('acp.npwpHint') : t('acp.npwpBad')}><input className="v2-input" inputMode="numeric" value={f.npwp} onChange={set('npwp')} aria-invalid={!npwpOk} /></Field>
            <Field label={t('acp.vat')}>
              <select className="v2-input" value={f.pkp_status} onChange={set('pkp_status')}>
                <option value="pkp">PKP</option><option value="non_pkp">{t('acp.notPkp')}</option><option value="unknown">{t('acp.unknown')}</option></select>
            </Field>
            <Field label={t('acp.address')}><input className="v2-input" value={f.address} onChange={set('address')} /></Field>
            <Field label={t('acp.contact')}><input className="v2-input" value={f.phone} onChange={set('phone')} /></Field>
            <Field label="Email"><input className="v2-input" type="email" value={f.email} onChange={set('email')} /></Field>
            <Field label={t('acp.notes')}><input className="v2-input" value={f.notes} onChange={set('notes')} /></Field>
          </div>
        </div>
      </Card>

      <Card title={t('acp.bank')}>
        <div className="v2-form-2">
          <Field label={t('acp.bankName')}><input className="v2-input" value={f.bank_name} onChange={set('bank_name')} /></Field>
          <Field label={t('acp.bankNumber')}><input className="v2-input" inputMode="numeric" value={f.bank_number} onChange={set('bank_number')} /></Field>
          <Field label={t('acp.bankHolder')}><input className="v2-input" value={f.bank_holder} onChange={set('bank_holder')} /></Field>
        </div>
        {match === true && <Note tone="info" icon="checkCircle">{t('acp.holderOk')}</Note>}
        {match === false && <Note tone="warning" icon="warn">{t('acp.holderBad')}</Note>}
      </Card>

      <Card title={t('acp.taxTitle')}>
        <p className="v2-cardsub">{t('acp.taxBody')}</p>
        <Btn variant="ghost" size="sm" to={P.companyProfile}>{t('acp.taxRules')}</Btn>
      </Card>

      {err && <div className="v2-field-error" role="alert">{err}</div>}
      <div className="v2-row-actions v2-only-phone"><Btn to={P.counterparties}>{t('common.cancel')}</Btn><Btn variant="primary" onClick={() => save(false)} disabled={busy}>{t('acp.save')}</Btn></div>
    </Page>
  )
}
