// The transaction window (design w2/D1) — opened by a row in Transactions; replaces the classic
// list with editing. PATCH /api/transactions/:id through lib/actions (updateTransaction); the
// server refuses amount / account / date changes for statement rows and bill payments.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useT, useLang } from '../i18n'
import { money, shortDate } from '../lib/format'
import { txSource, txDate } from '../lib/obligations'
import Modal from './Modal'
import { updateTransaction } from '../lib/actions'
import { catLabel } from '../lib/categoryLabel'

const DIR_IN = ['income']
export default function TransactionDialog({ tx, wallets = [], categories = [], onClose, onSaved }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const src = txSource(tx)
  const locked = src === 'bank' || src === 'opening'
  const isIn = DIR_IN.includes(tx.type)
  const cur = tx.currency_original || 'IDR'
  const [f, setF] = useState({
    description: tx.description || '', category: tx.category || '', wallet_id: tx.wallet_id ? String(tx.wallet_id) : '',
    date: String(txDate(tx) || '').slice(0, 10), amount: String(tx.amount_original ?? ''),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sameCcy = wallets.filter((w) => String(w.currency || 'IDR') === cur)
  const cats = categories.filter((c) => c.group_type === (isIn ? 'inflow' : 'outflow'))
  const save = async () => {
    setBusy(true); setErr('')
    const body = {}
    if (f.description !== (tx.description || '')) body.description = f.description || null
    if (f.category !== (tx.category || '')) body.category = f.category || null
    if (!locked) {
      if (f.wallet_id && f.wallet_id !== String(tx.wallet_id || '')) body.wallet_id = f.wallet_id
      if (f.date && f.date !== String(txDate(tx) || '').slice(0, 10)) body.transaction_date = f.date
      if (f.amount !== '' && Number(f.amount) !== Number(tx.amount_original)) body.amount = Number(f.amount)
    }
    if (!Object.keys(body).length) { onClose(); return }
    try { await updateTransaction(token, tx.id, body); onSaved?.(); onClose() }
    catch (x) {
      const code = x?.data?.error
      setErr(code === 'statement_transaction_locked' ? t('txd.locked') : code === 'debt_payment_amount_immutable' ? t('txd.billLocked')
        : x?.status === 403 ? t('accd.noRights') : (x?.data?.message || code || x?.message))
    } finally { setBusy(false) }
  }
  return (
    <Modal title={`${t(`tx.type.${tx.type}`) !== `tx.type.${tx.type}` ? t(`tx.type.${tx.type}`) : tx.type} · ${t(`tx.src.${src}`)} · ${shortDate(txDate(tx), lang)}`} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={save}>{t('set.save')}</button></>}>
      <p className={`v2-stat-mid v2-num ${isIn ? 'v2-pos' : ''}`}>{isIn ? '+' : '−'} {money(tx.amount_original, { currency: cur, full: true })}</p>
      <label className="v2-field"><span className="v2-field-label">{t('txd.desc')}</span>
        <input className="v2-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label className="v2-field"><span className="v2-field-label">{t('tx.col.category')}</span>
        <select className="v2-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">{t('imp.choose')}</option>
          {cats.map((c) => <option key={c.id} value={c.name}>{catLabel(t, c.name)}</option>)}
          {f.category && !cats.some((c) => c.name === f.category) && <option value={f.category}>{catLabel(t, f.category)}</option>}
        </select></label>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('tx.col.account')}</span>
          <select className="v2-select" value={f.wallet_id} disabled={locked} onChange={(e) => setF({ ...f, wallet_id: e.target.value })}>
            {!f.wallet_id && <option value="">—</option>}
            {sameCcy.map((w) => <option key={w.id} value={String(w.id)}>{w.name} · {w.currency || 'IDR'}</option>)}
          </select>
          <span className="v2-muted v2-small">{t('txd.sameCcy')}</span></label>
        <label className="v2-field"><span className="v2-field-label">{t('txd.date')}</span>
          <input className="v2-input" type="date" value={f.date} disabled={locked} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('radar.col.amount')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.amount} disabled={locked} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      </div>
      <p className="v2-small">{t('txd.docs')} <Link to="/business/documents?tab=look">{t('txd.attach')}</Link></p>
      {locked && <p className="v2-muted v2-small">{t(src === 'opening' ? 'txd.openingNote' : 'txd.bankNote')}</p>}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}
