// Documents (designs/Documents.dc.html). GET /api/documents (business-scoped, role-filtered
// by the server), GET /api/debts for "Missing for <month>" and for what each document is
// linked to, GET /api/transactions for transaction links.
//
// Two kinds of document, kept apart (owner 2026-10-09):
//   * evidence — bills, receipts, proofs, statements: "Needs a look", the month list, "Recently
//     filed" and "Missing for <month>";
//   * company documents — NIB, NPWP, deed, SK, BPJS…: their own tab, never in the month work.
//     Only a confirmed classification moves a document there (companyVault.partitionDocuments);
//     a suggestion stays in the work list and says so.
//
// "Fix" / "Open" review the document IN PLACE (components/DocumentDrawer.jsx, ?doc=<id>), with
// the existing Document Center routes. Uploading reuses DocumentIntakeModal; an upload for a
// missing proof is linked to THAT bill in the same call.
import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import DocumentIntakeModal from '../../components/DocumentIntakeModal'
import DocumentDrawer, { txLabel } from '../components/DocumentDrawer'
import { useWorkspace } from '../../shell/WorkspaceProvider'
import I from '../icons'
import { PageHead, Card, Pill, Btn, Skeleton, ErrorBox, Empty } from '../ui'
import { useT, useLang } from '../i18n'
import { useApi, useInvalidate } from '../data'
import { money, shortDate } from '../lib/format'
import { monthOptions, defaultCloseMonth } from '../lib/accounting'
import { detailPath } from './Bills'
import { billHasDocument, docNeedsLook, docIsUnreadable } from '../lib/obligations'
import { partitionDocuments, vaultVerdictOf } from '../../pages/business/companyVault'

const needsLook = docNeedsLook
const unreadable = docIsUnreadable
const docMonth = (d) => String(d.document_date || d.created_at || '').slice(0, 7)
const LIMIT = 50
const TABS = ['look', 'month', 'company']
// The company documents a PT keeps on file (the Company profile asks for the first four).
const COMPANY_SET = ['akta', 'sk_kemenkumham', 'nib', 'npwp', 'bpjs_document']

// Every document type from migration 031 (and the intake types) has a label; anything else
// reads "Document" instead of a raw key (review 8.2 #8).
export const DOC_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong', 'tax_billing', 'payment_proof',
  'filing_confirmation', 'bank_document', 'other', 'invoice', 'receipt', 'bank_statement', 'contract', 'tax']
export const docTypeLabel = (t, k) => t(`docs.type.${DOC_TYPES.includes(k) ? k : 'other'}`)

function DocRow({ d, debtsById, txById, t, lang, onOpen, company = false }) {
  const links = d.links || []
  const linked = links.length > 0
  const name = d.file?.file_name || d.document_number || d.document_type || '—'
  const debtLink = links.find((l) => l.target_type === 'debt')
  const txLink = links.find((l) => l.target_type === 'transaction')
  const debt = debtLink ? debtsById.get(String(debtLink.target_id)) : null
  const verdict = vaultVerdictOf(d)
  let target = null
  if (debtLink) {
    const text = debt ? t(`docs.linkedTo.${debt.type === 'receivable' ? 'receivable' : 'payable'}`, { who: debt.counterparty || t('bills.noName') })
      : t('docs.linkedTo.debt', { id: debtLink.target_id })
    target = debt ? <Link to={detailPath(debt)}>{text}</Link> : <span>{text}</span>
  } else if (txLink) {
    const tx = txById.get(String(txLink.target_id))
    target = <Link to="/business/transactions">{tx ? t('docs.linkedTo.transaction', { d: txLabel(tx, lang) }) : t('docs.linkedTo.transactionNoDate')}</Link>
  }
  const look = !company && needsLook(d)
  const kind = company ? t(`docs.vault.${verdict?.docType}`) : d.document_type ? docTypeLabel(t, d.document_type) : null
  return (
    <li className="v2-docrow" data-doc-row={d.id}>
      <span className="v2-dec-ic v2-tone-info" aria-hidden="true"><I.documents /></span>
      <span className="v2-doc-text">
        <span className="v2-dec-title v2-ellipsis" title={name}>{name}</span>
        <span className="v2-dec-meta">{[t(`docs.ch.${d.file?.upload_channel || 'web'}`), shortDate(d.created_at, lang)].join(' · ')}</span>
        <span className="v2-small">{[kind, d.gross_amount ? money(d.gross_amount, { currency: d.currency || 'IDR' }) : null].filter(Boolean).join(' · ')}</span>
        {target && <span className="v2-small">{target}</span>}
      </span>
      <span className="v2-docrow-pills">
        {company ? <Pill tone="good">{t('docs.company.confirmed')}</Pill> : <>
          {verdict && !verdict.confirmed && <Pill tone="info">{t('docs.looksLike', { k: t(`docs.vault.${verdict.docType}`) })}</Pill>}
          {unreadable(d) && <Pill tone="warn">{t('docs.extractFailed')}</Pill>}
          <Pill tone={linked ? 'good' : 'warn'}>{t(linked ? 'docs.linked' : 'docs.notLinked')}</Pill>
        </>}
      </span>
      <button type="button" className="v2-btn-link v2-docrow-act" onClick={() => onOpen(d)}>{look ? t('docs.fix') : t('docs.open')}</button>
    </li>
  )
}

