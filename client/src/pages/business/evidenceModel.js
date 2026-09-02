// Evidence correctness model — pure functions, no React, no network.
//
// Every judgement below is derived from a REAL column the API actually returns:
//   financial_documents : document_type, document_number, document_date,
//                         gross_amount, currency, issuer_counterparty_id, links[]
//   document_files      : file_name, file_size, mime_type, upload_channel
//   debts               : status, paid_amount, due_date, counterparty,
//                         original_amount, linked_transaction_id, attachments
//
// Deliberately NOT used:
//   • sha256 — the API whitelists file fields and never sends the hash, so the
//     client cannot and must not compare hashes. Hash dedup happens server-side
//     (upload-init 409) and is surfaced, not recomputed.
//   • OCR text — no route exposes extracted text. `extracted_json.ai_intake` is an
//     intake CLASSIFICATION (doc_type + confidence + signals); it is reported as a
//     classification, never as something read off the document.

import { isCompanyDoc } from './companyVault'

/* ── document types ────────────────────────────────────────────────────────────
   This is the real CHECK-constrained enum from migration 031. Types like
   "receipt", "contract", "supplier_invoice" and "sales_invoice" do NOT exist in
   the schema, so they are not offered here — a receipt is filed as payment_proof,
   a contract as `other`. */
export const DOC_TYPES = [
  'vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong',
  'tax_billing', 'payment_proof', 'filing_confirmation', 'bank_document', 'other',
]

export const TYPE_LABEL = {
  vendor_invoice: 'Supplier invoice',
  customer_invoice: 'Sales invoice',
  tax_invoice: 'Tax invoice',
  bukti_potong: 'Withholding certificate',
  tax_billing: 'Tax billing',
  payment_proof: 'Payment proof',
  filing_confirmation: 'Filing confirmation',
  bank_document: 'Bank document',
  other: 'Other document',
}
export const typeLabel = (t) => TYPE_LABEL[t] || (t ? String(t) : 'Unclassified')

/* What a document PROVES. The distinction the product rests on:
   an invoice proves the obligation exists; a payment proof proves it was paid. */
export const ROLE = { OBLIGATION: 'obligation', PAYMENT: 'payment', TAX: 'tax', UNKNOWN: 'unknown' }

const ROLE_BY_TYPE = {
  vendor_invoice: ROLE.OBLIGATION,
  customer_invoice: ROLE.OBLIGATION,
  payment_proof: ROLE.PAYMENT,
  bank_document: ROLE.PAYMENT,
  tax_invoice: ROLE.TAX,
  bukti_potong: ROLE.TAX,
  tax_billing: ROLE.TAX,
  filing_confirmation: ROLE.TAX,
  other: ROLE.UNKNOWN,
}
export const roleOf = (doc) => ROLE_BY_TYPE[doc?.document_type] || ROLE.UNKNOWN

/* ── compatibility ────────────────────────────────────────────────────────────
   Which document type is credible evidence for a payable vs a receivable.
   'unsuitable' is reserved for a real contradiction (a sales invoice filed against
   money you owe). Everything unclassified is 'caution', never a hard block. */
const COMPAT = {
  payable: {
    vendor_invoice: 'suitable', tax_invoice: 'suitable', bukti_potong: 'suitable',
    payment_proof: 'suitable', bank_document: 'suitable',
    tax_billing: 'caution', filing_confirmation: 'caution', other: 'caution',
    customer_invoice: 'unsuitable',
  },
  receivable: {
    customer_invoice: 'suitable', tax_invoice: 'suitable', bukti_potong: 'suitable',
    payment_proof: 'suitable', bank_document: 'suitable',
    tax_billing: 'caution', filing_confirmation: 'caution', other: 'caution',
    vendor_invoice: 'unsuitable',
  },
}

const SUITABLE_FOR = {
  payable: 'supplier invoice, tax invoice, payment proof or bank document',
  receivable: 'sales invoice, tax invoice, payment proof or bank document',
}

/** The intake classifier's own verdict, if the API returned one. Never OCR. */
export function intakeOf(doc) {
  const ai = doc?.extracted_json?.ai_intake
  if (!ai) return null
  const conf = Number(ai.confidence)
  return {
    docType: ai.doc_type || null,
    confidence: Number.isFinite(conf) ? conf : null,
    status: ai.classification_status || null,
    textAvailable: !!ai.extraction?.text_available,
    method: ai.extraction?.method || null,
  }
}

/**
 * Is this document credible evidence for this record?
 * Returns { level, role, reason, disagreement } — reason is user-facing text.
 */
