// Unit tests for the tax-rule activation gate + review transitions.
// Run: node tests/taxGate.test.js
const { computeActivationBlockers, isEffectiveApprovedReview, validReviewTransition } = require('../server/lib/taxGate');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { console.log(`OK  ${name}`); pass++; } else { console.log(`XX  ${name}`); fail++; } };
const has = (arr, x) => arr.includes(x);

const verifiedSource = { status: 'verified', last_verified_at: '2026-06-01T00:00:00Z' };
const draftSource = { status: 'draft', last_verified_at: null };
const rule = (over = {}) => ({ id: 'r1', version: 2, official_source_id: 's1', status: 'under_review',
  effective_from: '2026-01-01', due_date_rule_json: { type: 'end_of_next_month' }, applies_when: { vat_status: 'pkp' }, ...over });
const approved = (over = {}) => ({ tax_rule_id: 'r1', rule_version: 2, review_status: 'approved',
  license_verification_status: 'verified', reviewer_name: 'A', license_number: 'X', reviewed_at: '2026-06-01T00:00:00Z', expires_at: null, ...over });

// ── effective approved review ────────────────────────────────────────────────
ok('valid approved review is effective', isEffectiveApprovedReview(approved(), rule()) === true);
ok('wrong version is NOT effective', isEffectiveApprovedReview(approved({ rule_version: 1 }), rule()) === false);
ok('wrong rule id is NOT effective', isEffectiveApprovedReview(approved({ tax_rule_id: 'other' }), rule()) === false);
ok('unverified license is NOT effective', isEffectiveApprovedReview(approved({ license_verification_status: 'unverified' }), rule()) === false);
ok('missing reviewed_at is NOT effective', isEffectiveApprovedReview(approved({ reviewed_at: null }), rule()) === false);
ok('expired review is NOT effective', isEffectiveApprovedReview(approved({ expires_at: '2020-01-01T00:00:00Z' }), rule()) === false);
ok('non-approved status is NOT effective', isEffectiveApprovedReview(approved({ review_status: 'in_review' }), rule()) === false);

// ── activation blockers ──────────────────────────────────────────────────────
ok('verified source + no approved review -> blocked', has(computeActivationBlockers(rule(), verifiedSource, null), 'rule_not_professionally_reviewed'));
ok('approved review + draft source -> blocked', has(computeActivationBlockers(rule(), draftSource, approved()), 'source_not_verified'));
ok('expired/invalid review passed as null -> blocked', has(computeActivationBlockers(rule(), verifiedSource, null), 'rule_not_professionally_reviewed'));
ok('invalid due_date json -> blocked', has(computeActivationBlockers(rule({ due_date_rule_json: { type: 'full_moon' } }), verifiedSource, approved()), 'due_date_invalid'));
ok('missing due_date -> blocked', has(computeActivationBlockers(rule({ due_date_rule_json: null }), verifiedSource, approved()), 'due_date_missing'));
ok('missing effective_from -> blocked', has(computeActivationBlockers(rule({ effective_from: null }), verifiedSource, approved()), 'effective_dates_missing'));
ok('incomplete applicability -> blocked', has(computeActivationBlockers(rule({ applies_when: null }), verifiedSource, approved()), 'applicability_incomplete'));
ok('outdated source -> blocked', has(computeActivationBlockers(rule(), { status: 'outdated', last_verified_at: '2026-01-01' }, approved()), 'source_outdated'));
ok('all requirements met -> NO blockers', computeActivationBlockers(rule(), verifiedSource, approved()).length === 0);

// ── review transitions ───────────────────────────────────────────────────────
ok('pending -> in_review allowed', validReviewTransition('pending', 'in_review'));
ok('in_review -> approved allowed', validReviewTransition('in_review', 'approved'));
ok('in_review -> changes_required allowed', validReviewTransition('in_review', 'changes_required'));
ok('approved -> expired allowed', validReviewTransition('approved', 'expired'));
ok('pending -> approved DENIED', !validReviewTransition('pending', 'approved'));
ok('rejected -> approved DENIED', !validReviewTransition('rejected', 'approved'));
ok('approved -> in_review DENIED', !validReviewTransition('approved', 'in_review'));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
