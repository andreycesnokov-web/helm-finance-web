// New bill or invoice (design w2/E1) — replaces the classic "new obligation" form in v2.
// Upload the invoice first and the fields fill in: POST /api/documents/:id/extract (the text
// reader; nothing written) and, for a scan, POST /api/documents/:id/identify (the AI explanation).
// The user checks every field. Saving: POST /api/debts (the server sets approval by role) and the
// invoice is linked to the bill (POST /api/documents/:id/links). Money moves only when a payment
// is marked.
import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useT, useLang } from '../i18n'
import { useApi } from '../data'
import { money } from '../lib/format'
import Modal from './Modal'
import { uploadInvoiceFile, readInvoice, identifyDocument, createBill, updateBill, linkDocument } from '../lib/actions'

const CURRENCIES = ['IDR', 'USD', 'SGD', 'EUR', 'MYR', 'AUD', 'CNY', 'JPY']
const isoDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const num = (v) => { const n = Number(String(v ?? '').replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
const dateOf = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(String(d.value || d)) ? String(d.value || d).slice(0, 10) : '')

export default function BillDialog({ mode = 'payable', debt: editing = null, onClose, onSaved }) {
  const t = useT()
  const lang = useLang()
  const { token } = useAuth()
  const cps = useApi('/counterparties')
  const [kind, setKind] = useState(editing?.type || mode)
  const [f, setF] = useState(editing
    ? { counterparty: editing.counterparty || '', number: '', amount: String(editing.original_amount ?? editing.amount ?? ''), currency: editing.currency || 'IDR', date: '', due: editing.due_date ? String(editing.due_date).slice(0, 10) : '', description: editing.description || '' }
    : { counterparty: '', number: '', amount: '', currency: 'IDR', date: '', due: isoDays(14), description: '' })
  const [from, setFrom] = useState({})          // field → 'doc' when it came from the invoice
  const [doc, setDoc] = useState(null)          // { id, name, state, dup?, taxNote? }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef(null)
  const names = useMemo(() => (cps.data?.counterparties || cps.data || []).map((c) => c.name).filter(Boolean), [cps.data])
  const known = names.some((n) => n.toLowerCase() === f.counterparty.trim().toLowerCase())
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setFrom((m) => ({ ...m, [k]: null })) }

  const upload = async (file) => {
    setErr(''); setDoc({ name: file.name, state: 'uploading' })
    let id
    try { id = (await uploadInvoiceFile(token, file, kind))?.document?.id } catch (x) {
      if (x?.status === 409 && x?.data?.existing_document_id) id = x.data.existing_document_id
      else { setDoc({ name: file.name, state: 'failed', error: x?.data?.error || x?.message }); return }
    }
    setDoc({ id, name: file.name, state: 'reading' })
    const fill = {}
    let dup = null
    try {
      const r = await readInvoice(token, id)
      const x = r?.extraction?.fields || {}
      fill.counterparty = kind === 'payable' ? x.issuer_name : x.buyer_name
      fill.number = x.document_number
      fill.amount = x.gross_amount ?? x.amount
      fill.currency = x.currency
      fill.date = dateOf(r?.dates?.document_date)
      fill.due = dateOf(r?.dates?.due_date)
      fill.description = x.description
      dup = r?.duplicate || null
    } catch { /* the AI explanation below may still fill it */ }
    let taxNote = null
    let fromImage = false
    if (!fill.amount || !fill.counterparty) {
      try {
        let r = await identifyDocument(token, id, { lang })
        // A reading stored before invoice totals were asked for has none: read the file once more.
        if (r?.cached && !r?.identify?.explanation?.total_amount) r = await identifyDocument(token, id, { lang, force: true })
        const ident = r?.identify || {}
        const ex = ident.explanation || {}
        fill.counterparty = fill.counterparty || ex.counterparty_name || ex.issued_by
        fill.number = fill.number || ex.number
        fill.amount = fill.amount || ex.total_amount
        fill.currency = ex.total_amount && ex.currency ? ex.currency : fill.currency
        fill.date = fill.date || dateOf(ex.issued_on)
        fill.due = fill.due || dateOf(ex.due_on)
        fill.description = fill.description || ex.title
        fromImage = ident.read === 'file_to_model'
        taxNote = (ident.taxes || []).map((x) => x.what).filter(Boolean).join(' ') || null
      } catch { /* fields stay for the user to type */ }
    }
    const next = {}; const src = {}
    for (const [k, v] of Object.entries(fill)) if (v != null && v !== '' && !(k === 'currency' && !fill.amount)) { next[k] = k === 'amount' ? String(v) : String(v).slice(0, 200); src[k] = fromImage ? 'image' : 'doc' }
    if (next.currency && !CURRENCIES.includes(String(next.currency).toUpperCase())) delete next.currency
    else if (next.currency) next.currency = String(next.currency).toUpperCase()
    setF((x) => ({ ...x, ...next })); setFrom(src)
    setDoc({ id, name: file.name, state: Object.keys(next).length ? 'read' : 'unread', dup, taxNote })
  }

  const amount = num(f.amount)
  const save = async () => {
    if (!f.counterparty.trim()) { setErr(t('billd.err.who')); return }
    if (!(amount > 0)) { setErr(t('billd.err.amount')); return }
    setBusy(true); setErr('')
    try {
      const desc = [f.number ? `№ ${f.number}` : '', f.description.trim()].filter(Boolean).join(' · ') || null
      const debt = editing
        ? await updateBill(token, editing.id, { counterparty: f.counterparty.trim(), amount, currency: f.currency, due_date: f.due || null, description: desc })
        : await createBill(token, { type: kind, counterparty: f.counterparty.trim(), amount, currency: f.currency, due_date: f.due || null, description: desc, scope: 'business' })
      if (doc?.id && debt?.id) { try { await linkDocument(token, doc.id, 'debt', debt.id) } catch { /* the bill exists; the invoice stays in Documents */ } }
      onSaved?.(debt); onClose()
    } catch (x) { setErr(x?.status === 403 ? t('dec.forbidden') : (x?.data?.message || x?.data?.error || x?.message)) } finally { setBusy(false) }
  }
  const mark = (k) => (from[k] ? <span className={`v2-pill v2-tone-${from[k] === 'image' ? 'warn' : 'info'} v2-billd-from`}>{t(from[k] === 'image' ? 'billd.fromImage' : 'billd.fromDoc')}</span> : null)
  return (
    <Modal wide title={editing ? t('billd.editTitle', { who: editing.counterparty || '' }) : t('billd.title')} onClose={onClose}
      footer={<><button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('set.cancel')}</button>
        <button type="button" className="v2-btn v2-btn-primary" disabled={busy || ['uploading', 'reading'].includes(doc?.state)} onClick={save} data-billd-save>{t('billd.save')}</button></>}>
      {!editing && <><div className="v2-seg" role="group" aria-label={t('billd.kind')}>
        <button type="button" className="v2-seg-btn" aria-pressed={kind === 'payable'} onClick={() => setKind('payable')}>{t('billd.payable')}</button>
        <button type="button" className="v2-seg-btn" aria-pressed={kind === 'receivable'} onClick={() => setKind('receivable')}>{t('billd.receivable')}</button>
      </div>
      <div className="v2-setup-drop v2-billd-drop" role="button" tabIndex={0} onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) upload(e.dataTransfer.files[0]) }}>
        <strong>{t('billd.drop')}</strong>
        <span className="v2-muted v2-small" data-billd-doc={doc?.state || 'none'}>{doc ? t(`billd.st.${doc.state}`, { name: doc.name, msg: doc.error || '' }) : t('billd.dropHint')}</span>
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden data-billd-file onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = '' }} />
      </div>
      </>}
      {doc?.dup && <div className="v2-banner v2-tone-warn" role="status"><span className="v2-banner-text">{t('billd.dup')}</span></div>}
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t(kind === 'payable' ? 'billd.vendor' : 'billd.customer')} {mark('counterparty')}</span>
          <input className="v2-input" list="billd-cps" value={f.counterparty} onChange={(e) => set('counterparty', e.target.value)} />
          <datalist id="billd-cps">{names.map((n) => <option key={n} value={n} />)}</datalist>
          {f.counterparty.trim() && <span className="v2-muted v2-small">{known ? t('billd.known') : t('billd.newCp')}</span>}</label>
        <label className="v2-field"><span className="v2-field-label">{t('billd.number')} {mark('number')}</span>
          <input className="v2-input" value={f.number} onChange={(e) => set('number', e.target.value)} /></label>
      </div>
      <div className="v2-field-row">
        <label className="v2-field"><span className="v2-field-label">{t('billd.amount')} {mark('amount')}</span>
          <input className="v2-input v2-num" inputMode="decimal" value={f.amount} aria-invalid={f.amount !== '' && !(amount > 0)} onChange={(e) => set('amount', e.target.value)} />
          {amount > 0 && <span className="v2-muted v2-small">{money(amount, { currency: f.currency, full: true })}</span>}</label>
        <label className="v2-field"><span className="v2-field-label">{t('accd.currency')} {mark('currency')}</span>
          <select className="v2-select" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="v2-field"><span className="v2-field-label">{t('billd.date')} {mark('date')}</span>
          <input className="v2-input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label className="v2-field"><span className="v2-field-label">{t('billd.due')} {mark('due')}</span>
          <input className="v2-input" type="date" value={f.due} onChange={(e) => set('due', e.target.value)} /></label>
      </div>
      <label className="v2-field"><span className="v2-field-label">{t('txd.desc')} {mark('description')}</span>
        <input className="v2-input" value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
      {doc?.taxNote && <p className="v2-imp-tax v2-small">{doc.taxNote}</p>}
      <p className="v2-muted v2-small">{t('billd.note')}</p>
      {err && <p className="v2-inline-err" role="alert">{err}</p>}
    </Modal>
  )
}
