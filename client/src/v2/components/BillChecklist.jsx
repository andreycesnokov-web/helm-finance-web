// Bill detail → Documents: the 4-item checklist (designs/BillDetail.dc.html).
//   invoice/proof: active typed Document Center files linked to this bill.
//   A payment ledger row never stands in for an uploaded proof file.
//   slip     the bukti potong — only when the verified engine computed a withholding.
//            READ-ONLY here: it lives in withholding_records.bukti_potong_document_id
//            (migration 031, P-05 option B) and is read with GET /api/withholding-slips.
//   check    an accountant has checked the bill (P-05, migration 061), set with
//            PATCH /api/debts/:id/checklist (accountant role and above, audited).
// "Nothing closes on its own": the mark never pays, settles or approves anything.
// Before 061 the check row says "not tracked here yet", exactly as in batch 3.
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import { useBusinessRequest } from '../lib/useBusinessRequest'
import { useApi, useInvalidate } from '../data'
import { updateBillChecklist, actionError } from '../lib/actions'
import { billChecklistItems, docPath } from '../lib/obligations'
import { billDocumentEvidence } from '../lib/billEvidence'
import { canRecordCompanyMoney } from '../lib/financePermissions'
import { shortDate } from '../lib/format'
import { useT, useLang } from '../i18n'
import { Card } from '../ui'
import I from '../icons'

export default function BillChecklist({ d, slipNeeded, onUpload = null }) {
  const t = useT()
  const lang = useLang()
  const request = useBusinessRequest()
  const { active } = useWorkspace()
  const canCheck = canRecordCompanyMoney(active?.role)
  const invalidate = useInvalidate()
  const slips = useApi(slipNeeded ? '/withholding-slips' : null)
  const documents = useApi(d?.id ? '/documents?debt_id=' + encodeURIComponent(d.id) + '&limit=200' : null)
  const evidence = billDocumentEvidence(d, documents.error || documents.loading ? null : documents.data)
  const items = billChecklistItems(d, { hasInvoice: !!evidence.invoice, hasProof: !!evidence.proof,
    documentsKnown: evidence.known, slipNeeded, slips: slips.data,
    invoiceDocPath: evidence.invoice ? docPath(evidence.invoice) : null,
    proofDocPath: evidence.proof ? docPath(evidence.proof) : null })
  const checkTracked = !!items.find((c) => c.key === 'check')?.editable
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submitting = useRef(false)

  const run = async (body) => {
    if (!canCheck || !request.isCurrent() || submitting.current) return
    submitting.current = true
    setBusy(true); setErr(null)
    try {
      await updateBillChecklist(request, d.id, body)
      if (request.isCurrent()) invalidate()
    } catch (x) {
      const code = actionError(x)
      if (request.isCurrent()) setErr(code === 'forbidden' ? t('bill.ck.forbidden') : code === 'notApplied' ? t('bill.ck.notApplied') : code)
    } finally { submitting.current = false; if (request.isCurrent()) setBusy(false) }
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
      if (!canCheck) return null
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
      {!evidence.known && <p role="status" className="v2-muted v2-small">{t('bill.ck.docsUnknown')} <button type="button" className="v2-linkbtn" onClick={documents.reload}>{t('bill.ck.retryDocs')}</button></p>}
      <p className="v2-muted v2-small">{t('bill.closeNote')}{!checkTracked && ` ${t('bill.ck.pending')}`}</p>
    </Card>
  )
}
