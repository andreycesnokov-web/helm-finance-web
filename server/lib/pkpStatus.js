// Canonical PKP (VAT-taxable entrepreneur) status handling.
//
// Two UIs write this field with different vocabularies: the premium AI Accountant page saves
// `pkp_registered` / `non_pkp`, while the legacy Tax Profile page saved plain `pkp`. Backend
// rules only recognised `pkp_registered`, so a registered company that used the legacy page
// got its PKP certificate marked *optional* instead of required.
//
// This module is the single place that decides what a stored value MEANS. Existing rows are
// left untouched — no migration; legacy values keep working by being normalised on read.
//
// Deliberately conservative: anything not clearly recognisable is `unknown`, never `non_pkp`.
// Guessing "not registered" from an unrecognised value would silently drop a real requirement.

const REGISTERED = new Set([
  'pkp_registered',
  'pkp',            // legacy Tax Profile page
  'registered',
  'is_pkp',
  'yes',
  'true',
]);

const NOT_REGISTERED = new Set([
  'non_pkp',
  'non-pkp',
  'nonpkp',
  'not_pkp',
  'not_registered',
  'no',
  'false',
]);

/**
 * @param {*} value raw stored/submitted pkp_status
 * @returns {'pkp_registered'|'non_pkp'|'unknown'}
 */
function normalizePkpStatus(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!v) return 'unknown';
  if (REGISTERED.has(v)) return 'pkp_registered';
  if (NOT_REGISTERED.has(v)) return 'non_pkp';
  return 'unknown';
}

// The value new saves should write. Legacy values are normalised on read, not rewritten.
const CANONICAL_PKP_STATUS = { registered: 'pkp_registered', not_registered: 'non_pkp', unknown: 'unknown' };

const isPkpRegistered = (value) => normalizePkpStatus(value) === 'pkp_registered';
const isNonPkp = (value) => normalizePkpStatus(value) === 'non_pkp';

// Profile fields that only apply to a company that IS PKP-registered. A Non-PKP company is not
// missing these — they do not apply, so completeness must not demand them.
const PKP_ONLY_PROFILE_FIELDS = ['vat_status', 'pkp_effective_date'];

/** Fields from `fields` that actually apply, given the stated PKP status. */
function applicableProfileFields(fields, pkpStatus) {
  if (!isNonPkp(pkpStatus)) return [...fields];
  return fields.filter(f => !PKP_ONLY_PROFILE_FIELDS.includes(f));
}

module.exports = {
  normalizePkpStatus,
  isPkpRegistered,
  isNonPkp,
  applicableProfileFields,
  CANONICAL_PKP_STATUS,
  PKP_ONLY_PROFILE_FIELDS,
};
