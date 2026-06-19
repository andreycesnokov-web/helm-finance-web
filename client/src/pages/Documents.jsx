import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmtFull } from '../lib/api'
import { getLang } from '../i18n/index'
import { uploadDocument, getSignedUrl, DOC_TYPES, MAX_FILE_BYTES } from '../lib/documents'

const L = {
  en: { title: 'Documents', sub: 'Financial evidence, invoices, receipts and compliance files.', upload: 'Upload document',
    all: 'All', unlinked: 'Unlinked', linked: 'Linked', month: 'This month', archived: 'Archived',
    search: 'Search…', allTypes: 'All types', allStatus: 'Linked / unlinked', empty: 'No documents',
    type: 'Type', name: 'Title / file', date: 'Date', amount: 'Amount', links: 'Links', uploadedBy: 'Uploaded by', status: 'Status', actions: '',
    view: 'View', download: 'Download', archive: 'Archive', file: 'File', titleField: 'Title', docDate: 'Document date', currency: 'Currency', desc: 'Description', linkTo: 'Link to', none: 'None', payable: 'Payable / Receivable (debt id)', transaction: 'Transaction id', save: 'Upload', cancel: 'Cancel', tooLarge: 'File is too large (max 20 MB)', dup: 'This file is already in your documents', linkFail: 'Uploaded, but linking failed — link it later', uploading: 'Uploading…', notEnabled: 'Document Center is not enabled on this plan' },
  ru: { title: 'Документы', sub: 'Финансовые доказательства, счета, чеки и комплаенс-файлы.', upload: 'Загрузить документ',
    all: 'Все', unlinked: 'Непривязанные', linked: 'Привязанные', month: 'За месяц', archived: 'Архив',
    search: 'Поиск…', allTypes: 'Все типы', allStatus: 'Привязка', empty: 'Нет документов',
    type: 'Тип', name: 'Название / файл', date: 'Дата', amount: 'Сумма', links: 'Связи', uploadedBy: 'Загрузил', status: 'Статус', actions: '',
    view: 'Просмотр', download: 'Скачать', archive: 'В архив', file: 'Файл', titleField: 'Название', docDate: 'Дата документа', currency: 'Валюта', desc: 'Описание', linkTo: 'Привязать к', none: 'Нет', payable: 'Payable / Receivable (debt id)', transaction: 'Transaction id', save: 'Загрузить', cancel: 'Отмена', tooLarge: 'Файл слишком большой (макс 20 МБ)', dup: 'Этот файл уже есть в документах', linkFail: 'Загружено, но привязать не удалось — привяжите позже', uploading: 'Загрузка…', notEnabled: 'Document Center недоступен на этом плане' },
  id: { title: 'Dokumen', sub: 'Bukti keuangan, faktur, kuitansi, dan berkas kepatuhan.', upload: 'Unggah dokumen',
    all: 'Semua', unlinked: 'Belum tertaut', linked: 'Tertaut', month: 'Bulan ini', archived: 'Arsip',
    search: 'Cari…', allTypes: 'Semua tipe', allStatus: 'Tautan', empty: 'Tidak ada dokumen',
    type: 'Tipe', name: 'Judul / file', date: 'Tanggal', amount: 'Jumlah', links: 'Tautan', uploadedBy: 'Diunggah oleh', status: 'Status', actions: '',
    view: 'Lihat', download: 'Unduh', archive: 'Arsip', file: 'File', titleField: 'Judul', docDate: 'Tanggal dokumen', currency: 'Mata uang', desc: 'Deskripsi', linkTo: 'Tautkan ke', none: 'Tidak ada', payable: 'Payable / Receivable (debt id)', transaction: 'Transaction id', save: 'Unggah', cancel: 'Batal', tooLarge: 'File terlalu besar (maks 20 MB)', dup: 'File ini sudah ada di dokumen Anda', linkFail: 'Terunggah, tapi gagal menautkan — tautkan nanti', uploading: 'Mengunggah…', notEnabled: 'Document Center tidak aktif di paket ini' },
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function Documents() {
  const { token } = useAuth()
  const l = L[['ru', 'id'].includes(getLang()) ? getLang() : 'en']
  const [docs, setDocs] = useState([]); const [error, setError] = useState(null)
  const [f, setF] = useState({ search: '', type: '', linked_status: '', status: '' })
  const [showUpload, setShowUpload] = useState(false)

  const load = useCallback(() => {
    if (!token) return
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()
    apiFetch(`/documents${qs ? '?' + qs : ''}`, token).then(r => { setDocs(r.documents || []); setError(null) }).catch(setError)
  }, [token, f])
  useEffect(() => { load() }, [load])

  const open = async (id, mode) => { try { window.open(await getSignedUrl(token, id, mode), '_blank') } catch (e) { alert(e.message) } }
  const archive = async (id) => { if (!confirm(l.archive + '?')) return; try { await apiFetch(`/documents/${id}/archive`, token, { method: 'POST', body: {} }); load() } catch (e) { alert(e.message) } }

  if (error) {
    const enabled = /not enabled|upgrade/i.test(error.message || '')
    return <div style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 48 }}>{enabled ? '🔒' : '⚠️'}</div><div style={{ marginTop: 8 }}>{enabled ? l.notEnabled : error.message}</div></div>
  }

  const counts = {
    all: docs.length,
    unlinked: docs.filter(d => (d.links || []).length === 0).length,
    linked: docs.filter(d => (d.links || []).length > 0).length,
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>📄 {l.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{l.sub}</div>
        </div>
        <button onClick={() => setShowUpload(true)} style={{ ...btn, fontWeight: 700, background: 'var(--accent,#4F46E5)', color: '#fff', borderColor: 'transparent' }}>＋ {l.upload}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
        {[['all', counts.all], ['unlinked', counts.unlinked], ['linked', counts.linked]].map(([k, n]) => (
          <div key={k} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 12px', fontSize: 12 }}>
            <b>{n}</b> <span style={{ color: 'var(--text-3)' }}>{l[k]}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={f.search} onChange={e => setF({ ...f, search: e.target.value })} placeholder={l.search} style={{ flex: 1, minWidth: 160, padding: '7px 10px', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 13 }} />
        <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} style={sel}><option value="">{l.allTypes}</option>{DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <select value={f.linked_status} onChange={e => setF({ ...f, linked_status: e.target.value })} style={sel}><option value="">{l.allStatus}</option><option value="linked">{l.linked}</option><option value="unlinked">{l.unlinked}</option></select>
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} style={sel}><option value="">{l.all}</option><option value="archived">{l.archived}</option></select>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>
            {[l.type, l.name, l.date, l.amount, l.links, l.status, l.actions].map((h, i) => <th key={i} style={{ padding: 8, whiteSpace: 'nowrap' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {docs.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>{l.empty}</td></tr>}
            {docs.map(d => (
              <tr key={d.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                <td style={{ padding: 8 }}>{d.document_type}</td>
                <td style={{ padding: 8 }}>{d.document_number || d.file?.file_name || '—'}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmtDate(d.document_date)}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{d.gross_amount != null ? `${fmtFull(d.gross_amount)} ${d.currency || ''}` : '—'}</td>
                <td style={{ padding: 8 }}>{(d.links || []).length || '—'}</td>
                <td style={{ padding: 8 }}>{d.archived_at ? '🗄' : (d.links || []).length ? '🔗' : '○'}</td>
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  <button onClick={() => open(d.id, 'view')} style={mini}>{l.view}</button>
                  <button onClick={() => open(d.id, 'download')} style={mini}>{l.download}</button>
                  {!d.archived_at && <button onClick={() => archive(d.id)} style={mini}>{l.archive}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showUpload && <UploadModal token={token} l={l} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load() }} />}
    </div>
  )
}

function UploadModal({ token, l, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [m, setM] = useState({ document_type: 'other', title: '', document_date: '', currency: 'IDR', description: '', amount: '' })
  const [link, setLink] = useState({ kind: '', id: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null)

  const submit = async () => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setErr(l.tooLarge); return }
    setBusy(true); setErr(null)
    const linkArg = link.kind && link.id ? { target_type: link.kind, target_id: link.id } : null
    try {
      const r = await uploadDocument(token, file, { ...m, amount: m.amount || null }, linkArg)
      if (r.link_result && r.link_result.ok === false) alert(l.linkFail)
      onDone()
    } catch (e) { setErr(/duplicate/i.test(e.message) ? l.dup : e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 16, padding: 20, width: 460, maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{l.upload}</div>
        <Field label={l.file}><input type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
        <Field label={l.type}><select value={m.document_type} onChange={e => setM({ ...m, document_type: e.target.value })} style={inp}>{DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label={l.titleField}><input value={m.title} onChange={e => setM({ ...m, title: e.target.value })} style={inp} /></Field>
        <Field label={l.docDate}><input type="date" value={m.document_date} onChange={e => setM({ ...m, document_date: e.target.value })} style={inp} /></Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field label={l.amount}><input type="number" value={m.amount} onChange={e => setM({ ...m, amount: e.target.value })} style={inp} /></Field>
          <Field label={l.currency}><input value={m.currency} onChange={e => setM({ ...m, currency: e.target.value })} style={inp} /></Field>
        </div>
        <Field label={l.desc}><textarea value={m.description} onChange={e => setM({ ...m, description: e.target.value })} style={{ ...inp, minHeight: 50 }} /></Field>
        <Field label={l.linkTo}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={link.kind} onChange={e => setLink({ ...link, kind: e.target.value })} style={inp}>
              <option value="">{l.none}</option><option value="debt">{l.payable}</option><option value="transaction">{l.transaction}</option>
            </select>
            {link.kind && <input placeholder="id" value={link.id} onChange={e => setLink({ ...link, id: e.target.value })} style={{ ...inp, width: 90 }} />}
          </div>
        </Field>
        {err && <div style={{ color: 'var(--red-dark,#991B1B)', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={btn}>{l.cancel}</button>
          <button disabled={busy || !file} onClick={submit} style={{ ...btn, fontWeight: 700, background: 'var(--accent,#4F46E5)', color: '#fff', borderColor: 'transparent' }}>{busy ? l.uploading : l.save}</button>
        </div>
      </div>
    </div>
  )
}
const Field = ({ label, children }) => <div style={{ marginBottom: 10 }}><div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3 }}>{label}</div>{children}</div>
const inp = { width: '100%', padding: '7px 9px', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', boxSizing: 'border-box' }
const sel = { padding: '7px 9px', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 13, background: 'var(--bg)' }
const btn = { fontSize: 13, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
const mini = { fontSize: 11, padding: '3px 8px', marginRight: 4, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
