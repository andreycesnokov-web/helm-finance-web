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
//   POST   /api/documents/:id/tax-obligation       put a tax printed on the document into the tax calendar (estimated amount + link)
//
// Before the owner applies migrations 058–061 the server answers 409 migration_not_applied
// for the batch-8 writes; the screens say so instead of failing silently.
//
// Paying a bill and creating a bill/invoice reuse the existing DebtPaymentModal and
// DebtFormModal components unchanged, so their writes are the legacy ones.
import { apiFetch } from '../../lib/api'
import { uploadDocument } from '../../lib/documents'

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

export const documentFileUrl = (token, id, mode = 'view', signal) =>
  apiFetch(`${docUrl(id)}/signed-url`, token, { method: 'POST', body: mode === 'download' ? { mode: 'download' } : {}, signal })

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

export const recordDocumentTax = (token, id, body) =>
  apiFetch(`${docUrl(id)}/tax-obligation`, token, { method: 'POST', body })

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

// Company tax profile (2026-10-10, the v2 profile editor) — existing routes, role-checked on the
// server (owner / CEO / admin / CFO), critical fields audited, a critical change re-opens review:
//   PUT  /api/accountant/profile                  save the profile (answers not_saved before 040)
//   POST /api/accountant/profile/verify           mark the profile checked
//   POST /api/accountant/profile/from-documents   AI reads NPWP / NIB / KBLI / deed — suggests only
export const saveTaxProfile = (token, body) =>
  apiFetch('/accountant/profile', token, { method: 'PUT', body })

export const verifyTaxProfile = (token) =>
  apiFetch('/accountant/profile/verify', token, { method: 'POST', body: {} })

export const readProfileFromDocuments = (token, { force = false } = {}) =>
  apiFetch('/accountant/profile/from-documents', token, { method: 'POST', body: { force } })

// Sign-in and company setup (2026-10-10, designs reg/R1–R9). Existing routes; the server checks
// everything (email rate limits, one-time links, invite validity, owner membership on create).
//   POST  /api/auth/email/start          send the sign-in link (public)
//   POST  /api/auth/email/verify         one-time link token or 6-digit code → session (public)
//   PATCH /api/me/profile                name, timezone, language of the signed-in person
//   POST  /api/invite/:code/accept       join a company by invitation
//   POST  /api/businesses                create a company — the creator becomes its owner
// Reads used before a company exists (no v2 data provider yet):
//   GET /api/invite/:code (public) · GET /api/me/profile · GET /api/workspaces
export const startEmailSignIn = (email) =>
  apiFetch('/auth/email/start', null, { method: 'POST', body: { email } })

export const verifyEmailSignIn = (body) =>
  apiFetch('/auth/email/verify', null, { method: 'POST', body })

export const updateMyProfile = (token, patch) =>
  apiFetch('/me/profile', token, { method: 'PATCH', body: patch })

export const acceptInvite = (token, code) =>
  apiFetch(`/invite/${encodeURIComponent(code)}/accept`, token, { method: 'POST', body: {} })

export const createCompany = (token, body) =>
  apiFetch('/businesses', token, { method: 'POST', body })

export const lookupInvite = (code) => apiFetch(`/invite/${encodeURIComponent(code)}`, null)
export const readMyProfile = (token) => apiFetch('/me/profile', token)
export const readWorkspaces = (token) => apiFetch('/workspaces', token)

// Company setup, step 2: upload one company document (NIB, NPWP, deed…). The existing signed
// upload — POST /api/documents/upload-init, PUT to storage, POST /api/documents/upload-complete —
// in client/src/lib/documents.js; the server classifies the text and runs the intake pipeline.
export const uploadCompanyDocument = (token, file) =>
  uploadDocument(token, file, { title: file.name, upload_source: 'accountant_upload' })

