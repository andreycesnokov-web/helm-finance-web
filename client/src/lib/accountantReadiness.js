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

const humanList = (items) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

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
  if (form.foreign_owned === 'yes' && form.pkp_status !== 'pkp_registered')
    riskFlags.push('Foreign-owned (PT PMA) without confirmed PKP status');
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

export default buildReadiness;
