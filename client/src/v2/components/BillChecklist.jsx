// Bill detail → Documents: the 4-item checklist (designs/BillDetail.dc.html).
//   invoice  attached to the bill (existing attachments)
//   proof    the bill is paid and the payment is linked (existing fields)
//   slip     the bukti potong — only when the verified engine computed a withholding.
//            READ-ONLY here: it lives in withholding_records.bukti_potong_document_id
//            (migration 031, P-05 option B) and is read with GET /api/withholding-slips.
//   check    an accountant has checked the bill (P-05, migration 061), set with
//            PATCH /api/debts/:id/checklist (accountant role and above, audited).
// "Nothing closes on its own": the mark never pays, settles or approves anything.
// Before 061 the check row says "not tracked here yet", exactly as in batch 3.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useApi, useInvalidate } from '../data'
import { updateBillChecklist, actionError } from '../lib/actions'
import { billChecklistItems } from '../lib/obligations'
import { shortDate } from '../lib/format'
import { useT, useLang } from '../i18n'
import { Card } from '../ui'
import I from '../icons'

export default function BillChecklist({ d, hasInvoice, paid, slipNeeded, invoiceDocPath = null, onUpload = null }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const invalidate = useInvalidate()
  const slips = useApi(slipNeeded ? '/withholding-slips' : null)
  const items = billChecklistItems(d, { hasInvoice, paid, slipNeeded, slips: slips.data, invoiceDocPath })
  const checkTracked = !!items.find((c) => c.key === 'check')?.editable
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const run = async (body) => {
    setBusy(true); setErr(null)
    try {
      await updateBillChecklist(token, d.id, body)
      invalidate()
    } catch (x) {
      const code = actionError(x)
      setErr(code === 'forbidden' ? t('bill.ck.forbidden') : code === 'notApplied' ? t('bill.ck.notApplied') : code)
    } finally { setBusy(false) }
  }

  const sub = (c) => {
    if (c.key === 'proof') return t('bill.doc.proofSub')
    if (c.unknown) return [c.key === 'slip' ? t('bill.doc.slipSub') : null, t('bill.doc.notTracked')].filter(Boolean).join(' · ')
    if (c.key === 'slip') return c.done ? t('bill.ck.slipOnFile') : t('bill.ck.slipFrom')
    if (c.key === 'check') return c.done ? t('bill.ck.checkedOn', { d: shortDate(d.accountant_checked_at, lang) }) : t('bill.ck.notChecked')
    return null
  }

  const action = (c) => {
    if (c.link) return <Link to={c.link}>{t('bill.view')}</Link>
    if (c.unknown) return null
    if (c.key === 'slip') return c.done ? <Link to="/business/documents">{t('bill.view')}</Link> : <Link to="/business/accountant?tab=packages">{t('acct.seePackages')}</Link>
    if (c.key === 'check') {
      return <button type="button" className="v2-linkbtn" disabled={busy} onClick={() => run({ accountant_checked: !c.done })}>{c.done ? t('bill.ck.undo') : t('bill.ck.mark')}</button>
    }
    // Upload FOR this bill: the new document is linked to it in the same call.
    if (!c.done && onUpload && (c.key === 'invoice' || c.key === 'proof')) {
      return <button type="button" className="v2-linkbtn" onClick={() => onUpload(c.key)}>{t('bill.upload')}</button>
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
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
      <p className="v2-muted v2-small">{t('bill.closeNote')}{!checkTracked && ` ${t('bill.ck.pending')}`}</p>
    </Card>
  )
}
