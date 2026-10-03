// Add asset (designs/AddAsset.dc.html) — saves to the asset register (P-11, migration 063)
// with POST /api/assets (owner/ceo/admin/cfo/accountant, audited). The purchase invoice can
// be uploaded through the existing DocumentIntakeModal; a bill already entered can be linked
// so the purchase is an asset, not a cost (no double counting).
// Group and useful life come ONLY from the verified tax rules (GET /api/assets → groups);
// the form never asks for a life or a rate. Without a verified rule the asset is saved with
// no life and no depreciation, and the page says so. Before 063 saving answers 409.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DocumentIntakeModal from '../../components/DocumentIntakeModal'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { PageHead, Card, Btn, NotYet } from '../ui'
import { useT } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { createAsset, actionError } from '../lib/actions'
import { money } from '../lib/format'

const TYPES = ['machines', 'vehicles', 'computers', 'furniture', 'buildings', 'other']
const today = () => new Date().toISOString().slice(0, 10)

export default function AddAsset() {
  const t = useT()
  const nav = useNavigate()
  const { active } = useWorkspace()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const reg = useApi('/assets')
  const debts = useApi('/debts?type=payable')
  const cps = useApi('/counterparties')
  const [upload, setUpload] = useState(false)
  const [f, setF] = useState({ name: '', asset_type: 'machines', cost: '', quantity: '1', acquired_on: today(), purchase_debt_id: '', supplier_counterparty_id: '', location: '', asset_group: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const groups = reg.data?.groups || []
  const fits = groups.filter((g) => g.asset_types.includes(f.asset_type))
  const group = f.asset_group ? groups.find((g) => g.code === f.asset_group) : fits.length === 1 ? fits[0] : null
  const available = reg.data?.available === true
  const unknown = reg.loading
  const registered = useMemo(() => new Set((reg.data?.assets || []).map((a) => String(a.purchase_debt_id))), [reg.data])
  const bills = (Array.isArray(debts.data) ? debts.data : []).filter((d) => d.type === 'payable' && d.status !== 'cancelled' && !registered.has(String(d.id)))

  const save = async () => {
    if (!f.name.trim() || !(Number(f.cost) > 0)) { setErr(t('addAsset.required')); return }
    setBusy(true); setErr(null)
    try {
      await createAsset(token, { ...f, cost: f.cost, quantity: Number(f.quantity) || 1,
        purchase_debt_id: f.purchase_debt_id || null, supplier_counterparty_id: f.supplier_counterparty_id || null, asset_group: f.asset_group || null })
      invalidate(); nav('/business/assets')
    } catch (e) {
      const code = actionError(e)
      setErr(code === 'forbidden' ? t('addAsset.forbidden') : code === 'notApplied' ? t('assets.notApplied') : e?.data?.error === 'purchase_already_registered' ? t('addAsset.already') : code)
    } finally { setBusy(false) }
  }
  const pickBill = (e) => {
    const d = bills.find((x) => String(x.id) === e.target.value)
    setF((x) => ({ ...x, purchase_debt_id: e.target.value, ...(d ? { cost: String(d.original_amount ?? d.amount ?? ''), name: x.name || d.description || '', acquired_on: String(d.created_at || x.acquired_on).slice(0, 10) } : {}) }))
  }

  const saveBtn = unknown ? <Btn variant="primary" disabled title={t('addAsset.checking')}>{t('addAsset.save')}</Btn> : available ? <Btn variant="primary" onClick={save} disabled={busy}>{t('addAsset.save')}</Btn> : <NotYet note={t('assets.notApplied')}>{t('addAsset.save')}</NotYet>
  return (
    <div className="v2-page">
      <PageHead title={t('screen.addAsset')} sub={t('addAsset.sub')} back={{ to: '/business/assets', label: t('nav.assets') }}
        actions={<><Btn to="/business/assets">{t('dec.cancel')}</Btn>{saveBtn}</>} />
      <ol className="v2-steps v2-card">
        {['s1', 's2', 's3', 's4'].map((k, i) => (
          <li key={k}><span className="v2-step-n" aria-hidden="true">{i + 1}</span>
            <span className="v2-check-text"><strong>{t(`addAsset.${k}`)}</strong><span className="v2-muted v2-small">{t(`addAsset.${k}Hint`)}</span></span></li>
        ))}
      </ol>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
      <div className="v2-grid-detail">
        <div className="v2-col">
          <Card title={t('addAsset.invoice')}>
            <button type="button" className="v2-drop" onClick={() => setUpload(true)}>
              <I.upload size={24} /><strong>{t('docs.drop')}</strong><span className="v2-muted v2-small">{t('addAsset.invoiceHint')}</span>
              <span className="v2-btn v2-btn-primary">{t('docs.choose')}</span>
            </button>
            {bills.length > 0 && (
              <label className="v2-field">
                <span className="v2-field-label">{t('addAsset.fromBill')}</span>
                <select className="v2-select" value={f.purchase_debt_id} onChange={pickBill}>
                  <option value="">{t('addAsset.noBill')}</option>
                  {bills.map((d) => <option key={d.id} value={d.id}>{[d.counterparty, d.description, money(d.original_amount ?? d.amount)].filter(Boolean).join(' · ')}</option>)}
                </select>
                <span className="v2-muted v2-small">{t('addAsset.fromBillHint')}</span>
              </label>
            )}
          </Card>
          <Card title={t('addAsset.details')}>
            {!available && !unknown && <div className="v2-banner v2-tone-warn"><I.info size={18} /><span className="v2-banner-text">{t('assets.notApplied')}</span></div>}
            <label className="v2-field"><span className="v2-field-label">{t('addAsset.name')}</span>
              <input className="v2-input" value={f.name} onChange={set('name')} maxLength={200} required /></label>
            <div className="v2-field">
              <span className="v2-field-label" id="asset-type">{t('addAsset.type')}</span>
              <div className="v2-chips" role="radiogroup" aria-labelledby="asset-type">
                {TYPES.map((k) => <button key={k} type="button" role="radio" aria-checked={f.asset_type === k} aria-pressed={f.asset_type === k} className="v2-chip v2-chip-sel" onClick={() => setF((x) => ({ ...x, asset_type: k, asset_group: '' }))}>{t(`addAsset.t.${k}`)}</button>)}
              </div>
            </div>
            <div className="v2-field-row">
              <label className="v2-field"><span className="v2-field-label">{t('addAsset.cost')}</span>
                <input className="v2-input" type="number" inputMode="decimal" min="0.01" step="0.01" value={f.cost} onChange={set('cost')} required /></label>
              <label className="v2-field"><span className="v2-field-label">{t('addAsset.qty')}</span>
                <input className="v2-input" type="number" inputMode="numeric" min="1" step="1" value={f.quantity} onChange={set('quantity')} /></label>
              <label className="v2-field"><span className="v2-field-label">{t('addAsset.date')}</span>
                <input className="v2-input" type="date" value={f.acquired_on} onChange={set('acquired_on')} /></label>
            </div>
            <div className="v2-field-row">
              <label className="v2-field"><span className="v2-field-label">{t('addAsset.supplier')}</span>
                <select className="v2-select" value={f.supplier_counterparty_id} onChange={set('supplier_counterparty_id')}>
                  <option value="">—</option>
                  {(cps.data?.counterparties || []).map((c) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
                </select></label>
              <label className="v2-field"><span className="v2-field-label">{t('addAsset.location')}</span>
                <input className="v2-input" value={f.location} onChange={set('location')} maxLength={200} /></label>
            </div>
            {fits.length > 1 && (
              <label className="v2-field"><span className="v2-field-label">{t('addAsset.group')}</span>
                <select className="v2-select" value={f.asset_group} onChange={set('asset_group')}>
                  <option value="">—</option>
                  {fits.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
                </select></label>
            )}
            <p className="v2-muted v2-small">{group
              ? t('addAsset.lifeFromRule', { group: group.label, n: group.useful_life_months, rule: group.rule_code || '' })
              : groups.length ? t('addAsset.lifePick') : t('addAsset.noRule')}</p>
          </Card>
        </div>
        <aside className="v2-col">
          <Card title={t('addAsset.docsFor', { type: t(`addAsset.t.${f.asset_type}`) })}>
            <ul className="v2-check">
              {t(`addAsset.docs.${f.asset_type}`).split('|').map((d) => (
                <li key={d}><span className="v2-check-mark" aria-hidden="true" /><span className="v2-check-text"><span>{d}</span></span><Link to="/business/documents">{t('bill.upload')}</Link></li>
              ))}
            </ul>
            <p className="v2-muted v2-small">{t('addAsset.docsNote')}</p>
          </Card>
        </aside>
      </div>
      {upload && <DocumentIntakeModal business={active} uploadSource="invoice_upload" defaultType="invoice" onClose={() => setUpload(false)} onUploaded={() => {}} />}
    </div>
  )
}
