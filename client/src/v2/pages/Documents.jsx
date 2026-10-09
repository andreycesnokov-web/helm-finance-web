// Documents (designs/Documents.dc.html). GET /api/documents (business-scoped, role-filtered
// by the server) and GET /api/debts for "Missing for <month>" and for what each document is
// linked to. Uploading reuses the existing DocumentIntakeModal (same upload-init /
// upload-complete path, same checks); an upload for a missing proof is linked to THAT bill in the
// same call. Reviewing, classifying and linking stay in the existing Document Center (Classic
// view), opened on the document itself (?doc=<id>).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DocumentIntakeModal from '../../components/DocumentIntakeModal'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate } from '../lib/format'
import { monthOptions, defaultCloseMonth } from '../lib/accounting'
import { detailPath } from './Bills'
import { billHasDocument, classicDocPath } from '../lib/obligations'

const needsLook = (d) => ['needs_review', 'pending', 'pending_review'].includes(d.review_status)
  || ['failed', 'unreadable'].includes(d.extraction_status) || !(d.links || []).length
const docMonth = (d) => String(d.document_date || d.created_at || '').slice(0, 7)
const LIMIT = 50

// Every document type from migration 031 (and the intake types) has a label; anything else
// reads "Document" instead of a raw key (review 8.2 #8).
export const DOC_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong', 'tax_billing', 'payment_proof',
  'filing_confirmation', 'bank_document', 'other', 'invoice', 'receipt', 'bank_statement', 'contract', 'tax']
export const docTypeLabel = (t, k) => t(`docs.type.${DOC_TYPES.includes(k) ? k : 'other'}`)

function DocRow({ d, debtsById, t, lang }) {
  const links = d.links || []
  const linked = links.length > 0
  const name = d.file?.file_name || d.title || d.document_type || '—'
  const debtLink = links.find((l) => l.target_type === 'debt')
  const txLink = links.find((l) => l.target_type === 'transaction')
  const debt = debtLink ? debtsById.get(String(debtLink.target_id)) : null
  let target = null
  if (debtLink) {
    const text = debt ? t(`docs.linkedTo.${debt.type === 'receivable' ? 'receivable' : 'payable'}`, { who: debt.counterparty || t('bills.noName') })
      : t('docs.linkedTo.debt', { id: debtLink.target_id })
    target = debt ? <Link to={detailPath(debt)}>{text}</Link> : <span>{text}</span>
  } else if (txLink) {
    target = <Link to="/business/transactions">{t('docs.linkedTo.transactionNoDate')}</Link>
  }
  const look = needsLook(d)
  const action = look || !debt ? <Link to={classicDocPath(d)}>{look ? t('docs.fix') : t('docs.open')}</Link>
    : <Link to={detailPath(debt)}>{t('docs.open')}</Link>
  return (
    <li className="v2-docrow">
      <span className="v2-dec-ic v2-tone-info" aria-hidden="true"><I.documents /></span>
      <span className="v2-doc-text">
        <span className="v2-dec-title v2-ellipsis" title={name}>{name}</span>
        <span className="v2-dec-meta">{[t(`docs.ch.${d.file?.upload_channel || 'web'}`), shortDate(d.created_at, lang)].join(' · ')}</span>
        <span className="v2-small">{[d.document_type ? docTypeLabel(t, d.document_type) : null, d.gross_amount ? money(d.gross_amount, { currency: d.currency || 'IDR' }) : null].filter(Boolean).join(' · ')}</span>
        {target && <span className="v2-small">{target}</span>}
      </span>
      <Pill tone={linked ? 'good' : 'warn'}>{t(linked ? 'docs.linked' : 'docs.notLinked')}</Pill>
      {action}
    </li>
  )
}

