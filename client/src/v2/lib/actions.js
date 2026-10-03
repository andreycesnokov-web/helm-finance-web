// The ONLY place v2 writes anything. Every call reuses an existing endpoint with its
// existing server-side role check — no new write endpoint exists for v2. The list is
// mirrored in tests/design/v2Guards.test.mjs (WRITE_ALLOW) and in each batch report.
//
//   PATCH /api/debts/:id/approve       same call the legacy Payables/Receivables pages make
//   PATCH /api/debts/:id/reject        same, with a reason
//   POST  /api/debts/:id/request-info  existing "ask for details" (used by the Telegram bot)
//   PATCH /api/transactions/:id        category only — same call the legacy Transactions page makes
//   POST  /api/counterparties          existing create; the server refuses likely duplicates (409)
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

/** Server error → short user-facing text. 403 means the role may not do this. */
export function actionError(e) {
  if (e?.status === 403) return 'forbidden'
  return e?.data?.message || e?.message || 'failed'
}
