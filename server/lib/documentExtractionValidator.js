// The model extracts. This judges.
//
// The division of labour matters: everything upstream is evidence, and evidence can be
// wrong. This layer is allowed to ACCEPT, WARN, REQUIRE CONFIRMATION or REJECT — and
// nothing else. It may not repair a value, fill a gap, or quietly substitute a number it
// finds more plausible.
//
// That restraint is the point. The previous pipeline's damage came from code "fixing"
// what the model said: a regex classification overwrote the model's, a global NPWP was
// paired with a global name, a total was back-computed into a tax figure. Every one of
// those was code inventing an accounting fact. A validator that can only downgrade
// cannot do that.
'use strict';

const normNpwp = (v) => String(v || '').replace(/\D/g, '');

/** Statuses a field or the whole extraction can carry. */
const STATUS = { OK: 'ok', NEEDS_REVIEW: 'needs_review', REJECTED: 'rejected' };

const SUPPORTED_CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'AUD', 'JPY', 'GBP', 'MYR'];

// Types that record money already moved. They can never imply a bill.
const SETTLED_TYPES = ['receipt', 'kwitansi', 'payment_proof'];

const val = (f) => (f && typeof f === 'object' ? f.value : undefined);
const num = (f) => {
  const v = val(f);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const hasEvidence = (f) => Array.isArray(f?.evidence) && f.evidence.length > 0;

/**
 * Validate one v3 extraction.
 *
 * @param ex        the model's structured output
 * @param context   { business, pagesProvided, uploadedAt, documentTypes }
 * @returns { status, checks[], warnings[], blockers[], counterparty_status,
 *            can_create_counterparty, can_create_financial_record, normalized }
 */
function validateExtraction(ex, context = {}) {
  const checks = [];
  const warnings = [];
  const blockers = [];
  const add = (id, pass, detail, fatal = false) => {
    checks.push({ id, pass, detail: detail || null });
    if (!pass) (fatal ? blockers : warnings).push(detail);
  };

  // 1 — the shape itself. A malformed answer is rejected outright; there is nothing
  //     here to review.
  if (!ex || typeof ex !== 'object') {
    return {
      status: STATUS.REJECTED, checks: [{ id: 'schema', pass: false, detail: 'No extraction returned.' }],
      warnings: [], blockers: ['The document could not be analysed.'],
      counterparty_status: 'unknown', can_create_counterparty: false,
      can_create_financial_record: false, normalized: null,
    };
  }
  const parties = Array.isArray(ex.parties) ? ex.parties : [];
  const dates = ex.dates || {};
  const amounts = ex.amounts || {};
  const docType = val(ex.document_type) || 'unknown';

  add('schema.document_type', typeof docType === 'string' && docType.length > 0,
    'The extraction returned no document type.', true);

  // 2 — was the WHOLE document read? A partial read is never presented as a reading.
  const pagesAnalyzed = Array.isArray(ex.pages_analyzed) ? ex.pages_analyzed : [];
  const pagesProvided = context.pagesProvided || ex.page_count || null;
  if (ex.analysis_complete === false) {
    add('pages.complete', false,
      'The document was only partly analysed, so the result needs review.', false);
  }
  if (pagesProvided && pagesAnalyzed.length && pagesAnalyzed.length < pagesProvided) {
    add('pages.coverage', false,
      `Only ${pagesAnalyzed.length} of ${pagesProvided} pages were analysed.`, false);
  } else {
    add('pages.coverage', true);
  }

  /* ── parties ────────────────────────────────────────────────────────────── */

  // 4 — a name and an NPWP may only travel together when the SAME party block carried
  //     both. The evidence array is what makes that checkable rather than assumed.
  for (const p of parties) {
    const nameEv = p?.legal_name?.evidence || [];
    const npwpEv = p?.npwp?.evidence || [];
    if (val(p?.npwp) && nameEv.length && npwpEv.length) {
      const sameSection = npwpEv.some((e) => nameEv.some((n) => n.section && e.section && n.section === e.section));
      const samePage = npwpEv.some((e) => nameEv.some((n) => n.page === e.page));
      if (!sameSection && !samePage) {
        add(`party.${p.party_id}.pairing`, false,
          `${val(p.legal_name) || p.party_id}: the name and the NPWP were read from different `
          + 'places on the document. Confirm the tax number belongs to this company.', false);
      }
    }
    // 5 — an NPWP that is not a plausible tax number is not usable for matching.
    const npwpDigits = normNpwp(p?.npwp?.normalized_value || val(p?.npwp));
    if (val(p?.npwp) && (npwpDigits.length < 15 || npwpDigits.length > 16)) {
      add(`party.${p.party_id}.npwp_format`, false,
        `${val(p.legal_name) || p.party_id}: the NPWP does not look like a valid tax number.`, false);
    }
  }
  if (parties.length) add('party.pairing', true);

  /* ── who is who ─────────────────────────────────────────────────────────── */

  const business = context.business || {};
  const bizNames = [business.legal_name, business.display_name, business.name, ...(business.aliases || [])]
    .filter(Boolean).map((s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim());
  const bizNpwp = normNpwp(business.npwp);

  const looksLikeUs = (p) => {
    const n = String(val(p?.legal_name) || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const d = normNpwp(p?.npwp?.normalized_value || val(p?.npwp));
    if (bizNpwp && d && d === bizNpwp) return 'npwp';
    if (n && bizNames.some((b) => b === n || (b.length > 6 && (n.includes(b) || b.includes(n))))) return 'name';
    return null;
  };

  const cpId = ex.counterparty_candidate_party_id || null;
  const candidate = parties.find((p) => p.party_id === cpId) || null;
  const selfHit = candidate ? looksLikeUs(candidate) : null;

  let counterpartyStatus = 'unknown';
  let canCreateCounterparty = false;

  if (!parties.length) {
    counterpartyStatus = 'not_found';
    add('counterparty.present', false, 'No party could be read from this document.', false);
  } else if (selfHit) {
    // 3 — the hard rule. Never the business itself, whatever the model concluded.
    counterpartyStatus = 'self_match';
    add('counterparty.self_match', false,
      'CFO AI may have identified your own company instead of the counterparty. '
      + 'Review the document parties before continuing.', true);
  } else if (!candidate) {
    counterpartyStatus = 'not_found';
    add('counterparty.present', false,
      'The counterparty could not be identified on this document.', false);
  } else if (!parties.some((p) => looksLikeUs(p))) {
    // We are on neither side: the "other" party is a guess.
    counterpartyStatus = 'needs_confirmation';
    add('counterparty.business_present', false,
      'This business could not be matched to any party on the document. '
      + 'Confirm which side is the counterparty.', false);
  } else {
    counterpartyStatus = 'ok';
    canCreateCounterparty = true;
    add('counterparty.resolved', true);
  }

  /* ── dates ──────────────────────────────────────────────────────────────── */

  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const dateVal = (k) => {
    const v = dates[k]?.value;
    return typeof v === 'string' && isoRe.test(v) ? v : null;
  };
  for (const k of ['document_date', 'due_date', 'payment_date']) {
    const raw = dates[k]?.value;
    if (raw && !isoRe.test(String(raw))) {
      add(`date.${k}.format`, false, `The ${k.replace('_', ' ')} is not a usable date.`, false);
    }
  }
  const docDate = dateVal('document_date');
  const dueDate = dateVal('due_date');

  // 6 — the upload date is not a document date. If they coincide AND the model showed no
  //     printed text for it, the value is not evidence of anything.
  const uploadedDay = context.uploadedAt ? String(context.uploadedAt).slice(0, 10) : null;
  if (docDate && uploadedDay && docDate === uploadedDay && !dates.document_date?.printed_text) {
    add('date.not_upload_date', false,
      'The document date matches the upload date and no printed date was found. Confirm it.', false);
  } else {
    add('date.not_upload_date', true);
  }

  // 7 — a deadline before the document exists is a contradiction, not a correction.
  if (docDate && dueDate && dueDate < docDate) {
    add('date.due_after_document', false,
      `The due date (${dueDate}) is before the document date (${docDate}). Confirm both.`, false);
  } else {
    add('date.due_after_document', true);
  }

  /* ── money ──────────────────────────────────────────────────────────────── */

  const currency = amounts.currency || null;
  add('amount.currency', !currency || SUPPORTED_CURRENCIES.includes(String(currency).toUpperCase()),
    `Currency ${currency} is not supported.`, false);

  const dpp = num(amounts.dpp);
  const ppn = num(amounts.ppn);
  const total = num(amounts.total);
  for (const [k, v] of [['dpp', dpp], ['ppn', ppn], ['total', total],
    ['subtotal', num(amounts.subtotal)], ['amount_paid', num(amounts.amount_paid)]]) {
    if (v !== null && v < 0) add(`amount.${k}.sign`, false, `${k} cannot be negative.`, false);
  }

  // 10 — arithmetic is a CHECK, never a repair. A mismatch is reported with both figures
  //      and the user decides; nothing is recomputed.
  if (dpp !== null && ppn !== null && total !== null) {
    const drift = Math.abs(dpp + ppn - total);
    if (drift > 1) {
      add('amount.consistency', false,
        `DPP ${dpp} + PPN ${ppn} does not equal the total ${total}. Confirm the figures.`, false);
    } else {
      add('amount.consistency', true);
    }
  }

  // A tax figure the model admits it derived is never presented as printed.
  if (ppn !== null && amounts.ppn?.calculated === true) {
    add('amount.ppn.calculated', false,
      'The PPN was calculated, not read from the document. It needs accountant review.', false);
  }
  if (ppn !== null && !hasEvidence(amounts.ppn) && amounts.ppn?.calculated !== true) {
    add('amount.ppn.evidence', false,
      'A PPN amount was returned with no evidence of where it was printed. Confirm it.', false);
  }

  /* ── what may follow ────────────────────────────────────────────────────── */

  // 11 — settled money is never a bill.
  const settled = SETTLED_TYPES.includes(docType);
  // 12/13 — a record needs a direction and a counterparty; neither may be assumed.
  const directionKnown = !!ex.counterparty_candidate_party_id && counterpartyStatus === 'ok';
  const amountKnown = total !== null || num(amounts.amount_due) !== null;

  const canCreateFinancialRecord = !settled && directionKnown && amountKnown
    && counterpartyStatus === 'ok' && blockers.length === 0;

  if (settled) {
    add('record.settled_type', true,
      null);
    warnings.push('This document records money that already moved. It is evidence, not a bill.');
  }
  if (!directionKnown) blockers.push('The counterparty is not resolved, so no financial record can be drafted.');
  if (!amountKnown) blockers.push('No amount could be read, so no financial record can be drafted.');

  const failed = checks.filter((c) => !c.pass);
  const status = blockers.length ? STATUS.NEEDS_REVIEW
    : failed.length ? STATUS.NEEDS_REVIEW : STATUS.OK;

  return {
    status,
    checks,
    warnings: [...new Set([...(Array.isArray(ex.warnings) ? ex.warnings : []), ...warnings])],
    blockers: [...new Set(blockers)],
    counterparty_status: counterpartyStatus,
    can_create_counterparty: canCreateCounterparty && counterpartyStatus === 'ok',
    can_create_financial_record: canCreateFinancialRecord,
    normalized: {
      document_type: docType,
      document_number: val(ex.document_number) ?? null,
      currency,
      dpp, ppn, total,
      amount_paid: num(amounts.amount_paid),
      amount_due: num(amounts.amount_due),
      document_date: docDate, due_date: dueDate, payment_date: dateVal('payment_date'),
      counterparty: candidate && counterpartyStatus !== 'self_match' ? {
        legal_name: val(candidate.legal_name) ?? null,
        npwp: val(candidate.npwp) ?? null,
        npwp_normalized: normNpwp(candidate.npwp?.normalized_value || val(candidate.npwp)) || null,
        role: candidate.role || 'unknown',
      } : null,
      current_business_party_id: ex.current_business_party_id ?? null,
    },
  };
}

module.exports = { validateExtraction, STATUS, SUPPORTED_CURRENCIES, SETTLED_TYPES, normNpwp };
