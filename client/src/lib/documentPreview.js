// How an uploaded document can be shown to the user before they confirm its type.
//
// The user is asked "is this an NPWP?" about a row called `6.PDF` — they need to SEE the file.
// Phase 1 keeps this deliberately dumb: a short-lived signed URL opened in a new tab. No
// content parsing, no OCR, no embedding of formats the browser cannot render.
//
// Browsers render PDFs and common images inline; a spreadsheet or an unknown type is offered as
// a download instead, because opening it in a tab shows either a download prompt or garbage.

const INLINE_MIME = [
  /^application\/pdf$/i,
  /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i,
  /^text\/plain$/i,
];
const INLINE_EXT = /\.(pdf|png|jpe?g|gif|webp|bmp|txt)$/i;

/**
 * Can the browser show this file in a tab, or should we hand it over as a download?
 * @returns {'view'|'download'}
 */
export function previewModeFor({ mime_type, file_name } = {}) {
  const mime = String(mime_type || '').trim();
  if (mime && INLINE_MIME.some(re => re.test(mime))) return 'view';
  // A generic/absent MIME is common for uploads; fall back to the extension before giving up.
  if ((!mime || /octet-stream/i.test(mime)) && INLINE_EXT.test(String(file_name || ''))) return 'view';
  return 'download';
}

export const canPreviewInline = (file) => previewModeFor(file) === 'view';

/** Label for the row's primary action, so it never promises a preview it cannot deliver. */
export const previewActionLabel = (file) => (canPreviewInline(file) ? 'View' : 'Open / download');

/** Human-readable size. Returns null when the size is unknown — never a fake "0 B". */
export function formatFileSize(bytes) {
  // Number(null) is 0, so an unknown size would otherwise render as a confident "0 B".
  if (bytes === null || bytes === undefined || bytes === '') return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short upload date. Returns null rather than "Invalid Date". */
export function formatUploadedAt(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A compact "PDF" / "XLSX" style tag from the MIME type or the file name. */
export function fileKindLabel({ mime_type, file_name } = {}) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(String(file_name || ''))?.[1];
  if (ext) return ext.toUpperCase();
  const mime = String(mime_type || '');
  if (!mime) return null;
  return (mime.split('/')[1] || mime).split('.').pop().slice(0, 8).toUpperCase();
}