export function compatibilityOf(doc, kind) {
  const k = kind === 'receivable' ? 'receivable' : 'payable'
  const t = doc?.document_type || null
  const level = (COMPAT[k] || {})[t] || 'caution'
  const role = roleOf(doc)
  const noun = k === 'payable' ? 'payable' : 'receivable'

  let reason = null
  if (level === 'unsuitable') {
    reason = k === 'payable'
      ? 'This is a sales invoice — it documents money owed TO you, not money you owe.'
      : 'This is a supplier invoice — it documents money YOU owe, not money owed to you.'
  } else if (level === 'caution') {
    reason = t === 'other' || !t
      ? `Document type is ${t ? 'other' : 'not set'}, not ${SUITABLE_FOR[k]}.`
      : `${typeLabel(t)} is a tax filing document — it may not support this ${noun} on its own.`
  }

  // The intake classifier disagreeing with the stored type is a real signal worth showing.
  const intake = intakeOf(doc)
  let disagreement = null
  if (intake?.docType && t && intake.docType !== t) {
    disagreement = `Intake classified this as ${typeLabel(intake.docType)}` +
      (intake.confidence != null ? ` (${Math.round(intake.confidence * 100)}% confidence)` : '') + '.'
  }
  return { level, role, reason, disagreement, intake }
}

export const COMPAT_LABEL = {
  suitable: 'Suitable evidence',
  caution: 'May not support this record',
  unsuitable: 'Wrong document for this record',
}

/* ── links ────────────────────────────────────────────────────────────────────
   attachLinks() returns links as { link_id, target_type, target_id }. The id is
   what DELETE /api/documents/:id/links/:linkId needs — without it, no unlink. */
export function linkIdFor(doc, debtId) {
  if (!doc || debtId == null) return null
  const hit = (doc.links || []).find(
    (l) => l.target_type === 'debt' && String(l.target_id) === String(debtId))
  return hit?.link_id ?? null
}

/** Other records this document is also attached to — unlinking here leaves those intact. */
export function otherLinksOf(doc, debtId) {
  return (doc?.links || []).filter(
    (l) => !(l.target_type === 'debt' && String(l.target_id) === String(debtId)))
}

/* ── duplicates ───────────────────────────────────────────────────────────────
   Metadata signals only, and only when the fields are actually present. No field,
   no signal — a missing value never produces a warning. */
const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase())

export function duplicateWarning(candidate, against, debtId) {
  if (!candidate) return null
  const reasons = []
  const matches = []
  const seen = new Set()

  const push = (doc, reason) => {
    matches.push({ doc, reason })
    if (!seen.has(reason)) { seen.add(reason); reasons.push(reason) }
  }

  for (const other of (against || [])) {
    if (!other || other.id === candidate.id) {
      // The same document already attached to THIS record is the strongest signal.
      if (other && other.id === candidate.id && linkIdFor(other, debtId)) {
        push(other, 'This exact document is already attached to this record.')
      }
      continue
    }
    const cn = norm(candidate.document_number)
    if (cn && cn === norm(other.document_number)) {
      push(other, `Same document number (${candidate.document_number}).`)
    }
    const cf = norm(candidate.file?.file_name)
    if (cf && cf === norm(other.file?.file_name)) {
      push(other, `Same file name (${candidate.file.file_name}).`)
    }
    const amt = candidate.gross_amount
    if (amt != null && other.gross_amount != null && Number(amt) === Number(other.gross_amount) &&
        candidate.document_date && candidate.document_date === other.document_date &&
        candidate.issuer_counterparty_id &&
        candidate.issuer_counterparty_id === other.issuer_counterparty_id) {
      push(other, 'Same amount, date and counterparty as another attached document.')
    }
  }
  if (!reasons.length) return null
  const exact = reasons.some((r) => r.startsWith('This exact document'))
  return { level: exact ? 'blocked' : 'likely', reasons, matches }
}

/* ── evidence grouping ────────────────────────────────────────────────────────
   `attachments` (migration 019, JSONB on debts) is legacy inline receipt evidence.
   It counts as evidence-present but carries no type, so it can never satisfy a
   role-specific requirement on its own. */
export function evidenceOf(debt, docs) {
  const list = Array.isArray(docs) ? docs : []
  const inline = Array.isArray(debt?.attachments) ? debt.attachments.length : 0
  const legacyUrl = debt?.attachment_url ? 1 : 0
  const byRole = { obligation: [], payment: [], tax: [], unknown: [] }
  for (const d of list) byRole[roleOf(d)].push(d)
  return {
    docs: list,
    byRole,
    count: list.length + inline + legacyUrl,
    legacyCount: inline + legacyUrl,
    hasObligation: byRole.obligation.length > 0,
    hasPayment: byRole.payment.length > 0,
    complete: list.length + inline + legacyUrl > 0,
  }
}

/** True once money has actually moved against this record. */
export const isPaid = (debt) =>
  debt?.status === 'paid' || Number(debt?.paid_amount || 0) > 0

/* ── readiness checklist ──────────────────────────────────────────────────────
   Requirements shift with status: an unpaid record needs the obligation proved;
   a paid one additionally needs the payment proved. Each item names the action
   that fixes it, so nothing is a dead end. `taxRule` is passed in only when the
   rules engine actually returned one — absent, the tax item is omitted, never guessed. */