export default function Documents() {
  const t = useT()
  const lang = useLang()
  const { active } = useWorkspace()
  const invalidate = useInvalidate()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'look'
  const openId = params.get('doc')
  const [month, setMonth] = useState(defaultCloseMonth())
  const [upload, setUpload] = useState(null)   // null | { debt? } | { company: true }
  const docs = useApi('/documents?limit=200')
  const debts = useApi('/debts')
  const txs = useApi('/transactions?period=all')
  const list = docs.data?.documents || []
  const debtList = Array.isArray(debts.data) ? debts.data : []
  const txList = Array.isArray(txs.data) ? txs.data : []
  const debtsById = useMemo(() => new Map(debtList.map((d) => [String(d.id), d])), [debtList])
  const txById = useMemo(() => new Map(txList.map((x) => [String(x.id), x])), [txList])
  const { evidence, vault } = useMemo(() => partitionDocuments(list), [list])
  const suggested = evidence.filter((d) => { const v = vaultVerdictOf(d); return v && !v.confirmed })
  const look = evidence.filter(needsLook)
  const recent = evidence.filter((d) => !needsLook(d)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5)
  const inMonth = evidence.filter((d) => docMonth(d) === month)
  const missing = useMemo(() => debtList.filter((d) => d.type === 'payable' && d.status === 'paid'
    && String(d.last_payment_at || d.due_date || '').slice(0, 7) === month && !billHasDocument(d)), [debtList, month])
  const monthName = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric' }) }

  // The document in the panel: from the list, or (deep link to one outside the list) on its own.
  const listed = openId ? list.find((d) => String(d.id) === String(openId)) : null
  const single = useApi(openId && docs.data && !listed ? `/documents/${encodeURIComponent(openId)}` : null)
  const found = listed || (single.data?.document ? { ...single.data.document, file: single.data.file } : null)
  // While the list reloads after a change, keep showing the panel instead of closing it.
  const lastDoc = useRef(null)
  if (found) lastDoc.current = found
  const openDoc = !openId ? null : found || (docs.loading && String(lastDoc.current?.id) === String(openId) ? lastDoc.current : null)
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n }, { replace: k === 'doc' && v == null })
  const setTab = (k) => setParam('tab', k === 'look' ? null : k)
  const onOpen = (d) => setParam('doc', String(d.id))
  const closeDoc = () => setParam('doc', null)
  const changed = () => invalidate()

  const head = (
    <PageHead title={t('nav.documents')} sub={t('docs.sub')}
      actions={<>
        {tab !== 'company' && (
          <select className="v2-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t('acct.month')}>
            {monthOptions(12).map((m) => <option key={m.key} value={m.key}>{monthName(m.key)}</option>)}
          </select>
        )}
        <Btn to="/business/documents/classic">{t('bills.classic')}</Btn>
      </>} />
  )
  const modal = upload && (upload.debt
    ? <DocumentIntakeModal business={active} uploadSource="payment_proof_upload" defaultType="payment_proof"
        link={{ target_type: 'debt', target_id: upload.debt.id }}
        heading={t('docs.uploadProofFor', { who: upload.debt.counterparty || t('bills.noName') })}
        onClose={() => setUpload(null)} onUploaded={changed} />
    : <DocumentIntakeModal business={active} uploadSource={upload.company ? 'accountant_upload' : 'document_center_upload'}
        heading={upload.company ? t('docs.company.upload') : null}
        onClose={() => setUpload(null)} onUploaded={changed} />)
  const renderList = (items, company = false) => (
    <ul className="v2-doclist">
      {items.slice(0, LIMIT).map((d) => <DocRow key={d.id} d={d} debtsById={debtsById} txById={txById} t={t} lang={lang} onOpen={onOpen} company={company} />)}
    </ul>
  )
  const rows = tab === 'look' ? look : tab === 'month' ? inMonth : vault
  const tabBtn = (k, label) => (
    <button type="button" role="tab" className="v2-seg-btn" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
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
          <button type="button" className="v2-drop" onClick={() => setUpload(tab === 'company' ? { company: true } : {})}>
            <I.upload size={24} />
            <strong>{tab === 'company' ? t('docs.company.upload') : t('docs.drop')}</strong>
            <span className="v2-muted v2-small">{tab === 'company' ? t('docs.company.hint') : t('docs.dropHint')}</span>
            <span className="v2-btn v2-btn-primary">{t('docs.choose')}</span>
          </button>
          <div className="v2-grid-detail">
            <Card className="v2-col">
              <div className="v2-seg" role="tablist" aria-label={t('nav.documents')}>
                {tabBtn('look', t('docs.look', { n: look.length }))}
                {tabBtn('month', t('docs.inMonth', { m: monthName(month), n: inMonth.length }))}
                {tabBtn('company', t('docs.tabCompany', { n: vault.length }))}
              </div>
              {tab === 'company' && <p className="v2-muted v2-small">{t('docs.company.hint')} <Link to="/business/accountant/tax-profile">{t('docs.company.profile')}</Link></p>}
              {rows.length === 0
                ? <Empty icon={<I.documents size={28} />} title={t(tab === 'look' ? 'docs.allGood' : tab === 'month' ? 'docs.none' : 'docs.company.none')} />
                : renderList(rows, tab === 'company')}
              {rows.length > LIMIT && (
                <p className="v2-muted v2-small">{t('docs.shown', { n: LIMIT, m: rows.length })} <Link to="/business/documents/classic">{t('bills.classic')}</Link></p>
              )}
              {tab === 'look' && recent.length > 0 && (
                <>
                  <h2 className="v2-h3">{t('docs.recent')}</h2>
                  {renderList(recent)}
                </>
              )}
              {tab === 'company' && suggested.length > 0 && (
                <>
                  <h2 className="v2-h3">{t('docs.company.suggested')}</h2>
                  {renderList(suggested)}
                </>
              )}
            </Card>
            <aside className="v2-col">
              {tab === 'company' ? (
              <Card title={t('docs.company.have')}>
                <ul className="v2-check">
                  {COMPANY_SET.map((k) => {
                    const d = vault.find((x) => vaultVerdictOf(x)?.docType === k)
                    return (
                      <li key={k} className={d ? 'is-done' : ''}><span className="v2-check-mark" aria-hidden="true">{d ? <I.check size={14} /> : null}</span>
                        <span className="v2-check-text"><span>{t(`docs.vault.${k}`)}</span>
                          <span className="v2-muted v2-small">{d ? (d.file?.file_name || t('docs.company.confirmed')) : t('docs.company.notYet')}</span></span>
                        {d && <button type="button" className="v2-btn-link" onClick={() => onOpen(d)}>{t('docs.open')}</button>}</li>
                    )
                  })}
                </ul>
              </Card>
              ) : (
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
              )}
            </aside>
          </div>
        </>
      )}
      {openDoc && <DocumentDrawer doc={openDoc} debts={debtList} transactions={txList} onClose={closeDoc} onChanged={changed} />}
      {modal}
    </div>
  )
}