export default function Documents() {
  const t = useT()
  const lang = useLang()
  const { active } = useWorkspace()
  const invalidate = useInvalidate()
  const [tab, setTab] = useState('look')
  const [month, setMonth] = useState(defaultCloseMonth())
  const [upload, setUpload] = useState(null)   // null | { debt? }
  const docs = useApi('/documents')
  const debts = useApi('/debts')
  const list = docs.data?.documents || []
  const debtList = Array.isArray(debts.data) ? debts.data : []
  const debtsById = useMemo(() => new Map(debtList.map((d) => [String(d.id), d])), [debtList])
  const look = list.filter(needsLook)
  const recent = list.filter((d) => !needsLook(d)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5)
  const inMonth = list.filter((d) => docMonth(d) === month)
  const missing = useMemo(() => debtList.filter((d) => d.type === 'payable' && d.status === 'paid'
    && String(d.last_payment_at || d.due_date || '').slice(0, 7) === month && !billHasDocument(d)), [debtList, month])
  const monthName = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric' }) }

  const head = (
    <PageHead title={t('nav.documents')} sub={t('docs.sub')}
      actions={<>
        <select className="v2-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t('acct.month')}>
          {monthOptions(12).map((m) => <option key={m.key} value={m.key}>{monthName(m.key)}</option>)}
        </select>
        <Btn to="/business/documents/classic">{t('bills.classic')}</Btn>
      </>} />
  )
  const modal = upload && (upload.debt
    ? <DocumentIntakeModal business={active} uploadSource="payment_proof_upload" defaultType="payment_proof"
        link={{ target_type: 'debt', target_id: upload.debt.id }}
        heading={t('docs.uploadProofFor', { who: upload.debt.counterparty || t('bills.noName') })}
        onClose={() => setUpload(null)} onUploaded={() => invalidate()} />
    : <DocumentIntakeModal business={active} uploadSource="document_center_upload"
        onClose={() => setUpload(null)} onUploaded={() => invalidate()} />)
  const rows = tab === 'look' ? look : inMonth
  const renderList = (items) => (
    <ul className="v2-doclist">
      {items.slice(0, LIMIT).map((d) => <DocRow key={d.id} d={d} debtsById={debtsById} t={t} lang={lang} />)}
    </ul>
  )
  return (
    <div className="v2-page">
      {head}
      {docs.loading && !docs.data ? (
        <Card><Skeleton rows={6} /></Card>
      ) : docs.error && !docs.data ? (
        <ErrorBox error={docs.error?.status === 403 ? t('docs.forbidden') : docs.error} onRetry={docs.reload} />
      ) : (
        <>
          <button type="button" className="v2-drop" onClick={() => setUpload({})}>
            <I.upload size={24} />
            <strong>{t('docs.drop')}</strong>
            <span className="v2-muted v2-small">{t('docs.dropHint')}</span>
            <span className="v2-btn v2-btn-primary">{t('docs.choose')}</span>
          </button>
          <div className="v2-grid-detail">
            <Card className="v2-col">
              <div className="v2-seg" role="tablist" aria-label={t('nav.documents')}>
                <button type="button" role="tab" className="v2-seg-btn" aria-selected={tab === 'look'} aria-pressed={tab === 'look'} onClick={() => setTab('look')}>{t('docs.look', { n: look.length })}</button>
                <button type="button" role="tab" className="v2-seg-btn" aria-selected={tab === 'month'} aria-pressed={tab === 'month'} onClick={() => setTab('month')}>{t('docs.inMonth', { m: monthName(month), n: inMonth.length })}</button>
              </div>
              {rows.length === 0 ? <Empty icon={<I.documents size={28} />} title={t(tab === 'look' ? 'docs.allGood' : 'docs.none')} /> : renderList(rows)}
              {rows.length > LIMIT && (
                <p className="v2-muted v2-small">{t('docs.shown', { n: LIMIT, m: rows.length })} <Link to="/business/documents/classic">{t('bills.classic')}</Link></p>
              )}
              {tab === 'look' && recent.length > 0 && (
                <>
                  <h2 className="v2-h3">{t('docs.recent')}</h2>
                  {renderList(recent)}
                </>
              )}
            </Card>
            <aside className="v2-col">
              <Card title={t('docs.missingFor', { m: monthName(month) })}>
                <p className="v2-muted v2-small">{t('docs.missingHint')}</p>
                {missing.length === 0 ? <p className="v2-sec">{t('docs.noneMissing')}</p> : (
                  <ul className="v2-check">
                    {missing.map((d) => (
                      <li key={d.id}><span className="v2-check-mark" aria-hidden="true" />
                        <span className="v2-check-text"><span>{t('bill.doc.proof')}</span>
                          <span className="v2-muted v2-small"><Link to={detailPath(d)}>{d.counterparty || t('bills.noName')}</Link> · {money(d.original_amount ?? d.amount)}</span></span>
                        <button type="button" className="v2-btn-link" onClick={() => setUpload({ debt: d })}>{t('bill.upload')}</button></li>
                    ))}
                  </ul>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}
      {modal}
    </div>
  )
}
