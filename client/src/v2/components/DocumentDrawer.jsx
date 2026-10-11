// One document, reviewed in place on the Documents page ("Fix" / "Open" no longer leave the
// screen for the classic list). A centred window (owner 2026-10-09): the file itself on the left,
// so the user sees what the document is before linking or classifying it, the fields on the right. Every write is an existing Document Center route through
// lib/actions.js: type / number / date / amount (PATCH /documents/:id), link and unlink,
// archive, and "this is a company document" (the AI Accountant classification route, the
// only thing that moves a document to the Company documents tab). Nothing is deleted.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import I from '../icons'
import { Pill } from '../ui'
import DocumentPreview from './DocumentPreview'
import DocumentIdentity from './DocumentIdentity'
import { previewKind } from '../../lib/documentPreview'
import { useT, useLang } from '../i18n'
import { money, shortDate } from '../lib/format'
import { detailPath } from '../pages/Bills'
import { FILING_MODES, FILING_REASONS, filingText } from '../lib/obligations'
import { documentFileUrl, updateDocument, linkDocument, unlinkDocument, archiveDocument, confirmDocumentKind, fileDocument } from '../lib/actions'
import { VAULT_TYPES, vaultVerdictOf } from '../../pages/business/companyVault'

// The CHECK-valid document_type values (migration 031 / server/lib/documentValidation.js).
export const EDIT_TYPES = ['vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong', 'tax_billing',
  'payment_proof', 'filing_confirmation', 'bank_document', 'other']

const errKey = (e) => {
  const code = e?.data?.error || ''
  if (e?.status === 403) return ['docs.dr.err.forbidden']
  if (code === 'document_archived') return ['docs.dr.err.archived']
  if (code === 'already_linked') return ['docs.dr.err.already']
  if (e?.status === 404) return ['docs.dr.err.notFound']
  return ['docs.dr.err.generic', { msg: code || e?.message || '—' }]
}
const amt = (x) => Number(x?.original_amount ?? x?.amount ?? 0)

export function txLabel(tx, lang) {
  if (!tx) return null
  const cur = (tx.currency_original || tx.currency || 'IDR').toUpperCase()
  return [shortDate(tx.date || tx.transaction_date, lang), money(Number(tx.amount_original ?? tx.amount ?? 0), { currency: cur }),
    tx.description || tx.category].filter(Boolean).join(' · ')
}

