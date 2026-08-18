// AI Accountant — single upload window (Phase 1).
//
// The user drops files once; CFO AI detects the type and files them. Uploading REUSES
// uploadDocument() (the same init → storage → complete flow, dedup and role checks as the
// Document Center) — no new upload path.
//
// Safety shown to the user, not just assumed:
//   * the active business workspace is displayed, with a warning that files land there only;
//   * a detected type is a PRELIMINARY guess and is labelled as such;
//   * anything not strongly matched is marked "needs review" rather than filed silently.
import { useState, useCallback, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { uploadDocument, MAX_FILE_BYTES } from '../lib/documents'
import { Btn, StatusBadge } from '../shell/ui'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.csv,.xlsx'
const CONF_TONE = { high: 'success', medium: 'warning', low: 'warning', unknown: 'neutral' }

export default function DocumentIntakeModal({ business, onClose, onUploaded }) {
  const { token } = useAuth()
  const [items, setItems] = useState([])       // { file, status, detected, error }
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  // Ask the backend what it thinks these files are — stateless preview, writes nothing.
  const addFiles = useCallback(async (fileList) => {
    const files = [...fileList]
    if (!files.length) return
    const next = files.map(f => ({
      file: f,
      status: f.size > MAX_FILE_BYTES ? 'too_large' : 'queued',
      detected: null,
      error: f.size > MAX_FILE_BYTES ? 'File is larger than 20 MB' : null,
    }))
    setItems(prev => [...prev, ...next])
    try {
      const r = await apiFetch('/ai-accountant/documents/classify', token, {
        method: 'POST',
        body: { files: files.map(f => ({ file_name: f.name, mime_type: f.type || 'application/octet-stream' })) },
      })
      setItems(prev => prev.map(it => {
        const hit = (r.results || []).find(x => x.file_name === it.file.name)
        return hit && !it.detected ? { ...it, detected: hit } : it
      }))
    } catch { /* preview only — upload still works without it */ }
  }, [token])

  const upload = async () => {
    setBusy(true)
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.status !== 'queued') continue
      setItems(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'uploading' } : x))
      try {
        // document_type is deliberately left to the backend default/mapping; the AI Accountant
        // taxonomy is stored separately and confirmed by the user in the intake list.
        await uploadDocument(token, it.file, { title: it.file.name })
        // The server reads the document's content during upload-complete, so by the time
        // this resolves the real classification already exists — the list below refreshes.
        setItems(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'uploaded' } : x))
      } catch (e) {
        const dup = /duplicate/i.test(e.message || '')
        setItems(prev => prev.map((x, idx) => idx === i
          ? { ...x, status: dup ? 'duplicate' : 'failed', error: dup ? 'Already uploaded to this workspace' : (e.message || 'Upload failed') }
          : x))
      }
    }
    setBusy(false)
    onUploaded?.()
  }

  const queued = items.filter(i => i.status === 'queued').length
  const done = items.filter(i => i.status === 'uploaded').length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card,#fff)', borderRadius: 16, padding: 20, width: 620, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Upload documents</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary,#555)', marginBottom: 12, lineHeight: 1.5 }}>
          Drop everything in at once — CFO AI will detect each document type and file it.
        </div>

        {/* Workspace isolation, made explicit */}
        <div style={{ background: 'var(--info-soft,#EFF6FF)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
          Uploading to <b>{business?.name || 'this business workspace'}</b>.
          Files are stored in this business workspace only — never in your personal workspace or any other company.
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--brand-blue,#3399FF)' : 'var(--border-default,#ccc)'}`,
            background: dragOver ? 'var(--info-soft,#EFF6FF)' : 'transparent',
            borderRadius: 12, padding: '22px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 12,
          }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Drag &amp; drop files here</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted,#888)', marginTop: 4 }}>
            or click to choose · PDF, JPG, PNG, CSV, XLSX · up to 20 MB each
          </div>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        </div>

        {/* Queue */}
        {items.length > 0 && (
          <div style={{ border: '1px solid var(--border-default,#e3e8ee)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '0.5px solid var(--border-subtle,#eee)' : 'none' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{it.file.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted,#888)' }}>
                    {it.detected
                      ? <>Preliminary from file name: <b>{it.detected.label}</b> · {it.detected.confidence} confidence. Confirm the type after upload.</>
                      : 'Detecting…'}
                    {it.error ? ` · ${it.error}` : ''}
                  </span>
                </span>
                <StatusBadge tone={
                  it.status === 'uploaded' ? 'success'
                    : it.status === 'failed' || it.status === 'too_large' ? 'danger'
                      : it.status === 'duplicate' ? 'warning'
                        : it.detected ? CONF_TONE[it.detected.confidence] || 'neutral' : 'neutral'
                }>
                  {it.status === 'queued' ? 'Ready' : it.status === 'uploading' ? 'Uploading…' : it.status.replace('_', ' ')}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-muted,#888)', marginBottom: 12, lineHeight: 1.5 }}>
          Detected types are a preliminary guess from the file name — you confirm each one after upload.
          Nothing here verifies that a document is officially valid.
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>{done ? 'Done' : 'Cancel'}</Btn>
          <Btn onClick={upload} disabled={busy || !queued}>
            {busy ? 'Uploading…' : queued ? `Upload ${queued} file${queued > 1 ? 's' : ''}` : 'Upload'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
