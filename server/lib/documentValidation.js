// Pure, dependency-free validation helpers for the Tax Documents runtime.
// No I/O — unit-tested in tests/documentValidation.test.js. The backend is the
// single source of truth; the frontend only mirrors these for UX.

// Real document_type enum from migration 031 (financial_documents CHECK).
const DOCUMENT_TYPES = [
  'vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong',
  'tax_billing', 'payment_proof', 'filing_confirmation', 'bank_document', 'other',
];

// V1 allowed files.
const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png',
  'text/csv',
  'application/vnd.ms-excel',                                              // some .csv/.xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',     // .xlsx
];
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'csv', 'xlsx', 'xls'];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

// Link target types → their link table + ledger table (for the 3-way check).
const LINK_TARGETS = {
  debt:        { table: 'document_debt_links',       column: 'debt_id',             ledger: 'debts' },
  transaction: { table: 'document_transaction_links', column: 'transaction_id',      ledger: 'transactions' },
  compliance:  { table: 'document_compliance_links',  column: 'compliance_event_id', ledger: 'compliance_events' },
};

const extOf = (name) => {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
};

// Normalize a user filename: strip any path, collapse unsafe chars, keep ext.
// Blocks path traversal (../, \, absolute paths). Always returns a safe token.
function safeFilename(name) {
  let base = String(name || '').replace(/\\/g, '/');
  base = base.split('/').pop() || '';          // drop any directory component
  base = base.replace(/^\.+/, '');             // no leading dots (hidden / traversal)
  base = base.replace(/[^A-Za-z0-9._-]+/g, '_'); // collapse to a safe charset
  base = base.replace(/_{2,}/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  if (!base) base = 'file';
  if (base.length > 120) {
    const e = extOf(base);
    base = base.slice(0, 110) + (e ? '.' + e : '');
  }
  return base;
}

// Validate an upload request. Returns { ok, error } — never throws.
function validateUpload({ file_name, mime_type, file_size, document_type }) {
  const ext = extOf(file_name);
  if (!file_name || !ext) return { ok: false, error: 'invalid_filename' };
  if (!ALLOWED_EXT.includes(ext)) return { ok: false, error: 'extension_not_allowed' };
  if (!mime_type || !ALLOWED_MIME.includes(mime_type)) return { ok: false, error: 'mime_not_allowed' };
  if (typeof file_size !== 'number' || !isFinite(file_size) || file_size <= 0)
    return { ok: false, error: 'invalid_size' };
  if (file_size > MAX_FILE_BYTES) return { ok: false, error: 'file_too_large' };
  if (document_type != null && !DOCUMENT_TYPES.includes(document_type))
    return { ok: false, error: 'invalid_document_type' };
  return { ok: true };
}

// Storage key always carries business scope + the document id (never bare name).
function buildStoragePath(businessId, documentId, fileName) {
  return `businesses/${businessId}/documents/${documentId}/${safeFilename(fileName)}`;
}

// The 3-way business isolation rule for linking: the document, the ledger
// target, and the acting business must all be the same business.
function sameBusinessLink(activeBusinessId, documentBusinessId, targetBusinessId) {
  return !!activeBusinessId &&
    activeBusinessId === documentBusinessId &&
    activeBusinessId === targetBusinessId;
}

// SHA-256 is computed by the client (signed-upload model) and used only as a
// per-business dedup convenience — validate its shape before trusting it.
function isValidSha256(h) {
  return typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h);
}

module.exports = {
  DOCUMENT_TYPES, ALLOWED_MIME, ALLOWED_EXT, MAX_FILE_BYTES, LINK_TARGETS,
  extOf, safeFilename, validateUpload, buildStoragePath, sameBusinessLink, isValidSha256,
};