// Settings (2026-10-10, designs Settings + w2/S2): existing routes, each role-checked on the server.
//   PATCH  /api/business/current                 company name, country, time zone, base currency
//   POST   /api/cashflow-categories              add a company category (inflow / outflow)
//   PATCH  /api/cashflow-categories/:id          rename, or restore from the archive
//   DELETE /api/cashflow-categories/:id          archive (soft: past transactions keep it)
//   POST   /api/account/integrations/telegram/link-token   one-time deep link to the bot
//   POST   /api/account/integrations/telegram/unlink       stop the bot for this person
//   POST   /api/payment-connections              add a payment gateway connection (no secrets here)
//   POST   /api/team/invite                      invitation code (+ email when email sign-in is on)
//   DELETE /api/team/invites/:code               revoke an invitation
//   PATCH  /api/team/members/:memberId           change a role
//   DELETE /api/team/members/:memberId           remove from the company (their records stay)
export const updateCompanyBasics = (token, body) =>
  apiFetch('/business/current', token, { method: 'PATCH', body })

export const createCategory = (token, body) =>
  apiFetch('/cashflow-categories', token, { method: 'POST', body })

export const updateCategory = (token, id, body) =>
  apiFetch(`/cashflow-categories/${encodeURIComponent(id)}`, token, { method: 'PATCH', body })

export const archiveCategory = (token, id) =>
  apiFetch(`/cashflow-categories/${encodeURIComponent(id)}`, token, { method: 'DELETE' })

export const telegramLinkToken = (token) =>
  apiFetch('/account/integrations/telegram/link-token', token, { method: 'POST', body: {} })

export const telegramUnlink = (token) =>
  apiFetch('/account/integrations/telegram/unlink', token, { method: 'POST', body: {} })

export const createGateway = (token, body) =>
  apiFetch('/payment-connections', token, { method: 'POST', body })

export const inviteMember = (token, body) =>
  apiFetch('/team/invite', token, { method: 'POST', body })

export const revokeInvite = (token, code) =>
  apiFetch(`/team/invites/${encodeURIComponent(code)}`, token, { method: 'DELETE' })

export const updateMember = (token, memberId, body) =>
  apiFetch(`/team/members/${encodeURIComponent(memberId)}`, token, { method: 'PATCH', body })

export const removeMember = (token, memberId) =>
  apiFetch(`/team/members/${encodeURIComponent(memberId)}`, token, { method: 'DELETE' })

// Accounts (2026-10-10, designs w2/C1 + C2): existing routes, role-checked (canManageWallets) on the server.
//   POST   /api/wallets                     create (an opening balance is recorded, not income)
//   PUT    /api/wallets/:id                 rename, owner name, colour; restore with is_active=true;
//                                           the currency is locked once the account has transactions
//   DELETE /api/wallets/:id                 archive (soft: transactions and statements stay)
//   POST   /api/wallets/:id/adjust-balance  balance correction to the bank's figure (owner/admin/CFO)
export const createWallet = (token, body) =>
  apiFetch('/wallets', token, { method: 'POST', body })

export const updateWallet = (token, id, body) =>
  apiFetch(`/wallets/${encodeURIComponent(id)}`, token, { method: 'PUT', body })

export const archiveWallet = (token, id) =>
  apiFetch(`/wallets/${encodeURIComponent(id)}`, token, { method: 'DELETE' })

export const adjustWalletBalance = (token, id, body) =>
  apiFetch(`/wallets/${encodeURIComponent(id)}/adjust-balance`, token, { method: 'POST', body })

// Bank statement import (2026-10-10, designs w2/H1–H3 + k/K4). Existing routes plus one read:
//   upload  POST /api/documents/upload-init → storage → upload-complete   the file is kept as evidence
//   POST /api/bank-import/read                 the engine reads the uploaded file into rows (no write)
//   POST /api/bank-import/batches              store the rows for review (dedup + matches)
//   POST /api/bank-imports/:batchId/suggest    rules, counterparty history, bills/payroll matches, AI
//   POST /api/bank-imports/:batchId/confirm    the user's final decisions → transactions (+ reconciliation)
//   POST /api/classification-rules             "always file rows with … under …" for next statements
export const uploadStatementFile = (token, file) =>
  uploadDocument(token, file, { title: file.name, document_type: 'bank_document' })

