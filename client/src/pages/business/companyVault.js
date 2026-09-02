// Company Vault — separating PERMANENT company/compliance documents from
// operational accounting evidence.
//
// ── What the backend actually gives us ──────────────────────────────────────
// `financial_documents.document_type` is CHECK-constrained by migration 031 to
// nine ACCOUNTING types. There is no 'nib' / 'npwp' / 'akta' value and there is
// no company/legal flag column. Adding one would be a migration, so we do not.
//
// What DOES exist, is already persisted, and is already returned by
// GET /api/documents, is `extracted_json.ai_intake`:
//     { doc_type, confidence, classification_status, matched_on, confirmed_at }
// written by server/lib/documentIntake.js. Its taxonomy has real company types
// (npwp, nib, akta, sk_kemenkumham, oss_license, pkp_certificate,
// kpp_registration, bpjs_document), every one of which maps down to the
// CHECK-valid column value 'other'. That intake type is the honest signal this
// module reads, and PATCH /api/ai-accountant/documents/:id/classification is the
// existing route that persists a user's decision (classification_status becomes
// 'manually_confirmed'). No new route, no new column, no migration.
//
// ── Honesty rules enforced here ─────────────────────────────────────────────
//   * A document is only ever CALLED a company document. Nothing is moved,
//     hidden or deleted — the separation is a view over the same rows.
//   * 'confirmed'  — a human confirmed the intake type. Stated as fact.
//   * 'classified' — the backend classifier stored a company type. Shown as a
//                    suggestion that still wants a human.
//   * 'filename'   — nothing was persisted, so we matched the file name in the
//                    browser. Always presented as a suggestion, never as truth.
//   * An explicit accounting document_type always wins. If someone deliberately
//     filed a document as a supplier invoice it stays in the Evidence Inbox even
//     if the file name says "NPWP" — a stored human decision outranks a regex.

import { DOCUMENT_KNOWLEDGE } from '../../lib/documentKnowledge'

/* ── which intake types are permanent company documents ────────────────────
   Deliberately NOT vault: bank_statement, invoice, receipt, contract,
   tax_report, tax_payment_proof, payroll_document — those are accounting
   evidence and belong in the work queue.
   BPJS is included: the registration certificate is a permanent company
   compliance file, even though the intake taxonomy files it under payroll. */
export const VAULT_TYPES = [
  'nib', 'npwp', 'akta', 'sk_kemenkumham',
  'oss_license', 'pkp_certificate', 'kpp_registration', 'bpjs_document',
]
const VAULT_SET = new Set(VAULT_TYPES)
export const isVaultType = (t) => VAULT_SET.has(t)

/* Vault-facing labels. `documentKnowledge` already holds the official names, so
   we reuse them rather than inventing a second vocabulary; the fallbacks below
   only cover the case where such an entry is ever removed. */
const FALLBACK_LABEL = {
  nib: 'NIB', npwp: 'NPWP / TIN', akta: 'Akta / Deed',
  sk_kemenkumham: 'SK Kemenkumham', oss_license: 'OSS / business licence',
  pkp_certificate: 'PKP certificate', kpp_registration: 'KPP registration',
  bpjs_document: 'BPJS document',
}
export const vaultLabel = (t) =>
  DOCUMENT_KNOWLEDGE[t]?.display_label || FALLBACK_LABEL[t] || 'Company document'

/* Vault shelves — the same grouping vocabulary the AI Accountant checklist uses
   (documentKnowledge.GROUPS), narrowed to the shelves a vault can contain. */
export const VAULT_SHELVES = [
  { key: 'identity', label: 'Company identity' },
  { key: 'tax_registration', label: 'Tax registration' },
  { key: 'payroll', label: 'Payroll & social security' },
  { key: 'operational', label: 'Other company files' },
]
export const shelfOf = (docType) => DOCUMENT_KNOWLEDGE[docType]?.group || 'operational'
export const shelfLabel = (key) =>
  VAULT_SHELVES.find((s) => s.key === key)?.label || 'Other company files'

/* ── file-name fallback ─────────────────────────────────────────────────────
   A MIRROR of the STRONG patterns in server/lib/documentIntake.js, restricted to
   the vault types. It only runs when the backend stored no classification at
   all, and its result is always labelled as a suggestion.
   Keep in sync with documentIntake.js STRONG if that list changes.
   One deliberate addition: `tin` (the English name for an NPWP). The server does
   not match it, so "TIN_PT_HELM.pdf" is stored as `unknown` and would otherwise
   sit in the work queue forever. Confirming it writes the real `npwp` type. */
