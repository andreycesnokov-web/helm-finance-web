// What the client is allowed to see of an intake summary.
//
// `financial_documents.extracted_json` is free-form. Returning it wholesale through
// /api/documents would leak extraction internals, so the serialiser in server/index.js
// is a WHITELIST and anything unnamed stays server-side. That is why ai_intake_v2 —
// written by the Document Intake Orchestrator — was invisible to the UI: correct by
// default, but it left the Document Center unable to show what intake had worked out.
//
// This module names the review-safe fields, and only those. Every value here is either
// our own vocabulary (status, direction, a next-action KEY) or a figure the user already
// sees on the document. Deliberately NOT exposed, and not exposable by accident because
// this is a whitelist:
//   · raw or excerpted document text        · storage paths and signed URLs
//   · the extractor's internal reasoning     · file fingerprints, ids, business_id
//   · anything added to the summary later — a new field is private until named here.
'use strict';

const STR = (v) => (typeof v === 'string' && v ? v : null);
const NUM = (v) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
const BOOL = (v) => (v === null || v === undefined ? null : !!v);

// Lists are our own vocabulary (field names, blocker sentences, action keys). Capped so a
// malformed summary can never turn one document row into an unbounded payload.
const LIST = (v, cap = 20) => (Array.isArray(v)
  ? v.filter((x) => typeof x === 'string' && x).slice(0, cap).map((x) => x.slice(0, 200))
  : []);

/** The review-safe view of extracted_json.ai_intake_v2, or null when there is none. */
function publicIntakeV2(v2) {
  if (!v2 || typeof v2 !== 'object') return null;
  return {
    version: STR(v2.version),
    status: STR(v2.status),
    document_type: STR(v2.document_type),
    confidence: STR(v2.confidence),
    direction: STR(v2.direction),
    business_meaning: STR(v2.business_meaning),
    counterparty_status: STR(v2.counterparty_status),
    matched_counterparty_id: STR(v2.matched_counterparty_id),
    suggested_record_type: STR(v2.suggested_record_type),
    amount: NUM(v2.amount),
    currency: STR(v2.currency),
    ppn_detected: BOOL(v2.ppn_detected),
    ppn_amount: NUM(v2.ppn_amount),
    tax_status: STR(v2.tax_status),
    withholding_status: STR(v2.withholding_status),
    accountant_review_required: BOOL(v2.accountant_review_required),
    missing_fields: LIST(v2.missing_fields),
    blockers: LIST(v2.blockers),
    next_action_keys: LIST(v2.next_action_keys),
    processed_at: STR(v2.processed_at),
  };
}

/** The exact key set above — used by the tests to prove nothing else can slip through. */
const PUBLIC_INTAKE_V2_FIELDS = Object.keys(publicIntakeV2({ version: 'x' }));

module.exports = { publicIntakeV2, PUBLIC_INTAKE_V2_FIELDS };
