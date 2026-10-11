import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { getLang } from '../i18n/index'
import { uploadDocument, getSignedUrl, MAX_FILE_BYTES } from '../lib/documents'

const L = {
  en: { documents: 'Documents', attached: 'attached', none: 'No documents yet', view: 'View', download: 'Download', unlink: 'Unlink', uploadNew: 'Upload & attach', attachExisting: 'Attach existing', uploading: 'Uploading…', by: 'by', pick: 'Choose a document to attach', cancel: 'Cancel', tooLarge: 'File is too large (max 20 MB)', failed: 'Failed', linkFailed: 'Uploaded, but linking failed — link it later in Documents' },
  ru: { documents: 'Документы', attached: 'прикреплено', none: 'Документов пока нет', view: 'Просмотр', download: 'Скачать', unlink: 'Отвязать', uploadNew: 'Загрузить и прикрепить', attachExisting: 'Прикрепить существующий', uploading: 'Загрузка…', by: '·', pick: 'Выберите документ для привязки', cancel: 'Отмена', tooLarge: 'Файл слишком большой (макс 20 МБ)', failed: 'Ошибка', linkFailed: 'Загружено, но привязать не удалось — привяжите позже в Документах' },
  id: { documents: 'Dokumen', attached: 'terlampir', none: 'Belum ada dokumen', view: 'Lihat', download: 'Unduh', unlink: 'Lepas', uploadNew: 'Unggah & lampirkan', attachExisting: 'Lampirkan yang ada', uploading: 'Mengunggah…', by: '·', pick: 'Pilih dokumen untuk dilampirkan', cancel: 'Batal', tooLarge: 'File terlalu besar (maks 20 MB)', failed: 'Gagal', linkFailed: 'Terunggah, tapi gagal melampirkan — lampirkan nanti di Dokumen' },
}

// Reusable inside a Payable / Receivable / Transaction drawer.
// targetType: 'debt' | 'transaction'.  canManage: role may link/unlink/upload.
export default function DocumentsPanel({ targetType, targetId, canManage = true }) {
  const { token } = useAuth()
  const l = L[['ru', 'id'].includes(getLang()) ? getLang() : 'en']
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pool, setPool] = useState([])
  const fileRef = useRef(null)

  const qkey = targetType === 'debt' ? 'debt_id' : 'transaction_id'
  const load = useCallback(() => {
    if (!token || !targetId) return
    apiFetch(`/documents?${qkey}=${targetId}`, token).then(r => setDocs(r.documents || [])).catch(() => {})
  }, [token, targetId, qkey])
  useEffect(() => { load() }, [load])

  const open = async (id, mode) => { try { const url = await getSignedUrl(token, id, mode); window.open(url, '_blank') } catch (e) { alert(e.message) } }
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > MAX_FILE_BYTES) { alert(l.tooLarge); return }
    setBusy(true)
    try {
      const r = await uploadDocument(token, file, {}, { target_type: targetType, target_id: targetId })
      if (r.link_result && r.link_result.ok === false) alert(l.linkFailed)
      load()
    } catch (e) { alert(e.message || l.failed) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const openPicker = async () => {
    setPicking(true)
    try { const r = await apiFetch('/documents?linked_status=unlinked&limit=50', token); setPool(r.documents || []) } catch { setPool([]) }
  }
  const attach = async (docId) => {
    setBusy(true)
    try { await apiFetch(`/documents/${docId}/links`, token, { method: 'POST', body: { target_type: targetType, target_id: targetId } }); setPicking(false); load() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const unlink = async (docId, linkId) => {
    if (!confirm(l.unlink + '?')) return
    setBusy(true)
    try { await apiFetch(`/documents/${docId}/links/${linkId}`, token, { method: 'DELETE' }); load() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
        {l.documents} · {docs.length} {l.attached}
      </div>
      {docs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 6 }}>{l.none}</div>}
      {docs.map(d => {
        const link = (d.links || []).find(x => x.target_type === targetType && String(x.target_id) === String(targetId))
        return (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '0.5px solid var(--border)', fontSize: 13 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {d.file?.file_name || d.document_number || d.document_type}</span>
            <button onClick={() => open(d.id, 'view')} style={mini}>{l.view}</button>
            <button onClick={() => open(d.id, 'download')} style={mini}>{l.download}</button>
            {canManage && link && <button onClick={() => unlink(d.id, link.link_id)} style={{ ...mini, color: 'var(--red-dark,#991B1B)' }}>{l.unlink}</button>}
          </div>
        )
      })}
      {canManage && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" style={{ display: 'none' }} onChange={onFile} />
          <button disabled={busy} onClick={() => fileRef.current?.click()} style={btn}>{busy ? l.uploading : '＋ ' + l.uploadNew}</button>
          <button disabled={busy} onClick={openPicker} style={btn}>{l.attachExisting}</button>
        </div>
      )}
      {picking && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setPicking(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, width: 420, maxHeight: '70vh', overflow: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{l.pick}</div>
            {pool.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{l.none}</div>}
            {pool.map(d => (
              <div key={d.id} onClick={() => attach(d.id)} style={{ padding: '8px 6px', borderTop: '0.5px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                📄 {d.file?.file_name || d.document_number || d.document_type}
              </div>
            ))}
            <button onClick={() => setPicking(false)} style={{ ...btn, marginTop: 10 }}>{l.cancel}</button>
          </div>
        </div>
      )}
    </div>
  )
}
const btn = { fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
const mini = { fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)' }
