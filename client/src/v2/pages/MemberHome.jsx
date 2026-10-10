// Manager / employee home (design w2/I1) — replaces the v1 MemberTutorial in v2.
// These roles do not see company finances (the server answers 403 on Pulse, accounts, etc.);
// they send requests the owner approves:
//   • a supplier bill (manager only): BillDialog → POST /api/debts → approval_status pending_approval
//   • an expense / advance report: POST /api/debts (payable to the submitter, pending approval) and
//     the receipt uploaded to Document Center and linked to it.
// "My requests": GET /api/debts — for these roles the server returns only what they created.
// Telegram: GET /api/team/onboarding/me gives the personal deep link to the bot.
import { useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { PageHead, Card, Pill, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate } from '../lib/format'
import Modal from '../components/Modal'
import BillDialog from '../components/BillDialog'
import { createBill, uploadReceiptFile, linkDocument } from '../lib/actions'

const num = (v) => { const n = Number(String(v ?? '').replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const today = () => new Date().toISOString().slice(0, 10)

/** One request's state for the person who sent it. */
export function requestState(d) {
  if (d.approval_status === 'rejected' || d.status === 'cancelled') return { key: 'rejected', tone: 'crit', note: d.rejected_reason || null }
  if (d.approval_status === 'pending_approval') return d.info_request_note ? { key: 'needsInfo', tone: 'warn', note: d.info_request_note } : { key: 'pending', tone: 'info', note: null }
  if (d.status === 'paid' || d.is_settled) return { key: 'paid', tone: 'good', note: null }
  return { key: 'approved', tone: 'good', note: null }
}

function ExpenseDialog({ me, onClose, onSaved }) {
  const t = useT()
  const { token } = useAuth()
  const [f, setF] = useState({ amount: '', date: today(), what: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef(null)
  const amount = num(f.amount)
  const save = async () => {
    if (!(amount > 0)) { setErr(t('mh.exp.errAmount')); return }
    if (!f.what.trim()) { setErr(t('mh.exp.errWhat')); return }
    setBusy(true); setErr('')
    try {
      const debt = await createBill(token, { type: 'payable', counterparty: me || t('mh.exp.me'), amount, currency: 'IDR', due_date: null,
        description: `${t('mh.exp.prefix')}: ${f.what.trim()} · ${f.date}`, scope: 'business' })
      if (file && debt?.id) {
        try { const doc = await uploadReceiptFile(token, file); if (doc?.document?.id) await linkDocument(token, doc.document.id, 'debt', debt.id) } catch { /* the request exists; the receipt can be sent again */ }
      }
      onSaved?.(); onClose()
    } catch (x) { setErr(x?.status === 403 ? t('dec.forbidden') : x?.data?.message || x?.data?.error || x?.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={t('mh.exp.title')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={save} data-mh-exp-save>{t('mh.exp.send')}</button></>}>
      <p className="v2-sec">{t('mh.exp.lead')}</p>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('mh.exp.amount')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('mh.exp.date')}</span>
          <input className="v2-input" type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t('mh.exp.what')}</span>
        <input className="v2-input" value={f.what} placeholder={t('mh.exp.whatPh')} onChange={(e) => setF({ ...f, what: e.target.value })} /></label>
      <div className="v2-setup-drop" role="button" tabIndex={0} onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}>
        <strong>{file ? file.name : t('mh.exp.receipt')}</strong>
        <span className="v2-muted v2-small">{t('mh.exp.receiptHint')}</span>
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden data-mh-exp-file onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </div>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}

export default function MemberHome() {
  const t = useT()
  const lang = useLang()
  const { user } = useAuth()
  const { active } = useWorkspace()
  const invalidate = useInvalidate()
  const reqs = useApi('/debts')
  const onb = useApi('/team/onboarding/me')
  const [dlg, setDlg] = useState(null)
  const role = active?.role
  const manager = role === 'manager'
  const profile = useApi('/me/profile')
  const name = profile.data?.profile?.display_name || profile.data?.profile?.name || user?.firstName || ''
  const list = (Array.isArray(reqs.data) ? reqs.data : reqs.data?.debts || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const saved = () => { invalidate(); reqs.reload() }
  const tile = (key, icon, onClick, href) => {
    const Ic = I[icon]
    const body = <><Ic size={22} /><span className="v2-mh-tile-text"><strong>{t(`mh.${key}.t`)}</strong><span className="v2-muted v2-small">{t(`mh.${key}.s`)}</span></span></>
    return href
      ? <a key={key} className="v2-mh-tile" href={href} target="_blank" rel="noreferrer" data-mh-tile={key}>{body}</a>
      : <button key={key} type="button" className="v2-mh-tile" onClick={onClick} data-mh-tile={key}>{body}</button>
  }
  return (
    <div className="v2-page">
      <PageHead title={name ? t('mh.hello', { name }) : t('mh.helloNo')} sub={t('mh.sub', { co: active?.name || '', role: role ? t(`set.role.${role}`) : '' })} />
      <div className="v2-mh-tiles">
        {manager && tile('bill', 'bills', () => setDlg('bill'))}
        {tile('exp', 'upload', () => setDlg('exp'))}
        {onb.data?.telegram_connected
          ? <div className="v2-mh-tile is-done" data-mh-tile="tg"><I.check size={22} /><span className="v2-mh-tile-text"><strong>{t('mh.tg.done')}</strong><span className="v2-muted v2-small">{t('mh.tg.s')}</span></span></div>
          : onb.data?.deep_link ? tile('tg', 'send', null, onb.data.deep_link) : null}
      </div>
      <Card title={t('mh.mine')}>
        {reqs.loading ? <Skeleton rows={4} />
          : reqs.error ? <ErrorBox error={reqs.error} onRetry={reqs.reload} />
          : !list.length ? <Empty icon={<I.bills size={28} />} title={t('mh.emptyT')} text={t(manager ? 'mh.emptyManager' : 'mh.emptyEmployee')} />
          : (
            <ul className="v2-moves" data-mh-list>
              {list.map((d) => {
                const st = requestState(d)
                return (
                  <li key={d.id} data-mh-req={st.key}>
                    <span className="v2-group-name"><strong>{d.description || d.counterparty || '—'}</strong>
                      <span className="v2-muted v2-small">{t('mh.sent', { d: d.created_at ? shortDate(String(d.created_at).slice(0, 10), lang) : '—' })}
                        {st.note ? ` · ${t(st.key === 'rejected' ? 'mh.why' : 'mh.asks', { note: st.note })}` : ''}</span></span>
                    <span className="v2-r"><span className="v2-num">{money(d.original_amount ?? d.amount, { currency: d.currency || 'IDR' })}</span>{' '}
                      <Pill tone={st.tone}>{t(`mh.st.${st.key}`)}</Pill></span>
                  </li>
                )
              })}
            </ul>
          )}
        <p className="v2-muted v2-small">{t(manager ? 'mh.noteManager' : 'mh.noteEmployee')}</p>
      </Card>
      {dlg === 'bill' && <BillDialog mode="payable" onClose={() => setDlg(null)} onSaved={saved} />}
      {dlg === 'exp' && <ExpenseDialog me={name} onClose={() => setDlg(null)} onSaved={saved} />}
    </div>
  )
}
