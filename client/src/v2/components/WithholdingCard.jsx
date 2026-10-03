// Bill detail → Tax withheld (batch 10, DECISIONS.md final decisions item 5).
// Shows the withholding records of this bill (GET /api/withholding-slips, read-only) and lets
// an accountant record one with POST /api/debts/:id/withholding:
//   receivable  the customer paid us net of PPh 23 — the withheld part is a tax prepayment
//   payable     we withheld from the supplier
// The server lowers the remaining balance by the withheld amount; no money moves and
// nothing is paid. When the settlement log blocks it, the server's message is shown as is.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useApi, useInvalidate } from '../data'
import { recordWithholding, actionError } from '../lib/actions'
import { money, shortDate } from '../lib/format'
import { useT, useLang } from '../i18n'
import { Card, Pill, Btn } from '../ui'

const TYPES = ['pph_23', 'pph_4_2', 'pph_21', 'pph_26', 'pph_22', 'other']

export default function WithholdingCard({ d }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const slips = useApi('/withholding-slips')
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ amount: '', tax_type: 'pph_23', slip: '' })
  const docs = useApi(open ? '/documents?type=bukti_potong' : null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const records = slips.data?.by_debt?.[String(d.id)]?.records || []
  const recv = d.type === 'receivable'
  const isOpen = !['paid', 'cancelled'].includes(d.status) && d.approval_status !== 'pending_approval' && d.approval_status !== 'rejected'
  if (slips.data?.available === false && !records.length) return null

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await recordWithholding(token, d.id, { amount: f.amount, tax_type: f.tax_type, bukti_potong_document_id: f.slip || null })
      setOpen(false); setF({ amount: '', tax_type: 'pph_23', slip: '' }); invalidate()
    } catch (x) {
      const code = actionError(x)
      setErr(code === 'forbidden' ? t('wh.forbidden') : x?.data?.error === 'exceeds_remaining' ? t('wh.exceeds', { v: money(x.data.remaining) }) : (x?.data?.message || code))
    } finally { setBusy(false) }
  }

  return (
    <Card title={t(recv ? 'wh.titleIn' : 'wh.titleOut')} aside={d.withholding_waiting_slip ? <Pill tone="warn">{t('wh.waiting')}</Pill> : null}>
      <p className="v2-muted v2-small">{t(recv ? 'wh.hintIn' : 'wh.hintOut')}</p>
      {records.length > 0 && (
        <ul className="v2-moves">
          {records.map((r) => (
            <li key={r.id}><span>{t(`wh.type.${r.tax_type || 'other'}`)} · {r.bukti_potong_document_id ? t('wh.slipIn') : t('wh.waiting')}</span>
              <span className="v2-num">{money(r.withholding_amount)}</span></li>
          ))}
        </ul>
      )}
      {open ? (
        <form className="v2-decide-form" onSubmit={save}>
          <div className="v2-field-row">
            <label className="v2-field">
              <span className="v2-field-label">{t('wh.amount')}</span>
              <input className="v2-input" type="number" inputMode="decimal" min="0.01" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <span className="v2-muted v2-small">{t('wh.max', { v: money(d.remaining_amount ?? 0) })}</span>
            </label>
            <label className="v2-field">
              <span className="v2-field-label">{t('wh.taxType')}</span>
              <select className="v2-select" value={f.tax_type} onChange={(e) => setF({ ...f, tax_type: e.target.value })}>
                {TYPES.map((k) => <option key={k} value={k}>{t(`wh.type.${k}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="v2-field">
            <span className="v2-field-label">{t('wh.slip')}</span>
            <select className="v2-select" value={f.slip} onChange={(e) => setF({ ...f, slip: e.target.value })}>
              <option value="">{t('wh.slipLater')}</option>
              {(docs.data?.documents || []).map((x) => (
                <option key={x.id} value={x.id}>{[x.document_number, x.document_date ? shortDate(x.document_date, lang) : null, x.file?.file_name].filter(Boolean).join(' · ') || x.id.slice(0, 8)}</option>
              ))}
            </select>
          </label>
          <p className="v2-muted v2-small">{t('wh.note')}</p>
          <div className="v2-decide-row">
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setOpen(false)} disabled={busy}>{t('dec.cancel')}</button>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !(Number(f.amount) > 0)}>{t('wh.save')}</button>
          </div>
        </form>
      ) : isOpen ? <Btn onClick={() => setOpen(true)}>{t(recv ? 'wh.recordIn' : 'wh.recordOut')}</Btn> : null}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
      {records.some((r) => !r.bukti_potong_document_id) && <p className="v2-muted v2-small">{t('wh.slipWhere')} <Link to="/business/documents">{t('nav.documents')}</Link></p>}
    </Card>
  )
}
