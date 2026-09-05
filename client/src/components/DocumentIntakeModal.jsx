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
import { uploadDocument, getSignedUrl, MAX_FILE_BYTES } from '../lib/documents'
import { Btn, StatusBadge } from '../shell/ui'
import { TYPE_LABEL } from '../pages/business/evidenceModel'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.csv,.xlsx'

/* An unambiguous state per file. "Ready" used to mean "chosen, nothing sent yet", which
   read as "done" — so a user could close the window believing a file had been uploaded
   when nothing had left the browser. Each state now says exactly where the file is. */
const STATE_LABEL = (it) => {
  if (it.status === 'queued') return 'Selected — not uploaded yet'
  if (it.status === 'uploading') {
    return it.stage === 'creating' ? 'Creating document…' : 'Uploading file…'
  }
  if (it.status === 'uploaded') return 'Document uploaded'
  if (it.status === 'too_large') return 'Too large'
  if (it.status === 'duplicate') return 'Already uploaded'
  if (it.status === 'failed') return 'Not uploaded'
  return it.status.replace('_', ' ')
}
const CONF_TONE = { high: 'success', medium: 'warning', low: 'warning', unknown: 'neutral' }

export default function DocumentIntakeModal({ business, onClose, onUploaded, link = null,
  heading = null, defaultType = null, onLinkExisting = null,
  // Which screen this upload came from. Stored as review metadata so a document that
  // cannot be read still carries what the user believed they were filing. It never
  // becomes the document_type column.
  uploadSource = 'document_center_upload',
  // Called with { id, file_name } the moment a document row really exists, so the
  // list can show it immediately instead of waiting for the modal to close.
  onDocumentCreated = null,
  onOpenDocument = null }) {
  // `link` = { target_type, target_id }. /api/documents/upload-complete already accepts it
  // and links best-effort, so uploading evidence FOR a specific record is one real call —
  // no global upload the user then has to hunt down and attach by hand.
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
    // One click, one pass. A second click while a request is in flight would issue a
    // second upload-init and create a second document row for the same file.
    if (busy) return
    setBusy(true)
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.status !== 'queued' && it.status !== 'failed') continue
      setItems(prev => prev.map((x, idx) => idx === i ? { ...x, status: 'uploading', stage: 'storing', error: null } : x))
      try {
        // document_type is deliberately left to the backend default/mapping; the AI Accountant
        // taxonomy is stored separately and confirmed by the user in the intake list.
        // When the caller asked for a specific role (payment proof), file it AS that type.
        // Left to the default it would land as `other` and could never satisfy a
        // role-specific evidence requirement.
        const meta = { title: it.file.name, upload_source: uploadSource }
        if (defaultType) meta.document_type = defaultType
        const res = await uploadDocument(token, it.file, meta, link || undefined,
          (stage) => setItems(prev => prev.map((x, idx) => idx === i ? { ...x, stage } : x)))

        // A stored object is NOT a successful upload. Success requires the document row,
        // and the row is what the Evidence Inbox lists — so we confirm its id before
        // claiming anything. Without this a storage PUT that succeeded while the
        // database insert failed would have read as "uploaded".
        const documentId = res?.document?.id || null
        if (!documentId) throw Object.assign(new Error('The file was stored but no document record was created.'), { partial: true })
        setItems(prev => prev.map((x, idx) => idx === i
          ? { ...x, status: 'uploaded', stage: 'done', documentId, fileId: res?.document?.file_id || null,
              // Where it actually went. Routing is confirmed-only now, so a fresh
              // upload always lands in the Evidence Inbox.
              destination: 'inbox' }
          : x))
        onDocumentCreated?.({ id: documentId, file_name: it.file.name })
      } catch (e) {
        // upload-init answers a SHA-256 match with 409 { duplicate, existing_document_id }.
        // That id is the real existing document — surfaced, never guessed.
        const dup = e.code === 'duplicate' || /duplicate/i.test(e.message || '')
        const existingId = e.data?.existing_document_id || null
        setItems(prev => prev.map((x, idx) => idx === i
          ? { ...x, status: dup ? 'duplicate' : 'failed', existingId, stage: null,
              partial: !!e.partial,
              error: dup
                ? 'This file is already uploaded to this workspace.'
                : (e.message || 'Upload failed') }
          : x))
      }
    }
    setBusy(false)
    // Refresh the list either way — a partial batch still has documents to show. The
    // modal stays open so a failure is read, not dismissed.
    onUploaded?.()
  }

  const openExisting = async (id) => {
    try { const url = await getSignedUrl(token, id); if (url) window.open(url, '_blank', 'noopener') }
    catch { /* the row already shows the duplicate; a failed preview changes nothing */ }
  }

  const queued = items.filter(i => i.status === 'queued').length
  const uploaded = items.filter(i => i.status === 'uploaded')
  const failed = items.filter(i => i.status === 'failed')
  // A failed file keeps its place in the queue so "Try again" can resend exactly it.
  const retryable = failed.length > 0
  const done = uploaded.length

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface-card,#fff)', borderRadius: 16, padding: 20, width: 620, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{heading || 'Upload documents'}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary,#555)', marginBottom: 12, lineHeight: 1.5 }}>
          Drop everything in at once — CFO AI will detect each document type and file it.
        </div>

        {/* Workspace isolation, made explicit */}
        <div style={{ background: 'var(--info-soft,#EFF6FF)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
          Uploading to <b>{business?.name || 'this business workspace'}</b>.
          Files are stored in this business workspace only — never in your personal workspace or any other company.
        </div>

        {defaultType && (
          <div style={{ background: 'var(--warning-soft,#FBF1DF)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
            Filing as <b>{TYPE_LABEL[defaultType] || defaultType}</b> so it counts as the right
            kind of evidence on this record. You can change the type afterwards in Documents.
          </div>
        )}

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
                  {STATE_LABEL(it)}
                </StatusBadge>
              </div>
            ))}
            {items.some(it => it.status === 'duplicate' && it.existingId) && (
              <div style={{ padding: '9px 12px', borderTop: '0.5px solid var(--border-subtle,#eee)', background: 'var(--warning-soft,#FBF1DF)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>Possible duplicate document</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary,#555)' }}>
                  This file already exists in this workspace, so it was not uploaded again.
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                  {items.filter(it => it.status === 'duplicate' && it.existingId).slice(0, 1).map((it, i) => (
                    <span key={i} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => openExisting(it.existingId)}
                        style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--text-link,#1565C0)', cursor: 'pointer' }}>
                        Open existing document
                      </button>
                      {onLinkExisting && link && (
                        <button type="button" onClick={() => onLinkExisting(it.existingId)}
                          style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--text-link,#1565C0)', cursor: 'pointer' }}>
                          Link the existing one to this record instead
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-muted,#888)', marginBottom: 12, lineHeight: 1.5 }}>
          Detected types are a preliminary guess from the file name — you confirm each one after upload.
          A file name never decides where a document is filed.
        </div>

        {/* ── the outcome ───────────────────────────────────────────────────
            Stated only once a document_id came back, and it names the destination
            so nobody has to go looking for the file afterwards. */}
        {uploaded.length > 0 && (
          <div style={{ background: 'var(--success-soft,#E8F6EE)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>
              {uploaded.length === 1 ? 'Document uploaded successfully' : `${uploaded.length} documents uploaded successfully`}
            </div>
            {uploaded.map((it, i) => (
              <div key={i} style={{ fontSize: 12.5, marginTop: 4 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.file.name}</div>
                <div style={{ color: 'var(--text-secondary,#555)' }}>
                  {it.destination === 'vault' ? 'Saved to Company Vault' : 'Added to Evidence Inbox'}
                  {' · Analysis in progress'}
                </div>
                {onOpenDocument && it.documentId && (
                  <button type="button" onClick={() => onOpenDocument(it.documentId)}
                    style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--text-link,#1565C0)', cursor: 'pointer', marginTop: 2 }}>
                    Open document
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {failed.length > 0 && (
          <div style={{ background: 'var(--danger-soft,#FDECEC)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Document was not uploaded</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary,#555)' }}>
              {failed.length === 1 ? 'It was not added to Evidence Inbox.' : 'They were not added to Evidence Inbox.'}
            </div>
            {failed.map((it, i) => (
              <div key={i} style={{ fontSize: 12.5, marginTop: 4 }}>
                <span style={{ fontWeight: 600 }}>{it.file.name}</span>
                {it.error ? <span style={{ color: 'var(--text-secondary,#555)' }}> — {it.error}</span> : null}
                {it.partial && (
                  <div style={{ color: 'var(--text-secondary,#555)' }}>
                    The file reached storage but no document record was created, so it is not in your
                    workspace. Try again — a repeat upload of the same file is detected as a duplicate.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>{done ? 'Done' : 'Cancel'}</Btn>
          <Btn onClick={upload} disabled={busy || (!queued && !retryable)}>
            {busy
              ? (items.some(i => i.stage === 'creating') ? 'Creating document…' : 'Uploading file…')
              : retryable && !queued ? `Try again`
                : queued ? `Upload and analyze ${queued} file${queued > 1 ? 's' : ''}`
                  : 'Upload'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
