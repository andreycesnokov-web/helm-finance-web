// Money windows in the v2 look — replace the v1 BusinessWalletTransferModal and DebtPaymentModal.
// Transfer: POST /api/wallets/transfer (atomic RPC on the server, both legs in one go; a transfer
// is never income or expense). Mark a bill paid / received: POST /api/debts/:id/pay with an
// idempotency key (a double click books one payment), and before it the AI CFO check
// POST /api/decisions/debts/:id/payment (a simulation — nothing is written). The account may not
// go below zero: a payment or transfer larger than the account balance is refused here.
import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useT } from '../i18n'
import { money } from '../lib/format'
import Modal from './Modal'
import { transferBetweenWallets, checkBillPayment, payBill } from '../lib/actions'

const num = (v) => { const n = Number(String(v ?? '').replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const today = () => new Date().toISOString().slice(0, 10)
const key = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const cur = (w) => String(w?.currency || 'IDR').toUpperCase()
const errText = (t, x) => (x?.status === 403 ? t('dec.forbidden') : x?.data?.message || x?.data?.error || x?.message)

export function TransferDialog({ wallets = [], onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const list = wallets.filter((w) => w.is_active !== false)
  const [from, setFrom] = useState(String(list[0]?.id || ''))
  const [to, setTo] = useState(String(list[1]?.id || ''))
  const [amount, setAmount] = useState('')
  const [got, setGot] = useState('')
  const [date, setDate] = useState(today())
  const [desc, setDesc] = useState('')
  const [id] = useState(key)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const a = list.find((w) => String(w.id) === from)
  const b = list.find((w) => String(w.id) === to)
  const fx = a && b && cur(a) !== cur(b)
  const n = num(amount)
  const over = a && n > 0 && n > Number(a.balance || 0) + 0.005
  const save = async () => {
    if (!a || !b || from === to) { setErr(t('xfer.err.same')); return }
    if (!(n > 0)) { setErr(t('xfer.err.amount')); return }
    if (over) { setErr(t('xfer.err.over', { v: money(a.balance, { currency: cur(a), full: true }) })); return }
    setBusy(true); setErr('')
    try {
      await transferBetweenWallets(token, { from_wallet_id: a.id, to_wallet_id: b.id, amount: n, target_amount: fx && num(got) > 0 ? num(got) : undefined,
        date, description: desc.trim() || undefined, transfer_id: id })
      onSaved?.(); onClose()
    } catch (x) { setErr(errText(t, x)) } finally { setBusy(false) }
  }
  const opt = (w) => <option key={w.id} value={String(w.id)}>{w.name} · {cur(w)} · {money(w.balance, { currency: cur(w), full: true })}</option>
  return (
    <Modal title={t('xfer.title')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || list.length < 2} onClick={save} data-xfer-save>{t('xfer.save')}</button></>}>
      <p className="v2-sec">{t('xfer.lead')}</p>
      {list.length < 2 && <div className="v2-banner v2-tone-warn"><span className="v2-banner-text">{t('xfer.needTwo')}</span></div>}
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('xfer.from')}</span>
          <select className="v2-select" value={from} onChange={(e) => { setFrom(e.target.value); setErr('') }}>{list.map(opt)}</select></label>
        <label className="v2-field"><span className="v2-field-label">{t('xfer.to')}</span>
          <select className="v2-select" value={to} onChange={(e) => { setTo(e.target.value); setErr('') }}><option value="">—</option>{list.filter((w) => String(w.id) !== from).map(opt)}</select></label>
      </div>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('xfer.amount', { c: cur(a) })}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={amount} aria-invalid={over || (amount !== '' && !(n > 0))} onChange={(e) => { setAmount(e.target.value); setErr('') }} /></label>
        {fx && <label className="v2-field"><span className="v2-field-label">{t('xfer.got', { c: cur(b) })}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={got} placeholder={t('xfer.gotPh')} onChange={(e) => setGot(e.target.value)} /></label>}
        <label className="v2-field"><span className="v2-field-label">{t('xfer.date')}</span>
          <input className="v2-input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t('txd.desc')}</span>
        <input className="v2-input" value={desc} placeholder={t('xfer.descPh')} onChange={(e) => setDesc(e.target.value)} /></label>
      {fx && <p className="v2-muted v2-small">{t('xfer.fx', { a: cur(a), b: cur(b) })}</p>}
      {over && <p className="v2-inline-err" role="alert">{t('xfer.err.over', { v: money(a.balance, { currency: cur(a), full: true }) })}</p>}
      {err && !over && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

// The AI CFO check names its reasons by key; the server label is English, so known keys are shown in the app language.
const FACTORS = ['no_burn', 'exceeds_cash', 'wallet_negative', 'runway_critical', 'runway_low', 'large_payment', 'payroll_pressure', 'below_reserve', 'tax_obligation_pressure']
const REC_TONE = { safe: 'good', caution: 'warn', not_recommended: 'crit', insufficient_data: 'neutral' }

export function PayBillDialog({ debt, accounts = [], onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const income = debt.type === 'receivable'
  const c = String(debt.currency || 'IDR').toUpperCase()
  const total = Number(debt.original_amount || debt.amount || 0)
  const paidBefore = Number(debt.paid_amount || 0)
  const left = Number(debt.remaining_amount ?? Math.max(0, total - paidBefore))
  const same = accounts.filter((w) => w.is_active !== false && cur(w) === c)
  const [amount, setAmount] = useState(String(left || ''))
  const [walletId, setWalletId] = useState(same.length === 1 ? String(same[0].id) : '')
  const [date, setDate] = useState(today())
  const [id] = useState(key)
  const [sim, setSim] = useState(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const n = num(amount)
  const w = same.find((x) => String(x.id) === walletId)
  const full = n >= left - 0.01
  const over = !income && w && n > Number(w.balance || 0) + 0.005
  useEffect(() => {
    if (!walletId || !(n > 0)) { setSim(null); return }
    let off = false
    const h = setTimeout(() => { checkBillPayment(token, debt.id, { amount: n, wallet_id: walletId, payment_date: date }).then((r) => { if (!off) setSim(r) }).catch(() => { if (!off) setSim(null) }) }, 350)
    return () => { off = true; clearTimeout(h) }
  }, [walletId, n, date, debt.id, token])
  const risky = sim?.recommendation === 'not_recommended'
  const ok = n > 0 && n <= left + 0.01 && !!w && !over && (!risky || ack)
  const save = async () => {
    if (!ok) return
    setBusy(true); setErr('')
    try {
      const r = await payBill(token, debt.id, id, { amount: n, wallet_id: w.id, account: w.name, date, idempotency_key: id })
      onSaved?.(r); onClose()
    } catch (x) { setErr(errText(t, x)) } finally { setBusy(false) }
  }
  const runway = (d) => (d == null ? '—' : d >= 999 ? '∞' : t('payb.days', { n: d }))
  return (
    <Modal title={t(income ? 'payb.titleIn' : 'payb.titleOut')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || !ok} onClick={save} data-payb-save>
          {t(full ? (income ? 'payb.markIn' : 'payb.markOut') : 'payb.partial', { v: money(n > 0 ? n : 0, { currency: c, full: true }) })}</button></>}>
      <p className="v2-sec"><strong>{debt.counterparty || '—'}</strong>{debt.description ? ` · ${debt.description}` : ''}</p>
      <dl className="v2-kv">
        <div><dt>{t('payb.total')}</dt><dd className="v2-num">{money(total, { currency: c, full: true })}</dd></div>
        {paidBefore > 0 && <div><dt>{t(income ? 'payb.gotBefore' : 'payb.paidBefore')}</dt><dd className="v2-num">{money(paidBefore, { currency: c, full: true })}</dd></div>}
        <div><dt>{t('payb.left')}</dt><dd className="v2-num"><strong>{money(left, { currency: c, full: true })}</strong></dd></div>
      </dl>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('payb.amount', { c })}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={amount} aria-invalid={amount !== '' && (!(n > 0) || n > left + 0.01)} onChange={(e) => { setAmount(e.target.value); setErr('') }} />
          <span className="v2-seg v2-payb-pct">{[25, 50, 100].map((p) => <button key={p} type="button" className="v2-seg-btn" onClick={() => setAmount(String(Math.round((left * p) / 100)))}>{p}%</button>)}</span></label>
        <label className="v2-field"><span className="v2-field-label">{t('payb.date')}</span>
          <input className="v2-input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t(income ? 'payb.into' : 'payb.from')}</span>
        <select className="v2-select" value={walletId} onChange={(e) => { setWalletId(e.target.value); setErr('') }}>
          <option value="">{t('payb.pick')}</option>
          {same.map((x) => <option key={x.id} value={String(x.id)}>{x.name} · {money(x.balance, { currency: c, full: true })}</option>)}
        </select>
        {!same.length && <span className="v2-inline-err">{t('payb.noAcc', { c })}</span>}</label>
      {n > left + 0.01 && <p className="v2-inline-err" role="alert">{t('payb.tooMuch', { v: money(left, { currency: c, full: true }) })}</p>}
      {over && <p className="v2-inline-err" role="alert">{t('xfer.err.over', { v: money(w.balance, { currency: c, full: true }) })}</p>}
      {sim && (
        <div className={`v2-banner v2-tone-${REC_TONE[sim.recommendation] || 'neutral'}`} role="status" data-payb-sim={sim.recommendation}>
          <span className="v2-banner-text"><strong>AI CFO · {t(`payb.rec.${sim.recommendation || 'insufficient_data'}`)}</strong><br />
            {sim.current?.wallet_balance != null && <>{w?.name}: {money(sim.current.wallet_balance, { full: true })} → <strong>{money(sim.after?.wallet_balance, { full: true })}</strong> · </>}
            {t('payb.runway')}: {runway(sim.current?.runway_days)} → <strong>{runway(sim.after?.runway_days)}</strong>
            {(sim.factors || []).filter((f) => ['high', 'critical', 'medium'].includes(f.severity)).slice(0, 2).map((f, i) => <span key={i}><br />• {FACTORS.includes(f.key) ? t(`payb.f.${f.key}`, { w: w?.name || '' }) : f.label}</span>)}</span>
        </div>
      )}
      {risky && <label className="v2-pe-sug-row"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{t('payb.ack')}</span></label>}
      <p className="v2-muted v2-small">{t(full ? (income ? 'payb.fullIn' : 'payb.fullOut') : 'payb.partialNote', { v: money(Math.max(0, left - (n || 0)), { currency: c, full: true }) })}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}
