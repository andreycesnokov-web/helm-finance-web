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
    source: STR(v2.source),
    intent_conflict: BOOL(v2.intent_conflict),
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

/** What the user said they were uploading. Four short fields, all our own vocabulary. */
function publicUploadIntent(intent) {
  if (!intent || typeof intent !== 'object') return null;
  return {
    source: STR(intent.source),
    label: STR(intent.label),
    suggested_document_type: STR(intent.suggested_document_type),
    suggested_direction: STR(intent.suggested_direction),
    created_at: STR(intent.created_at),
  };
}

/** The v3 record, field by field.
 *
 *  What is deliberately NOT here: the prompt, the request, any key or header, the raw
 *  tool payload, page images, and the evidence excerpts (which quote the document's own
 *  text). The client gets the CONCLUSION and the operational facts about the run — never
 *  the document's contents beyond the values it is asking the user to confirm. */
function publicIntakeV3(v3) {
  if (!v3 || typeof v3 !== 'object') return null;
  const f = v3.fields && typeof v3.fields === 'object' ? v3.fields : {};
  const cp = f.counterparty && typeof f.counterparty === 'object' ? f.counterparty : null;

  // An analysis that did not complete. The client needs enough to show the state and
  // offer a retry, and nothing more: provider status codes, provider text and the model
  // that actually answered are operator diagnostics and stay server-side.
  if (v3.analyzed === false) {
    const fail = v3.failure && typeof v3.failure === 'object' ? v3.failure : {};
    return {
      analyzed: false,
      schema_version: STR(v3.schema_version),
      failure_reason: STR(fail.reason),
      retryable: fail.retryable !== false,
      message: STR(fail.user_message),
      attempts: NUM(v3.attempts),
      last_attempt_at: STR(v3.last_attempt_at),
    };
  }

  const b = v3.bundle && typeof v3.bundle === 'object' ? v3.bundle : null;
  return {
    analyzed: true,
    // What the file holds. A person confirms each child separately; this creates nothing.
    bundle: b ? {
      shared_reference: STR(b.shared_reference),
      children: (Array.isArray(b.children) ? b.children : []).slice(0, 10).map((c) => ({
        index: NUM(c.index),
        document_type: STR(c.document_type),
        title_printed_text: STR(c.title_printed_text),
        page_start: NUM(c.page_start),
        page_end: NUM(c.page_end),
        identifier: STR(c.identifier),
      })),
    } : null,
    schema_version: STR(v3.schema_version),
    prompt_version: STR(v3.prompt_version),
    model: STR(v3.model),
    source: STR(v3.source),
    processed_at: STR(v3.processed_at),
    duration_ms: NUM(v3.duration_ms),
    page_count: NUM(v3.page_count),
    pages_analyzed: Array.isArray(v3.pages_analyzed)
      ? v3.pages_analyzed.filter((n) => Number.isFinite(n)).slice(0, 50) : [],
    analysis_complete: BOOL(v3.analysis_complete),
    validation_status: STR(v3.validation_status),
    counterparty_status: STR(v3.counterparty_status),
    can_create_counterparty: BOOL(v3.can_create_counterparty),
    can_create_financial_record: BOOL(v3.can_create_financial_record),
    fields: {
      document_type: STR(f.document_type),
      document_number: STR(f.document_number),
      currency: STR(f.currency),
      dpp: NUM(f.dpp), ppn: NUM(f.ppn), total: NUM(f.total),
      amount_paid: NUM(f.amount_paid), amount_due: NUM(f.amount_due),
      document_date: STR(f.document_date),
      due_date: STR(f.due_date),
      payment_date: STR(f.payment_date),
      counterparty: cp ? {
        legal_name: STR(cp.legal_name),
        npwp: STR(cp.npwp),
        role: STR(cp.role),
      } : null,
    },
    warnings: LIST(v3.warnings),
    blockers: LIST(v3.blockers),
    failed_checks: LIST(v3.failed_checks),
  };
}

module.exports = { publicIntakeV2, publicIntakeV3, publicUploadIntent, PUBLIC_INTAKE_V2_FIELDS };