export default function DocumentDrawer({ doc, debts = [], transactions = [], wallets = [], counterparties = [], onClose, onChanged }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const ref = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  const [fileErr, setFileErr] = useState(null)
  const [form, setForm] = useState({})
  const [target, setTarget] = useState('')
  const [kind, setKind] = useState('')
  const [sheetText, setSheetText] = useState(undefined)
  const [mode, setMode] = useState('record')
  const [fl, setFl] = useState({ wallet_id: '', period: '', counterparty_id: '', reason: 'other' })

  useEffect(() => {
    setForm({
      document_type: doc?.document_type || 'other',
      title: doc?.document_number || '',
      document_date: doc?.document_date ? String(doc.document_date).slice(0, 10) : '',
      amount: doc?.gross_amount != null ? String(doc.gross_amount) : '',
    })
    setErr(null); setNote(null); setFileErr(null); setTarget(''); setSheetText(undefined)
    const f = doc?.extracted_json?.filing
    const intake = doc?.extracted_json?.ai_intake?.doc_type
    setMode(f?.kind === 'bank_account_period' || (!f && (doc?.document_type === 'bank_document' || intake === 'bank_statement')) ? 'bank'
      : f?.kind === 'counterparty' ? 'counterparty' : f?.kind === 'keep' ? 'keep' : 'record')
    setFl({ wallet_id: f?.wallet_id || '', period: f?.period || (doc?.period_start ? String(doc.period_start).slice(0, 7) : ''), counterparty_id: f?.counterparty_id || '', reason: f?.reason || 'other' })
    setKind(vaultVerdictOf(doc)?.docType || '')
  }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- a reload of the same document keeps the form and the note

  useEffect(() => {
    const last = document.activeElement
    const timer = setTimeout(() => closeRef.current?.focus(), 30)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current?.() }
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll('button, [href], input, select, textarea')].filter((x) => !x.disabled && x.offsetParent !== null)
        if (!els.length) return
        if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els[els.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === els[els.length - 1]) { e.preventDefault(); els[0].focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); last?.focus?.() }
  }, [])

  const debtsById = useMemo(() => new Map(debts.map((d) => [String(d.id), d])), [debts])
  const txById = useMemo(() => new Map(transactions.map((x) => [String(x.id), x])), [transactions])
  const links = doc?.links || []
  const filing = doc?.extracted_json?.filing || null
  const linkedKeys = new Set(links.map((l) => `${l.target_type}:${l.target_id}`))
  // Same amount first, then the most recent — the likely match is at the top of the list.
  const docAmount = doc?.gross_amount != null ? Number(doc.gross_amount) : null
  const near = (v) => (docAmount == null ? 1 : Math.abs(v - docAmount) < 1 ? 0 : 1)
  const debtOptions = useMemo(() => debts.filter((d) => !linkedKeys.has(`debt:${d.id}`))
    .sort((a, b) => near(amt(a)) - near(amt(b)) || String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 150),
  [debts, links, docAmount]) // eslint-disable-line react-hooks/exhaustive-deps
  const txOptions = useMemo(() => transactions.filter((x) => !linkedKeys.has(`transaction:${x.id}`))
    .sort((a, b) => near(Number(a.amount_original ?? a.amount ?? 0)) - near(Number(b.amount_original ?? b.amount ?? 0))
      || String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 150),
  [transactions, links, docAmount]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return null
  const verdict = vaultVerdictOf(doc)
  const isCompany = !!verdict?.confirmed
  const name = doc.file?.file_name || doc.document_number || t('docs.dr.title')

  const run = async (fn, okNote = null, close = false) => {
    setBusy(true); setErr(null); setNote(null)
    try { await fn(); if (okNote) setNote(okNote); onChanged?.(); if (close) onClose?.() }
    catch (e) { const [k, v] = errKey(e); setErr(t(k, v)) }
    finally { setBusy(false) }
  }
  const openFile = async (mode) => {
    setFileErr(null)
    try {
      const r = await documentFileUrl(token, doc.id, mode)
      if (r?.url) window.open(r.url, '_blank', 'noopener')
    } catch (e) { setFileErr(t('docs.dr.fileErr', { msg: e?.data?.error || e?.message || '—' })) }
  }
  const save = (e) => {
    e.preventDefault()
    const body = { document_type: form.document_type, title: form.title }
    if (form.document_date) body.document_date = form.document_date
    if (form.amount !== '' && isFinite(Number(form.amount))) body.amount = Number(form.amount)
    run(() => updateDocument(token, doc.id, body), t('docs.dr.saved'))
  }
  const doLink = () => {
    const [type, id] = target.split(':')
    if (!type || !id) return
    run(() => linkDocument(token, doc.id, type, id)).then(() => setTarget(''))
  }
  const linkText = (l) => {
    if (l.target_type === 'debt') {
      const d = debtsById.get(String(l.target_id))
      if (!d) return { text: t('docs.linkedTo.debt', { id: l.target_id }) }
      return { text: `${t(`docs.linkedTo.${d.type === 'receivable' ? 'receivable' : 'payable'}`, { who: d.counterparty || t('bills.noName') })} · ${money(amt(d))}`, to: detailPath(d) }
    }
    if (l.target_type === 'transaction') {
      const x = txById.get(String(l.target_id))
      return { text: x ? t('docs.linkedTo.transaction', { d: txLabel(x, lang) }) : t('docs.linkedTo.transactionNoDate'), to: '/business/transactions' }
    }
    if (l.target_type === 'compliance') return { text: t('docs.linkedTo.compliance'), to: '/business/accountant?tab=taxes' }
    return { text: `${l.target_type} · ${l.target_id}` }
  }

  return (
    <>
      <div className="v2-docmodal-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="v2-docmodal v2-docdrawer" role="dialog" aria-modal="true" aria-labelledby="v2-doc-title" data-doc-drawer={doc.id}>
        <header className="v2-docmodal-head">
          <div className="v2-doc-text">
            <strong id="v2-doc-title" className="v2-ellipsis" title={name}>{name}</strong>
            <span className="v2-muted v2-small">{[t(`docs.ch.${doc.file?.upload_channel || 'web'}`), shortDate(doc.created_at, lang)].join(' · ')}</span>
          </div>
          <button ref={closeRef} type="button" className="v2-iconbtn" onClick={onClose} aria-label={t('docs.dr.close')}><I.close size={20} /></button>
        </header>

        <div className="v2-docmodal-body">
          <section className="v2-docmodal-view" aria-label={t('docs.pv.title')}>
            <DocumentPreview doc={doc} onSheetText={setSheetText} />
            <div className="v2-row-gap">
              <button type="button" className="v2-btn v2-btn-secondary" onClick={() => openFile('view')}>{t('docs.dr.view')}</button>
              <button type="button" className="v2-btn v2-btn-ghost" onClick={() => openFile('download')}>{t('docs.dr.download')}</button>
            </div>
            {fileErr && <p className="v2-inline-err" role="alert">{fileErr}</p>}
          </section>
          <div className="v2-docmodal-side">
            <DocumentIdentity doc={doc} sheetText={sheetText} waitForSheet={previewKind(doc.file || {}) === 'sheet'}
              onApplied={({ vault }) => { onChanged?.(); if (vault) onClose?.() }} />

          {err && <p className="v2-inline-err" role="alert">{err}</p>}
          {note && <p className="v2-sec" role="status">{note}</p>}

          {verdict && !verdict.confirmed && (
            <div className="v2-banner v2-tone-warn"><I.info size={18} />
              <span className="v2-banner-text">{t('docs.dr.suggested', { k: t(`docs.vault.${verdict.docType}`) })}</span>
              <button type="button" className="v2-btn v2-btn-primary" disabled={busy}
                onClick={() => run(() => confirmDocumentKind(token, doc.id, verdict.docType), null, true)}>{t('docs.dr.companyConfirm')}</button>
            </div>
          )}

          {isCompany ? (
            <section className="v2-card v2-docdrawer-sec">
              <h3 className="v2-h3">{t('docs.dr.companyTitle')}</h3>
              <p className="v2-sec">{t('docs.dr.companyIs', { k: t(`docs.vault.${verdict.docType}`) })}</p>
              <button type="button" className="v2-btn v2-btn-ghost" disabled={busy}
                onClick={() => run(() => confirmDocumentKind(token, doc.id, 'unknown'), null, true)}>{t('docs.dr.notCompany')}</button>
            </section>
          ) : (
            <>
              <form className="v2-card v2-docdrawer-sec" onSubmit={save}>
                <h3 className="v2-h3">{t('docs.dr.fields')}</h3>
                <label className="v2-field"><span className="v2-field-label">{t('docs.dr.type')}</span>
                  <select className="v2-select" value={form.document_type || 'other'} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, document_type: e.target.value }))}>
                    {EDIT_TYPES.map((k) => <option key={k} value={k}>{t(`docs.type.${k}`)}</option>)}
                  </select></label>
                <div className="v2-field-row">
                  <label className="v2-field"><span className="v2-field-label">{t('docs.dr.amount')} ({doc.currency || 'IDR'})</span>
                    <input className="v2-input" inputMode="decimal" value={form.amount || ''} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))} /></label>
                  <label className="v2-field"><span className="v2-field-label">{t('docs.dr.date')}</span>
                    <input className="v2-input" type="date" value={form.document_date || ''} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, document_date: e.target.value }))} /></label>
                </div>
                <label className="v2-field"><span className="v2-field-label">{t('docs.dr.number')}</span>
                  <input className="v2-input" value={form.title || ''} maxLength={200} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></label>
                <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>{busy ? t('docs.dr.saving') : t('docs.dr.save')}</button>
              </form>

              <section className="v2-card v2-docdrawer-sec">
                <h3 className="v2-h3">{t('docs.dr.links')}</h3>
                {links.length === 0 && !filing ? <p className="v2-muted v2-small">{t('docs.dr.noLinks')}</p> : links.length === 0 ? null : (
                  <ul className="v2-doclinks">
                    {links.map((l) => {
                      const x = linkText(l)
                      return (
                        <li key={l.link_id || l.id || `${l.target_type}:${l.target_id}`}>
                          <Pill tone="good">{t('docs.linked')}</Pill>
                          <span className="v2-ellipsis">{x.to ? <Link to={x.to} onClick={onClose}>{x.text}</Link> : x.text}</span>
                          {(l.link_id || l.id) && <button type="button" className="v2-btn-link" disabled={busy}
                            onClick={() => run(() => unlinkDocument(token, doc.id, l.link_id || l.id))}>{t('docs.dr.unlink')}</button>}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {filing && (
                  <div className="v2-doclinks-filed">
                    <Pill tone="good">{t('docs.fl.filed')}</Pill>
                    <span>{filingText(t, filing, lang)}</span>
                    <button type="button" className="v2-btn-link" disabled={busy} onClick={() => run(() => fileDocument(token, doc.id, { clear: true }))}>{t('docs.dr.unlink')}</button>
                  </div>
                )}
                <label className="v2-field"><span className="v2-field-label">{t('docs.fl.where')}</span>
                  <select className="v2-select" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value)} aria-label={t('docs.fl.where')}>
                    {FILING_MODES.map((m) => <option key={m} value={m}>{t(`docs.fl.mode.${m}`)}</option>)}
                  </select></label>
                {mode === 'record' && (
                  <>
                    <label className="v2-field"><span className="v2-field-label">{t('docs.dr.linkTo')}{docAmount != null ? ` · ${t('docs.dr.byAmount')}` : ''}</span>
                      <select className="v2-select" value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)} aria-label={t('docs.dr.linkTo')}>
                        <option value="">{t('docs.dr.choose')}</option>
                        {debtOptions.length > 0 && <optgroup label={t('docs.dr.linkBill')}>
                          {debtOptions.map((d) => <option key={d.id} value={`debt:${d.id}`}>
                            {[t(`docs.linkedTo.${d.type === 'receivable' ? 'receivable' : 'payable'}`, { who: d.counterparty || t('bills.noName') }), money(amt(d)), d.due_date ? shortDate(d.due_date, lang) : null].filter(Boolean).join(' · ')}
                          </option>)}
                        </optgroup>}
                        {txOptions.length > 0 && <optgroup label={t('docs.dr.linkTx')}>
                          {txOptions.map((x) => <option key={x.id} value={`transaction:${x.id}`}>{txLabel(x, lang)}</option>)}
                        </optgroup>}
                      </select></label>
                    <button type="button" className="v2-btn v2-btn-secondary" disabled={busy || !target} onClick={doLink}>{t('docs.dr.link')}</button>
                  </>
                )}
                {mode === 'bank' && (
                  <>
                    <div className="v2-field-row">
                      <label className="v2-field"><span className="v2-field-label">{t('docs.fl.account')}</span>
                        <select className="v2-select" value={fl.wallet_id} disabled={busy} onChange={(e) => setFl((f) => ({ ...f, wallet_id: e.target.value }))} aria-label={t('docs.fl.account')}>
                          <option value="">{t('docs.dr.choose')}</option>
                          {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}{w.currency ? ` (${w.currency})` : ''}</option>)}
                        </select></label>
                      <label className="v2-field"><span className="v2-field-label">{t('docs.fl.month')}</span>
                        <input className="v2-input" type="month" value={fl.period} disabled={busy} onChange={(e) => setFl((f) => ({ ...f, period: e.target.value }))} aria-label={t('docs.fl.month')} /></label>
                    </div>
                    <button type="button" className="v2-btn v2-btn-secondary" disabled={busy || !fl.wallet_id || !fl.period}
                      onClick={() => run(() => fileDocument(token, doc.id, { kind: 'bank_account_period', wallet_id: fl.wallet_id, period: fl.period }), t('docs.fl.saved'))}>{t('docs.dr.save')}</button>
                  </>
                )}
                {mode === 'counterparty' && (
                  <>
                    <label className="v2-field"><span className="v2-field-label">{t('docs.fl.counterparty')}</span>
                      <select className="v2-select" value={fl.counterparty_id} disabled={busy} onChange={(e) => setFl((f) => ({ ...f, counterparty_id: e.target.value }))} aria-label={t('docs.fl.counterparty')}>
                        <option value="">{t('docs.dr.choose')}</option>
                        {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select></label>
                    <button type="button" className="v2-btn v2-btn-secondary" disabled={busy || !fl.counterparty_id}
                      onClick={() => run(() => fileDocument(token, doc.id, { kind: 'counterparty', counterparty_id: fl.counterparty_id }), t('docs.fl.saved'))}>{t('docs.dr.save')}</button>
                  </>
                )}
                {mode === 'keep' && (
                  <>
                    <div className="v2-field-row">
                      <label className="v2-field"><span className="v2-field-label">{t('docs.fl.reason')}</span>
                        <select className="v2-select" value={fl.reason} disabled={busy} onChange={(e) => setFl((f) => ({ ...f, reason: e.target.value }))} aria-label={t('docs.fl.reason')}>
                          {FILING_REASONS.map((r) => <option key={r} value={r}>{t(`docs.fl.reasons.${r}`)}</option>)}
                        </select></label>
                      <label className="v2-field"><span className="v2-field-label">{t('docs.fl.monthOptional')}</span>
                        <input className="v2-input" type="month" value={fl.period} disabled={busy} onChange={(e) => setFl((f) => ({ ...f, period: e.target.value }))} aria-label={t('docs.fl.month')} /></label>
                    </div>
                    <button type="button" className="v2-btn v2-btn-secondary" disabled={busy}
                      onClick={() => run(() => fileDocument(token, doc.id, { kind: 'keep', reason: fl.reason, period: fl.period || undefined }), t('docs.fl.saved'))}>{t('docs.fl.keep')}</button>
                  </>
                )}
              </section>

              {!verdict && (
                <section className="v2-card v2-docdrawer-sec">
                  <h3 className="v2-h3">{t('docs.dr.companyTitle')}</h3>
                  <p className="v2-muted v2-small">{t('docs.dr.companyAsk')}</p>
                  <div className="v2-row-gap">
                    <select className="v2-select" value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)} aria-label={t('docs.dr.companyPick')}>
                      <option value="">{t('docs.dr.companyPick')}</option>
                      {VAULT_TYPES.map((k) => <option key={k} value={k}>{t(`docs.vault.${k}`)}</option>)}
                    </select>
                    <button type="button" className="v2-btn v2-btn-secondary" disabled={busy || !kind}
                      onClick={() => run(() => confirmDocumentKind(token, doc.id, kind), null, true)}>{t('docs.dr.companyConfirm')}</button>
                  </div>
                </section>
              )}
            </>
          )}
          </div>
        </div>

        <footer className="v2-docmodal-foot">
          <button type="button" className="v2-btn v2-btn-ghost v2-docdrawer-archive" disabled={busy}
            onClick={() => { if (window.confirm(t('docs.dr.archiveConfirm'))) run(() => archiveDocument(token, doc.id), null, true) }}>{t('docs.dr.archive')}</button>
          <button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('docs.dr.close')}</button>
        </footer>
      </div>
    </>
  )
}
