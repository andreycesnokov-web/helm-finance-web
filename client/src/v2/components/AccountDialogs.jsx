// Account windows (design w2/C2AccountDialogs): new account, edit, balance correction, archive,
// archived list with restore. Writes: lib/actions.js (createWallet, updateWallet, archiveWallet,
// adjustWalletBalance); the server checks the role (owner / CEO / admin / CFO) and locks the
// currency of an account that already has transactions.
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money, shortDate } from '../lib/format'
import Modal from './Modal'
import { createWallet, updateWallet, archiveWallet, adjustWalletBalance } from '../lib/actions'

const TYPES = ['bank', 'cash', 'ewallet', 'payment_gateway']
const CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR', 'MYR', 'THB', 'CNY', 'AUD', 'GBP', 'JPY']
const COLORS = ['blue', 'navy', 'green', 'amber', 'grey']
const today = () => new Date().toISOString().slice(0, 10)
const num = (v) => { const n = Number(String(v ?? '').replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }

function useRun(onDone) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn) => {
    setBusy(true); setErr('')
    try { const r = await fn(); onDone?.(r); return r }
    catch (x) {
      setErr(x?.status === 403 ? t('accd.noRights') : x?.data?.error === 'currency_locked' ? t('accd.curLocked') : (x?.data?.message || x?.data?.error || x?.message || t('set.err.generic')))
      return null
    } finally { setBusy(false) }
  }
  return { busy, err, run }
}

export function NewAccountDialog({ onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const [f, setF] = useState({ type: 'bank', name: '', currency: 'IDR', opening_balance: '', entity_name: '' })
  const { busy, err, run } = useRun(() => { onSaved?.(); onClose() })
  const ob = f.opening_balance === '' ? 0 : num(f.opening_balance)
  const ok = f.name.trim() && Number.isFinite(ob)
  return (
    <Modal title={t('accd.newTitle')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !ok}
          onClick={() => run(() => createWallet(token, { name: f.name.trim(), type: f.type, currency: f.currency, opening_balance: ob, entity_name: f.entity_name.trim() || null, scope: 'business' }))}>{t('accd.create')}</button></>}>
      <div className="v2-field"><span className="v2-field-label">{t('accd.type')}</span>
        <div className="v2-setup-chips">{TYPES.map((ty) => <button key={ty} type="button" className="v2-chip" aria-pressed={f.type === ty} onClick={() => setF({ ...f, type: ty })}>{t(`accd.types.${ty}`)}</button>)}</div></div>
      <label className="v2-field"><span className="v2-field-label">{t('accd.name')}</span>
        <input className="v2-input" value={f.name} placeholder={t('accd.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('accd.currency')}</span>
          <select className="v2-select" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="v2-field"><span className="v2-field-label">{t('accd.opening')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.opening_balance} placeholder="0" aria-invalid={!Number.isFinite(ob)} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} /></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t('accd.owner')}</span>
        <input className="v2-input" value={f.entity_name} placeholder="PT …" onChange={(e) => setF({ ...f, entity_name: e.target.value })} /></label>
      <p className="v2-muted v2-small">{t('accd.openingNote')}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

export function EditAccountDialog({ wallet, onClose, onSaved, onArchive }) {
  const t = useT()
  const { token } = useAuth()
  const [f, setF] = useState({ name: wallet.name || '', entity_name: wallet.entity_name || '', color: wallet.color || '' })
  const { busy, err, run } = useRun(() => { onSaved?.(); onClose() })
  return (
    <Modal title={wallet.name} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-ghost v2-mr-auto" onClick={onArchive}>{t('accd.archive')}</button>
        <button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !f.name.trim()}
          onClick={() => run(() => updateWallet(token, wallet.id, { name: f.name.trim(), entity_name: f.entity_name.trim() || null, color: f.color || null }))}>{t('set.save')}</button></>}>
      <label className="v2-field"><span className="v2-field-label">{t('accd.name')}</span><input className="v2-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="v2-field"><span className="v2-field-label">{t('accd.owner')}</span><input className="v2-input" value={f.entity_name} onChange={(e) => setF({ ...f, entity_name: e.target.value })} /></label>
      <label className="v2-field"><span className="v2-field-label">{t('accd.color')}</span>
        <select className="v2-select" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })}>
          <option value="">{t('accd.colorAuto')}</option>{COLORS.map((c) => <option key={c} value={c}>{t(`accd.colors.${c}`)}</option>)}
        </select></label>
      <p className="v2-muted v2-small">{t('accd.currencyFixed', { c: wallet.currency || 'IDR' })}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

export function AdjustBalanceDialog({ wallet, onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const [f, setF] = useState({ target: '', date: today(), reason: '' })
  const { busy, err, run } = useRun(() => { onSaved?.(); onClose() })
  const target = num(f.target)
  const ok = f.target !== '' && Number.isFinite(target) && f.reason.trim()
  const cur = wallet.currency || 'IDR'
  return (
    <Modal title={t('accd.adjTitle')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !ok}
          onClick={() => run(() => adjustWalletBalance(token, wallet.id, { target_balance: target, transaction_date: f.date, reason: f.reason.trim() }))}>{t('accd.adjCreate')}</button></>}>
      <p className="v2-sec">{t('accd.now', { name: wallet.name })} <strong className="v2-num">{money(wallet.balance, { currency: cur, full: true })}</strong></p>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('accd.bankBalance')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.target} aria-invalid={f.target !== '' && !Number.isFinite(target)} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('accd.onDate')}</span>
          <input className="v2-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t('accd.reason')}</span>
        <input className="v2-input" value={f.reason} placeholder={t('accd.reasonPh')} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      {Number.isFinite(target) && f.target !== '' && <p className="v2-small">{t('accd.diff', { v: money(target - Number(wallet.balance || 0), { currency: cur, sign: true, full: true }) })}</p>}
      <p className="v2-muted v2-small">{t('accd.adjNote')}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

export function ArchiveAccountDialog({ wallet, onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const { busy, err, run } = useRun(() => { onSaved?.(); onClose() })
  return (
    <Modal title={t('accd.archTitle', { name: wallet.name })} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => run(() => archiveWallet(token, wallet.id))}>{t('accd.archive')}</button></>}>
      <p className="v2-sec">{t('accd.archP')}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

export function ArchivedAccountsDialog({ onClose, onSaved }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const list = useApi('/wallets?archived=1')
  const { busy, err, run } = useRun(() => { list.reload(); onSaved?.() })
  const rows = list.data?.wallets || []
  return (
    <Modal title={t('accd.archived')} onClose={onClose} footer={<button type="button" className="v2-btn v2-btn-primary" onClick={onClose}>{t('set.ok')}</button>}>
      {list.loading ? <p className="v2-muted">…</p> : rows.length === 0 ? <p className="v2-muted">{t('accd.noArchived')}</p> : (
        <ul className="v2-set-cats">{rows.map((w) => (
          <li key={w.id}><span>{w.name} <span className="v2-muted v2-small">· {t('accd.since', { d: shortDate(w.updated_at, lang) })}</span></span>
            <button type="button" className="v2-btn-link v2-small" disabled={busy} onClick={() => run(() => updateWallet(token, w.id, { is_active: true }))}>{t('set.books.restore')}</button></li>
        ))}</ul>
      )}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}
