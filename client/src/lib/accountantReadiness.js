// Readiness summary for the AI Accountant page.
//
// SINGLE SOURCE OF TRUTH: the readiness card is derived from the SAME payload as the
// Compliance Documents checklist (GET /api/ai-accountant/required-documents). Before this,
// the card read a local checkbox placeholder, so it could ask you to "Upload NIB" while the
// checklist already showed NIB as uploaded.
//
// Rules kept deliberately conservative — this is a preliminary summary, never a claim that a
// document is officially valid:
//   * Only items the checklist marks required/conditional_required can be "missing".
//   * A document that exists but is not confirmed (needs_review) is NOT reported as missing;
//     it is reported as needing confirmation.
//   * A truncated checklist yields no confident counts at all.
//   * An uploaded document with an empty profile number asks you to ENTER the number,
//     not to upload the document again.

// Profile fields that carry the number printed on a document, by checklist type.
const NUMBER_FIELD = { npwp: 'npwp', nib: 'nib' };

const REQUIRED_LEVELS = new Set(['required', 'conditional_required']);

// Group/priority come from the knowledge base so the Workbench and the checklist describe a
// document the same way — payroll formalities must never read like foundation documents.
import { groupOf, priorityOf, PRIORITY_LABEL } from './documentKnowledge.js';

// Urgent first, and within that: identity, then tax registration, then payroll.
const PRIORITY_RANK = { core_required: 0, conditional_required: 1, payroll_required: 2 };

const humanList = (items) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

// 'pkp_registered' | 'non_pkp' | 'unknown'. An unset value and the explicit "Unknown" option
// are the same thing: we do not know. Anything else the user actually stated is respected.
export function pkpStatusOf(form = {}) {
  const v = String(form?.pkp_status || '').trim().toLowerCase();
  if (v === 'pkp_registered') return 'pkp_registered';
  if (v === 'non_pkp') return 'non_pkp';
  return 'unknown';
}

// Profile fields that stop applying once the company states it is NOT PKP.
const PKP_ONLY_FIELDS = new Set(['pkp_effective_date', 'vat_status']);

/** Is this profile field irrelevant given the stated PKP status? */
export function isFieldNotRequired(form, field) {
  return pkpStatusOf(form) === 'non_pkp' && PKP_ONLY_FIELDS.has(field);
}

/**
 * @param {object|null} checklist  the /required-documents payload (null while loading/failed)
 * @param {object} opts
 *   @param {object} opts.form              current profile form values
 *   @param {string[]} opts.missingFields   profile fields the backend reports as missing
 *   @param {number} opts.obligations       count of applicable rules
 * @returns {{available:boolean, missingDocs:number|null, needsConfirmation:number|null,
 *            verificationGaps:number, riskFlags:string[], next:string, source:string}}
 */
