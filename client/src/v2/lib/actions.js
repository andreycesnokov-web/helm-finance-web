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
//   POST  /api/debts/:id/withholding   NEW in batch 10 — record tax withheld on a bill/invoice (no money moves)
//   PATCH /api/pnl-mapping             NEW in batch 9 — confirm category → profit group (P-10)
//   PATCH /api/debts/:id/checklist     NEW in batch 8 — accountant check only (P-05 option B: the
//                                      withholding slip lives in withholding_records and is read-only here)
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

export const setTransactionCategory = (token, id, category) =>
  apiFetch(`/transactions/${encodeURIComponent(id)}`, token, { method: 'PATCH', body: { category } })

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

/** Server error → short user-facing text. 403 means the role may not do this. */
export function actionError(e) {
  if (e?.status === 403) return 'forbidden'
  if (e?.status === 409 && e?.data?.error === 'migration_not_applied') return 'notApplied'
  return e?.data?.message || e?.message || 'failed'
}
