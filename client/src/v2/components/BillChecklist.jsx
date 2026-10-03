// Bill detail → Documents: the 4-item checklist (designs/BillDetail.dc.html).
//   invoice  attached to the bill (existing attachments)
//   proof    the bill is paid and the payment is linked (existing fields)
//   slip     the bukti potong — only when the verified engine computed a withholding (P-05)
//   check    an accountant has checked the bill (P-05)
// The two P-05 marks are set with PATCH /api/debts/:id/checklist (accountant role and above,
// audited, slip must be a bukti potong of this business). "Nothing closes on its own":
// setting them never pays, settles or approves anything.
// Before migration 061 the debt rows carry no such columns → the rows say "not tracked here
// yet", exactly as in batch 3.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useApi, useInvalidate } from '../data'
import { updateBillChecklist, actionError } from '../lib/actions'
import { checklistTracked } from '../lib/accounting'
import { billChecklistItems as checklistItems } from '../lib/obligations'
import { shortDate } from '../lib/format'
import { useT, useLang } from '../i18n'
import { Card } from '../ui'
import I from '../icons'

export default function BillChecklist({ d, hasInvoice, paid, slipNeeded }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const items = checklistItems(d, { hasInvoice, paid, slipNeeded })
  const tracked = checklistTracked(d)
  const [picking, setPicking] = useState(false)
  const [slip, setSlip] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // Only fetched while choosing a slip; GET /api/documents is the Document Center list.
  const slips = useApi(picking ? '/documents?type=bukti_potong' : null)
  const slipList = slips.data?.documents || []

  const run = async (body) => {
    setBusy(true); setErr(null)
    try {
      await updateBillChecklist(token, d.id, body)
      setPicking(false); setSlip(''); invalidate()
    } catch (x) {
      const code = actionError(x)
      setErr(code === 'forbidden' ? t('bill.ck.forbidden') : code === 'notApplied' ? t('bill.ck.notApplied') : (x?.data?.error ? t(`bill.ck.err.${x.data.error}`, {}) : code))
    } finally { setBusy(false) }
  }

  const sub = (c) => {
    if (c.key === 'proof') return t('bill.doc.proofSub')
    if (c.unknown) return [c.key === 'slip' ? t('bill.doc.slipSub') : null, t('bill.doc.notTracked')].filter(Boolean).join(' · ')
    if (c.key === 'slip') return c.done ? t('bill.ck.slipOnFile') : t('bill.doc.slipSub')
    if (c.key === 'check') return c.done ? t('bill.ck.checkedOn', { d: shortDate(d.accountant_checked_at, lang) }) : t('bill.ck.notChecked')
    return null
  }

  const action = (c) => {
    if (c.link) return <Link to={c.link}>{t('bill.view')}</Link>
    if (c.unknown) return null
    if (c.key === 'slip') {
      if (c.done) return <button type="button" className="v2-linkbtn" disabled={busy} onClick={() => run({ withholding_slip_document_id: null })}>{t('bill.ck.remove')}</button>
      return <button type="button" className="v2-linkbtn" disabled={busy} aria-expanded={picking} onClick={() => setPicking((x) => !x)}>{t('bill.ck.attach')}</button>
    }
    if (c.key === 'check') {
      return <button type="button" className="v2-linkbtn" disabled={busy} onClick={() => run({ accountant_checked: !c.done })}>{c.done ? t('bill.ck.undo') : t('bill.ck.mark')}</button>
    }
    return !c.done ? <Link to="/business/documents">{t('bill.upload')}</Link> : null
  }

  return (
    <Card title={t('bill.documents')} aside={t('bill.docCount', { n: items.filter((c) => c.done).length, m: items.length })}>
      <ul className="v2-check">
        {items.map((c) => (
          <li key={c.key} className={c.done ? 'is-done' : ''}>
            <span className="v2-check-mark" aria-hidden="true">{c.done ? <I.check size={14} /> : null}</span>
            <span className="v2-check-text">
              <span>{t(`bill.doc.${c.key}`)}<span className="v2-sr"> — {c.done ? t('bill.doc.have') : c.unknown ? t('bill.doc.notTracked') : t('bill.doc.missing')}</span></span>
              {sub(c) && <span className="v2-muted v2-small">{sub(c)}</span>}
            </span>
            {action(c)}
          </li>
        ))}
      </ul>
      {picking && (
        <form className="v2-decide-form" onSubmit={(e) => { e.preventDefault(); if (slip) run({ withholding_slip_document_id: slip }) }}>
          {slips.loading ? <p className="v2-muted v2-small">…</p> : slipList.length === 0 ? (
            <p className="v2-muted v2-small">{t('bill.ck.noSlips')} <Link to="/business/documents">{t('bill.upload')}</Link></p>
          ) : (
            <label className="v2-field">
              <span className="v2-field-label">{t('bill.ck.choose')}</span>
              <select className="v2-select" value={slip} onChange={(e) => setSlip(e.target.value)}>
                <option value="">—</option>
                {slipList.map((x) => (
                  <option key={x.id} value={x.id}>{[x.document_number, x.document_date ? shortDate(x.document_date, lang) : null, x.file?.file_name].filter(Boolean).join(' · ') || x.id.slice(0, 8)}</option>
                ))}
              </select>
            </label>
          )}
          <div className="v2-decide-row">
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => { setPicking(false); setSlip('') }} disabled={busy}>{t('dec.cancel')}</button>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !slip}>{t('bill.ck.attach')}</button>
          </div>
        </form>
      )}
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
      <p className="v2-muted v2-small">{t('bill.closeNote')}{!tracked && ` ${t('bill.ck.pending')}`}</p>
    </Card>
  )
}
