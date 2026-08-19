// Confirmation before removing a document from the AI Accountant intake.
//
// This is a SOFT archive: it sets archived_at through the existing audited
// POST /api/documents/:id/archive. The file is not deleted from storage, and the row stays
// visible in the Document Center and the audit history. Nothing here can hard-delete.
//
// The friction scales with what is at stake:
//   * a document that merely needs review → one explicit "Archive document" click;
//   * a MANUALLY CONFIRMED compliance document → the exact file name must be typed, because
//     archiving it can make a satisfied checklist item missing again.
import { useState } from 'react'
import { Btn, StatusBadge } from '../shell/ui'

export default function ArchiveDocumentModal({ doc, businessName, onCancel, onConfirm, busy }) {
  const [typed, setTyped] = useState('')
  if (!doc) return null

  const confirmed = doc.intake?.classification_status === 'manually_confirmed'
  const fileName = doc.file_name || ''
  // Typing is only required where archiving can undo a compliance answer the user already gave.
  const needsTypedName = confirmed && !!fileName
  const canArchive = !busy && (!needsTypedName || typed.trim() === fileName)

  return (
    <div role="dialog" aria-modal="true" aria-label="Archive document"
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 90 }}
      onClick={busy ? undefined : onCancel}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', padding: 20, width: 460, maxWidth: '100%' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Archive document?</div>

        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          This removes the document from the AI Accountant checklist and intake.
          The file is kept for audit and history unless it is deleted from the Document Center.
        </div>

        <div style={{ margin: '12px 0', padding: '10px 12px', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', fontSize: 12.5 }}>
          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{fileName || '(unnamed file)'}</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
            {doc.intake?.label || 'Unclassified'} · {businessName || 'this workspace'}
          </div>
          {confirmed && <div style={{ marginTop: 6 }}><StatusBadge tone="success">manually confirmed</StatusBadge></div>}
        </div>

        {confirmed && (
          <div style={{ fontSize: 12.5, color: 'var(--warning)', marginBottom: 10, lineHeight: 1.55 }}>
            ⚠ Archiving this document may make the checklist item missing again.
          </div>
        )}

        {needsTypedName && (
          <label style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Type the file name to confirm:</span>
            <input className="cfo-input" value={typed} onChange={e => setTyped(e.target.value)}
              placeholder={fileName} autoFocus disabled={busy}
              style={{ width: '100%', marginTop: 4 }} />
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn onClick={() => onConfirm(doc)} disabled={!canArchive}>
            {busy ? 'Archiving…' : 'Confirm archive'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