export const readStatement = (token, documentId, sheetText) =>
  apiFetch('/bank-import/read', token, { method: 'POST', body: { document_id: documentId, ...(sheetText ? { sheet_text: sheetText } : {}) } })

export const createImportBatch = (token, body) =>
  apiFetch('/bank-import/batches', token, { method: 'POST', body })

export const suggestImport = (token, batchId) =>
  apiFetch(`/bank-imports/${encodeURIComponent(batchId)}/suggest`, token, { method: 'POST', body: {} })

export const confirmImport = (token, batchId, rows) =>
  apiFetch(`/bank-imports/${encodeURIComponent(batchId)}/confirm`, token, { method: 'POST', body: { rows } })

export const createClassificationRule = (token, body) =>
  apiFetch('/classification-rules', token, { method: 'POST', body })

// Bills and invoices (2026-10-10, design w2/E1): the invoice is uploaded and read first.
//   upload  POST /api/documents/upload-init → storage → upload-complete
//   POST /api/documents/:id/extract   read the invoice text (writes nothing)
//   POST /api/debts                   create the bill / invoice (approval set by role on the server)
export const uploadInvoiceFile = (token, file, kind) =>
  uploadDocument(token, file, { title: file.name, document_type: kind === 'receivable' ? 'customer_invoice' : 'vendor_invoice' })

export const readInvoice = (token, id) =>
  apiFetch(`/documents/${encodeURIComponent(id)}/extract`, token, { method: 'POST', body: {} })

export const createBill = (token, body) =>
  apiFetch('/debts', token, { method: 'POST', body })

//   PATCH /api/debts/:id              edit a bill / invoice (counterparty, amount, currency, due date, description)
export const updateBill = (token, id, body) =>
  apiFetch('/debts/' + encodeURIComponent(id), token, { method: 'PATCH', body })

// Counterparty card (2026-10-10, design w2/G1): existing routes, role-checked and audited.
//   POST   /api/counterparties/:id/archive                     archive (bills and payments stay)
//   DELETE /api/counterparties/:id/bank-accounts/:accountId    remove one bank account
export const archiveCounterparty = (token, id) =>
  apiFetch('/counterparties/' + encodeURIComponent(id) + '/archive', token, { method: 'POST', body: {} })

export const removeCounterpartyBank = (token, id, accountId) =>
  apiFetch('/counterparties/' + encodeURIComponent(id) + '/bank-accounts/' + encodeURIComponent(accountId), token, { method: 'DELETE' })

// Payroll (2026-10-10, designs w2/F1 + F2): existing routes, canManagePayroll on the server.
//   POST   /api/payroll/employees        add a person
//   PATCH  /api/payroll/employees/:id    edit
//   DELETE /api/payroll/employees/:id    archive (past payments stay)
//   POST   /api/payroll/payments         pay one person for a month, with item lines (PPh 21, BPJS…)
export const createEmployee = (token, body) =>
  apiFetch('/payroll/employees', token, { method: 'POST', body })

export const updateEmployee = (token, id, body) =>
  apiFetch('/payroll/employees/' + encodeURIComponent(id), token, { method: 'PATCH', body })

export const archiveEmployee = (token, id) =>
  apiFetch('/payroll/employees/' + encodeURIComponent(id), token, { method: 'DELETE' })

export const recordPayrollPayment = (token, body) =>
  apiFetch('/payroll/payments', token, { method: 'POST', body })

// Money windows (2026-10-10, v2 replacements of the v1 transfer and payment modals).
//   POST /api/wallets/transfer                 move money between two of the company's accounts
//   POST /api/decisions/debts/:id/payment      AI CFO check of a payment (simulation, writes nothing)
//   POST /api/debts/:id/pay                    record a payment (idempotency key: one booking per click)
export const transferBetweenWallets = (token, body) =>
  apiFetch('/wallets/transfer', token, { method: 'POST', body })

export const checkBillPayment = (token, id, body) =>
  apiFetch('/decisions/debts/' + encodeURIComponent(id) + '/payment', token, { method: 'POST', body })

export const payBill = (token, id, idempotencyKey, body) =>
  apiFetch('/debts/' + encodeURIComponent(id) + '/pay', token, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body })
