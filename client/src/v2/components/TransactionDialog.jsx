// The transaction window (design w2/D1) — opened by a row in Transactions; replaces the classic
// list with editing. PATCH /api/transactions/:id through lib/actions (updateTransaction); the
// server refuses amount / account / date changes for statement rows and bill payments.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBusinessRequest } from '../lib/useBusinessRequest'
import { useT, useLang } from '../i18n'
import { money, shortDate } from '../lib/format'
import { txSource, txDate } from '../lib/obligations'
import Modal from './Modal'
import { updateTransaction, classifyOperation } from '../lib/actions'
import { useApi } from '../data'

// Business purpose for the management view (never a tax decision). '' = not set: the category decides.
const PURPOSES = ['operating', 'personal', 'capital', 'non_pnl', 'needs_review']
import { catLabel } from '../lib/categoryLabel'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { canRecordCompanyMoney } from '../lib/financePermissions'

const DIR_IN = ['income']
export default function TransactionDialog({ tx, wallets = [], categories = [], initialCategory = null, onClose, onSaved }) {
  const t = useT()
  const lang = useLang()
  const request = useBusinessRequest()
  const { active } = useWorkspace()
  const canWrite = canRecordCompanyMoney(active?.role)
  const src = txSource(tx)
  const locked = src === 'bank' || src === 'opening'
  const isIn = DIR_IN.includes(tx.type)
  const cur = tx.currency_original || 'IDR'
  const [f, setF] = useState({
    description: tx.description || '', category: isIn && categories.some(c=>c.name===initialCategory)?initialCategory:tx.category || '', wallet_id: tx.wallet_id ? String(tx.wallet_id) : '',
    date: String(txDate(tx) || '').slice(0, 10), amount: String(tx.amount_original ?? ''),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Accounting preparation marks (GET /api/transaction-classifications): purpose, note, accountant review.
  const clsApi = useApi('/transaction-classifications')
  const cls = clsApi.data?.classifications?.find((c) => c.transaction_id === String(tx.id)) || null
  const clsOn = clsApi.data?.available === true
  const [cf, setCf] = useState({ purpose: '', note: '', reviewed: false })
  useEffect(() => { setCf({ purpose: cls?.business_purpose || '', note: cls?.note || '', reviewed: !!cls?.accountant_reviewed_at }) },
    [cls?.business_purpose, cls?.note, cls?.accountant_reviewed_at])
  const sameCcy = wallets.filter((w) => String(w.currency || 'IDR') === cur)
  const cats = categories.filter((c) => c.group_type === (isIn ? 'inflow' : 'outflow'))
  const save = async () => {
    if (!canWrite || !request.isCurrent() || busy) return
    setBusy(true); setErr('')
    const body = {}
    if (f.description !== (tx.description || '')) body.description = f.description || null
    if (f.category !== (tx.category || '')) body.category = f.category || null
    if (!locked) {
      if (f.wallet_id && f.wallet_id !== String(tx.wallet_id || '')) body.wallet_id = f.wallet_id
      if (f.date && f.date !== String(txDate(tx) || '').slice(0, 10)) body.transaction_date = f.date
      if (f.amount !== '' && Number(f.amount) !== Number(tx.amount_original)) body.amount = Number(f.amount)
    }
    // Only what changed; the review mark is sent only by a role that may set it.
    const clsBody = {}
    if (clsOn && clsApi.data?.can_classify) {
      if (cf.purpose !== (cls?.business_purpose || '')) clsBody.business_purpose = cf.purpose || null
      if ((cf.note.trim() || null) !== (cls?.note || null)) clsBody.note = cf.note.trim() || null
    }
    if (clsOn && clsApi.data?.can_review && cf.reviewed !== !!cls?.accountant_reviewed_at) clsBody.accountant_reviewed = cf.reviewed
    if (!Object.keys(body).length && !Object.keys(clsBody).length) { onClose(); return }
    if (Object.keys(body).length && tx.balance_version == null) { setErr(t('txd.reloadFirst')); setBusy(false); return }
    if (Object.keys(body).length) body.expected_version = tx.balance_version
    try {
      if (Object.keys(body).length) await updateTransaction(request, tx.id, body)
      if (Object.keys(clsBody).length) await classifyOperation(request, tx.id, clsBody)
      clsApi.reload?.(); onSaved?.(); onClose()
    }
    catch (x) {
      const code = x?.data?.error
      setErr(code === 'statement_transaction_locked' ? t('txd.locked') : code === 'debt_payment_amount_immutable' ? t('txd.billLocked')
        : x?.status === 403 ? t('accd.noRights') : (x?.data?.message || code || x?.message))
    } finally { setBusy(false) }
  }
  return (
    <Modal title={`${t(`tx.type.${tx.type}`) !== `tx.type.${tx.type}` ? t(`tx.type.${tx.type}`) : tx.type} · ${t(`tx.src.${src}`)} · ${shortDate(txDate(tx), lang)}`} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !canWrite} onClick={save}>{t('set.save')}</button></>}>
      <p className={`v2-stat-mid v2-num ${isIn ? 'v2-pos' : ''}`}>{isIn ? '+' : '−'} {money(tx.amount_original, { currency: cur, full: true })}</p>
      <label className="v2-field"><span className="v2-field-label">{t('txd.desc')}</span>
        <input className="v2-input" value={f.description} disabled={!canWrite} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label className="v2-field"><span className="v2-field-label">{t('tx.col.category')}</span>
        <select className="v2-select" value={f.category} disabled={!canWrite} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">{t('imp.choose')}</option>
          {cats.map((c) => <option key={c.id} value={c.name}>{catLabel(t, c.name)}</option>)}
          {f.category && !cats.some((c) => c.name === f.category) && <option value={f.category}>{catLabel(t, f.category)}</option>}
        </select></label>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('tx.col.account')}</span>
          <select className="v2-select" value={f.wallet_id} disabled={locked || !canWrite} onChange={(e) => setF({ ...f, wallet_id: e.target.value })}>
            {!f.wallet_id && <option value="">—</option>}
            {sameCcy.map((w) => <option key={w.id} value={String(w.id)}>{w.name} · {w.currency || 'IDR'}</option>)}
          </select>
          <span className="v2-muted v2-small">{t('txd.sameCcy')}</span></label>
        <label className="v2-field"><span className="v2-field-label">{t('txd.date')}</span>
          <input className="v2-input" type="date" value={f.date} disabled={locked || !canWrite} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('radar.col.amount')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.amount} disabled={locked || !canWrite} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      </div>
      <p className="v2-small">{t('txd.docs')} <Link to="/business/documents?tab=look">{t('txd.attach')}</Link></p>
      {clsOn && (
        <fieldset className="v2-field v2-txd-acc" data-txd-accounting>
          <legend className="v2-h3">{t('txd.acc.title')}</legend>
          <label className="v2-field"><span className="v2-field-label">{t('txd.acc.purpose')}</span>
            <select className="v2-select" value={cf.purpose} disabled={!clsApi.data?.can_classify} onChange={(e) => setCf({ ...cf, purpose: e.target.value })} data-txd-purpose>
              <option value="">{t('txd.acc.fromCategory')}</option>
              {PURPOSES.map((p) => <option key={p} value={p}>{t(`txd.acc.p.${p}`)}</option>)}
            </select></label>
          <label className="v2-field"><span className="v2-field-label">{t('txd.acc.note')}</span>
            <input className="v2-input" maxLength={500} value={cf.note} disabled={!clsApi.data?.can_classify} onChange={(e) => setCf({ ...cf, note: e.target.value })} data-txd-note /></label>
          <label className="v2-pe-sug-row">
            <input type="checkbox" checked={cf.reviewed} disabled={!clsApi.data?.can_review} onChange={(e) => setCf({ ...cf, reviewed: e.target.checked })} data-txd-reviewed />
            <span>{t('txd.acc.reviewed')}{cls?.accountant_reviewed_at ? ` · ${t('txd.acc.reviewedBy', { who: cls.accountant_reviewed_by_name || '—', d: shortDate(cls.accountant_reviewed_at, lang) })}` : ''}</span></label>
          <p className="v2-muted v2-small">{t('txd.acc.taxNote')}</p>
        </fieldset>
      )}
      {locked && <p className="v2-muted v2-small">{t(src === 'opening' ? 'txd.openingNote' : 'txd.bankNote')}</p>}
      {!canWrite && <p className="v2-muted v2-small">{t('accd.noRights')}</p>}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}
