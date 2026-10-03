// Documents (designs/Documents.dc.html). GET /api/documents (business-scoped, role-filtered
// by the server) and GET /api/debts for "Missing for <month>". Uploading reuses the existing
// DocumentIntakeModal (same upload-init / upload-complete path, same checks). Reviewing,
// classifying and linking stay in the existing Document Center (Classic view).
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

const needsLook = (d) => ['needs_review', 'pending', 'pending_review'].includes(d.review_status)
  || ['failed', 'unreadable'].includes(d.extraction_status) || !(d.links || []).length
const docMonth = (d) => String(d.document_date || d.created_at || '').slice(0, 7)

// Every document type from migration 031 (and the intake types) has a label; anything else
// reads "Document" instead of a raw key (review 8.2 #8).
export const DOC_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong', 'tax_billing', 'payment_proof',
  'filing_confirmation', 'bank_document', 'other', 'invoice', 'receipt', 'bank_statement', 'contract', 'tax']
export const docTypeLabel = (t, k) => t(`docs.type.${DOC_TYPES.includes(k) ? k : 'other'}`)

export default function Documents() {
  const t = useT()
  const lang = useLang()
  const { active } = useWorkspace()
  const invalidate = useInvalidate()
  const [tab, setTab] = useState('look')
  const [month, setMonth] = useState(defaultCloseMonth())
  const [upload, setUpload] = useState(false)
  const docs = useApi('/documents')
  const debts = useApi('/debts')
  const list = docs.data?.documents || []
  const look = list.filter(needsLook)
  const inMonth = list.filter((d) => docMonth(d) === month)
  const missing = useMemo(() => (Array.isArray(debts.data) ? debts.data : []).filter((d) => d.type === 'payable' && d.status === 'paid'
    && String(d.last_payment_at || d.due_date || '').slice(0, 7) === month && !(Array.isArray(d.attachments) && d.attachments.length) && !d.attachment_url), [debts.data, month])
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
  const modal = upload && <DocumentIntakeModal business={active} uploadSource="document_center_upload"
    onClose={() => setUpload(false)} onUploaded={() => invalidate()} />
  if (docs.loading) return <>{head}<Card><Skeleton rows={6} /></Card></>
  if (docs.error) return <>{head}<ErrorBox error={docs.error?.status === 403 ? t('docs.forbidden') : docs.error} onRetry={docs.reload} /></>

  const rows = tab === 'look' ? look : inMonth
  return (
    <div className="v2-page">
      {head}
      <button type="button" className="v2-drop" onClick={() => setUpload(true)}>
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
          {rows.length === 0 ? <Empty icon={<I.documents size={28} />} title={t(tab === 'look' ? 'docs.allGood' : 'docs.none')} /> : (
            <ul className="v2-doclist">
              {rows.slice(0, 50).map((d) => {
                const linked = (d.links || []).length > 0
                const name = d.file?.file_name || d.title || d.document_type || '—'
                return (
                  <li key={d.id} className="v2-docrow">
                    <span className="v2-dec-ic v2-tone-info" aria-hidden="true"><I.documents /></span>
                    <span className="v2-doc-text">
                      <span className="v2-dec-title v2-ellipsis" title={name}>{name}</span>
                      <span className="v2-dec-meta">{[t(`docs.ch.${d.file?.upload_channel || 'web'}`), shortDate(d.created_at, lang)].join(' · ')}</span>
                      <span className="v2-small">{[d.document_type ? docTypeLabel(t, d.document_type) : null, d.gross_amount ? money(d.gross_amount, { currency: d.currency || 'IDR' }) : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Pill tone={linked ? 'good' : 'warn'}>{t(linked ? 'docs.linked' : 'docs.notLinked')}</Pill>
                    <Link to="/business/documents/classic">{needsLook(d) ? t('docs.fix') : t('bill.view')}</Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
        <aside className="v2-col">
          <Card title={t('docs.missingFor', { m: monthName(month) })}>
            <p className="v2-muted v2-small">{t('docs.missingHint')}</p>
            {missing.length === 0 ? <p className="v2-sec">{t('docs.noneMissing')}</p> : (
              <ul className="v2-check">
                {missing.map((d) => (
                  <li key={d.id}><span className="v2-check-mark" aria-hidden="true" />
                    <span className="v2-check-text"><span>{t('bill.doc.proof')}</span><span className="v2-muted v2-small">{d.counterparty} · {money(d.original_amount ?? d.amount)}</span></span>
                    <button type="button" className="v2-btn-link" onClick={() => setUpload(true)}>{t('bill.upload')}</button></li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
      {modal}
    </div>
  )
}