export function checklistFor({ debt, kind, docs, taxRule = null, rulesError = false }) {
  const ev = evidenceOf(debt, docs)
  const paid = isPaid(debt)
  const payable = kind !== 'receivable'
  const items = []

  const fieldsOk = !!(debt?.counterparty && debt?.due_date &&
    Number(debt?.original_amount ?? debt?.amount) > 0)
  items.push({
    key: 'fields', ok: fieldsOk,
    label: 'Amount, due date and counterparty complete',
    missing: 'Amount, due date or counterparty is missing.',
    action: fieldsOk ? null : { kind: 'edit', label: 'Edit details' },
  })

  items.push({
    key: 'obligation', ok: ev.hasObligation,
    label: payable ? 'Supplier invoice attached' : 'Sales invoice attached',
    missing: payable
      ? 'No supplier invoice, tax invoice or contract proves this obligation.'
      : 'No sales invoice or agreement proves the customer owes this.',
    action: { kind: 'evidence', label: ev.hasObligation ? 'Manage evidence' : 'Add invoice' },
    note: !ev.hasObligation && ev.legacyCount
      ? `${ev.legacyCount} legacy attachment${ev.legacyCount > 1 ? 's' : ''} present, but with no document type it cannot prove the obligation.`
      : null,
  })

  // Payment evidence is only REQUIRED once the record is paid.
  const matched = !!debt?.linked_transaction_id
  const paymentOk = ev.hasPayment || matched
  if (paid) {
    items.push({
      key: 'payment', ok: paymentOk,
      label: matched && !ev.hasPayment
        ? 'Payment matched to a transaction'
        : 'Payment proof attached',
      missing: 'Paid, but no payment proof or matched transaction shows the money moved.',
      action: { kind: 'payment', label: 'Add payment proof' },
    })
  } else {
    items.push({
      key: 'payment', ok: true, notRequired: true,
      label: 'Payment proof not required yet',
      missing: null,
      note: payable ? 'Required once this payable is paid.' : 'Required once payment is received.',
      action: null,
    })
  }

  if (taxRule) {
    items.push({
      key: 'tax', ok: false,
      label: 'Tax treatment reviewed',
      missing: 'A withholding rule applies to this record and has not been reviewed.',
      action: { kind: 'tax', label: 'Review tax' },
    })
  } else if (rulesError) {
    items.push({
      key: 'tax', ok: false, unknown: true,
      label: 'Tax treatment unknown',
      missing: 'Tax rule engine unavailable — accountant review required.',
      action: null,
    })
  }

  return items
}

/* ── the ready gate ───────────────────────────────────────────────────────────
   NOTE: nothing here is persisted. `debts` has no readiness column and no API
   route writes financial_documents.review_status, so this is a DERIVED view.
   `persistable: false` is what the UI must show the user. */
export const READY_PERSISTABLE = false

export function readyGate({ debt, kind, docs, taxRule = null, rulesError = false }) {
  const items = checklistFor({ debt, kind, docs, taxRule, rulesError })
  const payable = kind !== 'receivable'
  const blockers = []

  for (const it of items) {
    if (it.ok || it.notRequired) continue
    if (it.key === 'fields') blockers.push('Amount, due date and counterparty required')
    else if (it.key === 'obligation') blockers.push(payable ? 'Supplier invoice required' : 'Sales invoice required')
    else if (it.key === 'payment') blockers.push('Payment proof required')
    else if (it.key === 'tax') blockers.push(it.unknown ? 'Tax review unavailable' : 'Tax review required')
  }

  // An unresolved wrong-document warning blocks readiness: evidence that contradicts
  // the record is worse than missing evidence. A permanent company/compliance file
  // (NIB, NPWP, BPJS…) is the same class of mistake — it evidences the company, not
  // this obligation — so it blocks too, and the drawer already says why on the row.
  const wrong = (docs || []).filter((d) =>
    compatibilityOf(d, kind).level === 'unsuitable' || isCompanyDoc(d))
  if (wrong.length) blockers.push('Remove or explain the wrong document attached')

  return {
    items,
    blockers,
    ready: blockers.length === 0,
    wrongDocs: wrong,
    persistable: READY_PERSISTABLE,
    // The single reason shown on the disabled button.
    reason: blockers[0] || null,
  }
}

/* ── capability flags ─────────────────────────────────────────────────────────
   One place naming what the backend genuinely cannot do yet, so the UI states it
   consistently instead of each component inventing its own wording. */
export const CAPABILITIES = {
  unlink: true,                 // DELETE /api/documents/:id/links/:linkId (rpc_document_unlink, 036)
  uploadDuplicateCheck: true,   // POST /documents/upload-init → 409 duplicate + existing_document_id
  linkExisting: true,           // POST /api/documents/:id/links
  explainException: false,      // no route persists a record-level exception note
  persistReady: false,          // no route writes an accounting-ready status
  accountantReview: false,      // no send-to-accountant route
  matchExistingTransaction: false, // only POST /debts/:id/pay creates the tx link
}

export const CAPABILITY_NOTE = {
  explainException: 'Explanation persistence requires backend support.',
  persistReady: 'Accounting-ready is derived for now. Persistent approval requires backend support.',
  accountantReview: 'Sending to accountant review requires backend support.',
  matchExistingTransaction: 'Attaching an existing transaction requires backend support. Recording the payment here creates and links one.',
}