export function buildReadiness(checklist, { form = {}, missingFields = [], obligations = 0 } = {}) {
  const riskFlags = [];
  // "Non-PKP" is a STATED status, not a missing one. Only an unset/unknown PKP status is a
  // gap; telling a user who just answered the question that it is unconfirmed is simply wrong.
  const pkp = pkpStatusOf(form);
  if (form.foreign_owned === 'yes' && pkp === 'unknown')
    riskFlags.push('Foreign-owned (PT PMA) without a confirmed PKP status — set PKP status in the profile');
  else if (form.foreign_owned === 'yes' && pkp === 'non_pkp')
    riskFlags.push('Company is marked Non-PKP. Confirm with an accountant if VAT/PPN registration is required.');
  if (form.employee_status === 'has_employees' && !form.bpjs_registered)
    riskFlags.push('Has employees but BPJS not registered');

  const base = { obligations, verificationGaps: missingFields.length, riskFlags };

  // No checklist → say so. Never fall back to a second, contradicting source.
  if (!checklist || !Array.isArray(checklist.items)) {
    return { ...base, available: false, missingDocs: null, needsConfirmation: null,
      source: 'unavailable',
      next: 'Open Compliance Documents to see which documents are still needed.' };
  }
  // A partial document set cannot prove a document is absent.
  if (checklist.truncated) {
    return { ...base, available: false, missingDocs: null, needsConfirmation: null,
      source: 'truncated',
      next: 'Too many documents to check at once — review Compliance Documents directly.' };
  }

  const required = checklist.items.filter(i => REQUIRED_LEVELS.has(i.requirement));
  const missing = required.filter(i => i.status === 'missing');
  const unconfirmed = required.filter(i => i.status === 'needs_review');
  const uploaded = checklist.items.filter(i => i.status === 'uploaded');

  // An uploaded document whose number is still blank in the profile: ask for the NUMBER.
  // Only for documents this jurisdiction actually requires — an optional or not_required
  // NPWP/NIB (e.g. a Singapore profile) must never produce "Enter your NIB number".
  const numbersToEnter = uploaded
    .filter(i => REQUIRED_LEVELS.has(i.requirement))
    .filter(i => NUMBER_FIELD[i.type])
    .filter(i => {
      const v = form[NUMBER_FIELD[i.type]];
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map(i => i.label);

  const parts = [];
  if (missing.length) parts.push(`Upload ${humanList(missing.map(i => i.label))}`);
  if (unconfirmed.length) parts.push(`confirm the document type for ${humanList(unconfirmed.map(i => i.label))}`);
  if (numbersToEnter.length) parts.push(`enter your ${humanList(numbersToEnter)} number`);
  if (!parts.length && missingFields.length)
    parts.push(`complete ${missingFields[0].replace(/_/g, ' ')} in the profile`);

  const next = parts.length
    ? parts.join(', and ').replace(/^(.)/, c => c.toUpperCase()) + '.'
    : 'Request accountant verification.';

  return { ...base, available: true, missingDocs: missing.length,
    needsConfirmation: unconfirmed.length, source: 'checklist', next };
}

/**
 * Pending document ACTIONS for the AI Accountant Workbench.
 *
 * Same payload, same rules as [buildReadiness] and the Compliance Documents checklist — the
 * Workbench previously rendered a hardcoded "NPWP, NIB, PKP certificate" line that kept asking
 * for documents the checklist already showed as uploaded.
 *
 * Only these produce an action:
 *   - a required/conditional_required document with status `missing`  → upload it
 *   - a required/conditional_required document with status `needs_review` → confirm its type
 *   - a required/conditional_required document that is uploaded but whose profile number is
 *     blank → enter the number
 * `uploaded` (with its number filled), `optional` and `not_required` never produce an action.
 *
 * @returns {{available:boolean, actions:Array<{id,type,doc_type,label,sub}>, reason:string|null}}
 */
export function buildDocumentActions(checklist, { form = {} } = {}) {
  if (!checklist || !Array.isArray(checklist.items))
    return { available: false, actions: [], reason: 'unavailable' };
  // A partial document set cannot prove a document is absent — do not invent upload actions.
  if (checklist.truncated) return { available: false, actions: [], reason: 'truncated' };

  const required = checklist.items.filter(i => REQUIRED_LEVELS.has(i.requirement));
  const actions = [];

  const meta = (i) => {
    const priority = priorityOf(i);
    return { doc_type: i.type, group: groupOf(i.type), priority,
      priority_label: PRIORITY_LABEL[priority], rank: PRIORITY_RANK[priority] ?? 9 };
  };

  for (const i of required.filter(i => i.status === 'missing')) {
    const m = meta(i);
    actions.push({ id: `upload:${i.type}`, type: 'upload', ...m,
      label: `Upload ${i.label}`,
      // The priority label says WHY it is asked for, so a BPJS row cannot read like an akta.
      sub: `${m.priority_label} — ${i.reason || 'required for this profile'}` });
  }
  for (const i of required.filter(i => i.status === 'needs_review')) {
    const m = meta(i);
    actions.push({ id: `confirm:${i.type}`, type: 'confirm', ...m,
      label: `Confirm document type — ${i.label}`,
      sub: `${m.priority_label} — a document may match, but it has not been confirmed yet` });
  }
  for (const i of required.filter(i => i.status === 'uploaded' && NUMBER_FIELD[i.type])) {
    const v = form[NUMBER_FIELD[i.type]];
    if (v === undefined || v === null || String(v).trim() === '') {
      const m = meta(i);
      actions.push({ id: `number:${i.type}`, type: 'number', ...m,
        label: `Enter your ${i.label} number`,
        sub: `The ${i.label} document is uploaded, but the number is missing from the profile` });
    }
  }
  // Identity, then tax registration, then payroll. Optional/recommended documents produce no
  // action at all, so they can never look urgent.
  actions.sort((a, b) => a.rank - b.rank);
  return { available: true, actions, reason: null };
}

export default buildReadiness;
