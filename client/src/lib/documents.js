import { apiFetch } from './api'

export const DOC_TYPES = [
  'vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong',
  'tax_billing', 'payment_proof', 'filing_confirmation', 'bank_document', 'other',
]

export const MAX_FILE_BYTES = 20 * 1024 * 1024

async function sha256Hex(file) {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Signed-upload flow: init → PUT to storage → complete. Returns the created
// document (or throws with a friendly message). `meta` carries document fields;
// `link` is an optional { target_type, target_id }.
export async function uploadDocument(token, file, meta = {}, link = null) {
  const payload = {
    file_name: file.name, mime_type: file.type || 'application/octet-stream',
    file_size: file.size, document_type: meta.document_type || null,
  }
  // Preliminary hash so the backend can short-circuit a same-business duplicate
  // before we waste an upload. The backend re-verifies the hash server-side.
  const sha256 = await sha256Hex(file)
  const init = await apiFetch('/documents/upload-init', token, { method: 'POST', body: { ...payload, sha256 } })
  const putRes = await fetch(init.upload_url, {
    method: 'PUT',
    headers: { 'content-type': payload.mime_type, 'x-upsert': 'false' },
    body: file,
  })
  if (!putRes.ok) throw new Error('Upload to storage failed')
  return apiFetch('/documents/upload-complete', token, {
    method: 'POST',
    body: {
      document_id: init.document_id, storage_path: init.storage_path,
      ...payload, sha256, ...meta, link: link || undefined,
    },
  })
}

export async function getSignedUrl(token, documentId, mode = 'view') {
  const r = await apiFetch(`/documents/${documentId}/signed-url`, token, { method: 'POST', body: { mode } })
  return r.url
}
