// Deterministic tax-rule activation gate + review transition rules.
// Pure functions (no DB) so they are unit-testable. The backend is the source
// of truth for activation; the UI button must not bypass these.

const DUE_DATE_TYPES = ['day_of_next_month', 'end_of_next_month', 'months_after_period_end'];

// A review counts as an EFFECTIVE approved review for a rule only if ALL hold:
//  same tax_rule_id, same rule_version, status approved, license verified,
//  reviewed_at set, not expired.
function isEffectiveApprovedReview(review, rule, now = new Date()) {
  if (!review || !rule) return false;
  if (review.tax_rule_id !== rule.id) return false;
  if (review.rule_version !== rule.version) return false;
  if (review.review_status !== 'approved') return false;
  if (review.license_verification_status !== 'verified') return false;
  if (!review.reviewed_at) return false;
  if (review.expires_at && new Date(review.expires_at) < now) return false;
  return true;
}

// Returns the list of activation blockers (empty = may activate). §15.
function computeActivationBlockers(rule, source, effectiveApprovedReview, now = new Date()) {
  const b = [];
  if (rule && rule.status === 'active') b.push('already_active');
  if (!rule || !rule.official_source_id || !source) b.push('source_missing');
  else {
    if (!['verified', 'active'].includes(source.status) || !source.last_verified_at) b.push('source_not_verified');
    if (['outdated', 'unavailable', 'replaced'].includes(source.status)) b.push('source_outdated');
  }
  if (!effectiveApprovedReview) b.push('rule_not_professionally_reviewed');
  if (!rule || !rule.effective_from) b.push('effective_dates_missing');
  if (!rule || !rule.due_date_rule_json) b.push('due_date_missing');
  else if (!DUE_DATE_TYPES.includes(rule.due_date_rule_json.type)) b.push('due_date_invalid');
  if (!rule || rule.applies_when == null) b.push('applicability_incomplete');
  return [...new Set(b)];
}

// Allowed review_status transitions. License verification is a SEPARATE action
// (different endpoint), not a status transition.
const REVIEW_TRANSITIONS = {
  pending:          ['in_review', 'rejected'],
  in_review:        ['changes_required', 'approved', 'rejected'],
  changes_required: ['in_review', 'rejected'],
  approved:         ['expired', 'superseded'],
  rejected:         [],
  expired:          [],
  superseded:       [],
};
function validReviewTransition(from, to) {
  if (from === to) return true; // idempotent no-op
  return (REVIEW_TRANSITIONS[from] || []).includes(to);
}

module.exports = { DUE_DATE_TYPES, isEffectiveApprovedReview, computeActivationBlockers, validReviewTransition };
