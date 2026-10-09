// The ONLY place v2 writes anything. Every call has a server-side role check and the
// list is mirrored in tests/design/v2Guards.test.mjs (WRITE_ALLOW) and in each batch report.
// Batches 1–7 only reused existing endpoints. Batch 8 adds the write paths for the
// proposals the owner approved in _specs/design-v2/DECISIONS.md (role check + audit row):
//
//   PATCH /api/debts/:id/approve       same call the legacy Payables/Receivables pages make
//   PATCH /api/debts/:id/reject        same, with a reason
//   POST  /api/debts/:id/request-info  existing "ask for details" (used by the Telegram bot)
//   PATCH /api/transactions/:id        category only — same call the legacy Transactions page makes
//   POST  /api/counterparties          existing create; the server refuses likely duplicates (409)
//   PATCH /api/counterparties/:id      existing edit — batch 8 uses it for entity form, role, terms (P-04)
//   PATCH /api/business/targets        NEW in batch 8 — runway target, minimum cash, weekly brief (P-01, P-08)
//   POST  /api/business-funding        NEW in batch 12 — record equity or a loan (P-03)
//   POST  /api/business-funding/repayments/:rid/paid  NEW in batch 12 — mark a repayment paid
//   POST  /api/assets                  NEW in batch 11 — add to the asset register (P-11)
//   POST  /api/debts/:id/withholding   NEW in batch 10 — record tax withheld on a bill/invoice (no money moves)
//   PATCH /api/pnl-mapping             NEW in batch 9 — confirm category → profit group (P-10)
//   POST  /api/transactions/batch      existing — "+ Add" expense/income, always scope 'business' (lib/addEntry.js)
//   PATCH /api/debts/:id/checklist     NEW in batch 8 — accountant check only (P-05 option B: the
//                                      withholding slip lives in withholding_records and is read-only here)
//   Documents (2026-10-09, the Documents page review panel) — existing Document Center routes,
//   role-checked (canManageDocuments / document access) and audited by the server RPCs:
//   POST   /api/documents/:id/signed-url           view / download link (audited read)
//   PATCH  /api/documents/:id                      type, number, date, amount
//   POST   /api/documents/:id/links                link to a bill / invoice / transaction
//   DELETE /api/documents/:id/links/:linkId        unlink (the record itself is untouched)
//   POST   /api/documents/:id/archive              archive (never a hard delete)
//   PATCH  /api/ai-accountant/documents/:id/classification  confirm "company document" (NIB, NPWP…)
//   POST   /api/documents/:id/identify             "what is this document?" — AI explanation, stored per language
//   POST   /api/documents/:id/filing               keep with a bank account + month, a counterparty, or on file with a reason
//
// Before the owner applies migrations 058–061 the server answers 409 migration_not_applied
// for the batch-8 writes; the screens say so instead of failing silently.
//
// Paying a bill and creating a bill/invoice reuse the existing DebtPaymentModal and
// DebtFormModal components unchanged, so their writes are the legacy ones.
import { apiFetch } from '../../lib/api'

export const approveDebt = (token, id) =>
  apiFetch(`/debts/${encodeURIComponent(id)}/approve`, token, { method: 'PATCH', body: { channel: 'web' } })

export const rejectDebt = (token, id, reason) =>
  apiFetch(`/debts/${encodeURIComponent(id)}/reject`, token, { method: 'PATCH', body: { reason, channel: 'web' } })

export const requestDebtInfo = (token, id, note) =>
  apiFetch(`/debts/${encodeURIComponent(id)}/request-info`, token, { method: 'POST', body: { note, channel: 'web' } })

export const updateTransaction = (token, id, body) =>
  apiFetch(`/transactions/${encodeURIComponent(id)}`, token, { method: 'PATCH', body })

export const setTransactionCategory = (token, id, category) =>
  updateTransaction(token, id, { category })

export const createCounterparty = (token, body) =>
  apiFetch('/counterparties', token, { method: 'POST', body })

export const updateCounterparty = (token, id, body) =>
  apiFetch(`/counterparties/${encodeURIComponent(id)}`, token, { method: 'PATCH', body })

export const updateBusinessTargets = (token, body) =>
  apiFetch('/business/targets', token, { method: 'PATCH', body })

export const updateBillChecklist = (token, id, body) =>
  apiFetch(`/debts/${encodeURIComponent(id)}/checklist`, token, { method: 'PATCH', body })

export const updatePnlMapping = (token, body) =>
  apiFetch('/pnl-mapping', token, { method: 'PATCH', body })

export const recordWithholding = (token, id, body) =>
  apiFetch(`/debts/${encodeURIComponent(id)}/withholding`, token, { method: 'POST', body })

export const createAsset = (token, body) =>
  apiFetch('/assets', token, { method: 'POST', body })

export const createFunding = (token, body) =>
  apiFetch('/business-funding', token, { method: 'POST', body })

export const markRepaymentPaid = (token, id, body) =>
  apiFetch(`/business-funding/repayments/${encodeURIComponent(id)}/paid`, token, { method: 'POST', body })

const docUrl = (id) => `/documents/${encodeURIComponent(id)}`

export const documentFileUrl = (token, id, mode = 'view') =>
  apiFetch(`${docUrl(id)}/signed-url`, token, { method: 'POST', body: mode === 'download' ? { mode: 'download' } : {} })

export const updateDocument = (token, id, body) =>
  apiFetch(`/documents/${encodeURIComponent(id)}`, token, { method: 'PATCH', body })

export const linkDocument = (token, id, target_type, target_id) =>
  apiFetch(`${docUrl(id)}/links`, token, { method: 'POST', body: { target_type, target_id } })

export const unlinkDocument = (token, id, linkId) =>
  apiFetch(`${docUrl(id)}/links/${encodeURIComponent(linkId)}`, token, { method: 'DELETE' })

export const archiveDocument = (token, id) =>
  apiFetch(`${docUrl(id)}/archive`, token, { method: 'POST', body: {} })

export const identifyDocument = (token, id, body) =>
  apiFetch(`${docUrl(id)}/identify`, token, { method: 'POST', body })

export const fileDocument = (token, id, body) =>
  apiFetch(`${docUrl(id)}/filing`, token, { method: 'POST', body })

export const confirmDocumentKind = (token, id, doc_type) =>
  apiFetch(`/ai-accountant/documents/${encodeURIComponent(id)}/classification`, token, { method: 'PATCH', body: { doc_type } })

/** Server error → short user-facing text. 403 means the role may not do this. */
export const createBusinessTransaction = (token, tx) =>
  apiFetch('/transactions/batch', token, { method: 'POST', body: { transactions: [{ ...tx, scope: 'business' }] } })

export function actionError(e) {
  if (e?.status === 403) return 'forbidden'
  if (e?.status === 409 && e?.data?.error === 'migration_not_applied') return 'notApplied'
  return e?.data?.message || e?.message || 'failed'
}