const NAME_PATTERNS = [
  ['npwp', [/\bnpwp\b/, /\btin\b/]],
  ['nib', [/\bnib\b/, /nomor induk berusaha/]],
  ['sk_kemenkumham', [/kemenkumham/, /\bsk kemenkum/, /ahu ah/,
    /keputusan menteri hukum/, /pengesahan pendirian/, /pengesahan badan hukum/]],
  ['akta', [/\bakta\b/, /\bakte\b/, /notaris/, /deed of establishment/]],
  ['pkp_certificate', [/\bpkp\b/, /pengukuhan pkp/, /sppkp/]],
  ['oss_license', [/\boss\b/, /izin usaha/, /business licen[cs]e/]],
  ['kpp_registration', [/\bkpp\b/, /surat keterangan terdaftar/, /\bsket\b/]],
  ['bpjs_document', [/\bbpjs\b/, /jamsostek/, /kesehatan ketenagakerjaan/]],
]

/* Normalise a file name the way the server does before matching: separators
   become spaces, so "NIB_123.pdf" still matches a word-boundary pattern. */
const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '

/** Match a file name against the vault patterns. Returns an intake type or null. */
export function vaultTypeFromName(fileName) {
  const name = norm(fileName)
  if (!name.trim()) return null
  for (const [type, patterns] of NAME_PATTERNS) {
    if (patterns.some((re) => re.test(name))) return type
  }
  return null
}

/* ── the verdict ───────────────────────────────────────────────────────────── */

/** The persisted intake classification, if the API returned one. */
export const intakeTypeOf = (doc) => doc?.extracted_json?.ai_intake?.doc_type || null
export const intakeStatusOf = (doc) => doc?.extracted_json?.ai_intake?.classification_status || null

/** An accounting type someone deliberately stored on the row. */
const hasAccountingType = (doc) => {
  const t = doc?.document_type
  return !!t && t !== 'other'
}

/**
 * Is this a permanent company / compliance document?
 * @returns null, or { docType, label, shelf, source, confirmed, note }
 *   source: 'confirmed' | 'classified' | 'filename'
 */
export function vaultVerdictOf(doc) {
  if (!doc) return null
  // A stored accounting classification is a decision, not a guess — respect it.
  if (hasAccountingType(doc)) return null

  const intakeType = intakeTypeOf(doc)
  const confirmedIntake = intakeStatusOf(doc) === 'manually_confirmed'
  // 'unknown' is the classifier admitting it could not tell, not a verdict — so it
  // does not block the file-name fallback below. A human who confirmed 'unknown'
  // HAS decided, and that decision stands.
  const classified = intakeType && (intakeType !== 'unknown' || confirmedIntake)

  if (classified) {
    // The backend classified this file. If it is not a company type then it is
    // not a vault document — and we do NOT second-guess it with a file-name regex.
    if (!isVaultType(intakeType)) return null
    const confirmed = confirmedIntake
    return {
      docType: intakeType,
      label: vaultLabel(intakeType),
      shelf: shelfOf(intakeType),
      source: confirmed ? 'confirmed' : 'classified',
      confirmed,
      note: confirmed
        ? 'Confirmed company document.'
        : 'Suggested company document — review classification',
    }
  }

  // Nothing persisted: fall back to the file name, and say so.
  const guess = vaultTypeFromName(doc.file?.file_name)
  if (!guess) return null
  return {
    docType: guess,
    label: vaultLabel(guess),
    shelf: shelfOf(guess),
    source: 'filename',
    confirmed: false,
    note: 'Suggested company document — review classification',
  }
}

export const isCompanyDoc = (doc) => vaultVerdictOf(doc) !== null

/** Split a document list into the two views. Neither side loses a row. */
export function partitionDocuments(docs = []) {
  const evidence = []
  const vault = []
  for (const d of docs) (isCompanyDoc(d) ? vault : evidence).push(d)
  return { evidence, vault }
}

/* ── misfiled-evidence warning ──────────────────────────────────────────────
   A company document attached to a payable or receivable is almost always a
   filing mistake: an NPWP card does not evidence an amount owed. We warn, and
   never unlink anything on our own. */
export const MISFILED_WARNING =
  'This looks like a company document, not evidence for this record.'

/**
 * Warning for a document linked to a payable/receivable, or null.
 * @returns { text, detail, verdict } | null
 */
export function companyDocWarning(doc) {
  const v = vaultVerdictOf(doc)
  if (!v) return null
  const detail = v.confirmed
    ? `Filed as ${v.label} in the Company Vault.`
    : `Looks like ${v.label}${v.source === 'filename' ? ' (matched on the file name)' : ''} — review the classification.`
  return { text: MISFILED_WARNING, detail, verdict: v }
}
