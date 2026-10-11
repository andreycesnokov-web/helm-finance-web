// AI Tax Split V1 — suggest how an invoice splits between vendor payment and withheld tax.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
// A small, explicitly configurable treatment catalog. It answers "what does this
// invoice look like, and what would that imply?" — never "this is your tax".
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//   * NOT an activated tax rule. `tax_rules` currently holds ZERO rows with
//     status='active', and this module deliberately does not read it. The rates below
//     come from the knowledge base under knowledge/indonesia_official_kb/, where every
//     candidate is status=under_review and legal_verified=false.
//   * NOT legal advice. Every result carries accountant_review_required=true.
//   * NOT OCR. Detection is keyword matching over the description and vendor name the
//     user supplied, and every result reports `matched_on` so the UI can say so.
//   * NOT a writer. This module is pure: no DB, no network, no side effects.
//
// Only ONE treatment auto-calculates (land/building rent), because it is the only one
// whose rate and base are cited to operative regulation text read from archived official
// bytes (PP 34/2017 Pasal 4(1)-(2)). Everything else deliberately refuses to compute.
const { reconcileInvoice } = require('./taxDocMath');

const DISCLAIMER =
  'CFO AI provides suggested tax treatment based on available invoice data. ' +
  'Final tax treatment must be reviewed by your accountant or tax advisor.';

/* ── treatment catalog ─────────────────────────────────────────────────────
   `auto_calculate` is the safety switch. It is true ONLY where an archived
   official source supports both a rate and a base. */
const TREATMENTS = {
  rent_land_building: {
    key: 'rent_land_building',
    label: 'Land / building rent',
    tax_type: 'PPh Final Pasal 4(2)',
    auto_calculate: true,
    rate: 0.10,
    base: 'gross_rental_amount',
    base_label: 'Gross rental amount',
    final_or_creditable: 'final',
    // Provenance. kb_status is the honest status of the underlying candidate.
    source_ids: ['DJP_PPH42_PP34_004', 'BPK_PPH42_PP34_001'],
    official_rule_reference: 'PP 34 Tahun 2017 Pasal 4(1)-(2)',
    kb_candidate_id: 'TAX_ID_PPH42_RENTAL_001',
    kb_status: 'under_review',
    base_note:
      'PP 34/2017 Pasal 4(2) defines gross as all amounts paid or owed relating to the ' +
      'rented property, including maintenance, security, service and facility charges, ' +
      'whether contracted separately or combined.',
    required_documents: [
      'Invoice', 'Rental agreement / contract', 'Vendor NPWP', 'Proof of vendor payment',
      'Tax billing code', 'Tax payment proof / BPN / NTPN', 'Bukti potong / e-Bupot',
      'Accountant confirmation',
    ],
    review_reasons: [
      'The underlying rule is a knowledge-base candidate under review, not an activated rule.',
      'Whether the tenant is an appointed Pemotong under PP 34/2017 Pasal 3 must be confirmed.',
      'If the invoice mixes rent with third-party service charges, more than one treatment may apply.',
    ],
  },
  service_fee: {
    key: 'service_fee',
    label: 'Service fee',
    tax_type: 'Possibly PPh 23 — not determined in V1',
    auto_calculate: false,
    rate: null,
    base: 'needs_reviewer',
    base_label: 'Needs accountant review',
    final_or_creditable: null,
    source_ids: ['DJP_PPH23_PMK141_003'],
    official_rule_reference: 'PMK 141/PMK.03/2015 (candidate, under review)',
    kb_candidate_id: 'TAX_ID_PPH23_LEGAL_001',
    kb_status: 'under_review',
    base_note: null,
    required_documents: [
      'Invoice', 'Service agreement / contract', 'Vendor NPWP', 'Vendor legal form (entity or individual)',
      'Proof of vendor payment', 'Accountant confirmation',
    ],
    review_reasons: [
      'Whether the provider is an entity (PPh 23) or an individual (PPh 21) changes the article, ' +
      'and CFO AI cannot determine legal form from the data it holds.',
      'Which enumerated jasa lain item applies has not been confirmed for this vendor.',
      'No rate is calculated because no rule is configured for this treatment in V1.',
    ],
  },
  equipment_capex: {
    key: 'equipment_capex',
    label: 'Equipment / machine purchase',
    tax_type: 'Possibly CAPEX — no withholding determined in V1',
    auto_calculate: false,
    rate: null,
    base: 'needs_reviewer',
    base_label: 'Needs accountant review',
    final_or_creditable: null,
    source_ids: [],
    official_rule_reference: null,
    kb_candidate_id: 'TXN_EQUIPMENT_CAPEX',
    kb_status: 'under_review',
    base_note: null,
    asset_hook: true,
    required_documents: [
      'Invoice', 'Delivery note / goods receipt', 'Faktur pajak (if vendor is PKP)',
      'Proof of vendor payment', 'Accountant confirmation',
    ],
    review_reasons: [
      'Capitalisation versus expense is an accounting judgement, not something CFO AI decides.',
      'No official source for equipment purchases has been collected, so no rate is suggested.',
    ],
  },
  unknown: {
    key: 'unknown',
    label: 'Unclear',
    tax_type: 'Tax treatment unclear',
    auto_calculate: false,
    rate: null,
    base: 'needs_reviewer',
    base_label: 'Needs accountant review',
    final_or_creditable: null,
    source_ids: [],
    official_rule_reference: null,
    kb_candidate_id: null,
    kb_status: 'under_review',
    base_note: null,
    required_documents: ['Invoice', 'Contract / agreement', 'Vendor NPWP', 'Accountant confirmation'],
    review_reasons: [
      'The description did not match a configured treatment.',
      'Send the contract and invoice detail to your accountant before paying.',
    ],
  },
};

/* ── detection ─────────────────────────────────────────────────────────────
   Keyword matching over description + vendor name. Never OCR, never inference
   from an amount. Reports what it matched on so the UI can be honest. */
const PATTERNS = [
  ['rent_land_building', [
    /\brent\b/i, /\bsewa\b/i, /sewa\s+gedung/i, /sewa\s+tanah/i, /sewa\s+tempat/i,
    /sewa\s+bangunan/i, /office\s+rent/i, /building\s+rent/i, /land\s*\/?\s*building\s+rent/i,
    /\bpersewaan\b/i, /\blease\b/i,
  ]],
  ['equipment_capex', [
    /\bequipment\b/i, /\bmachine\b/i, /\bmachinery\b/i, /\bdevice\b/i, /\bhardware\b/i,
    /asset\s+purchase/i, /\bperalatan\b/i, /\bmesin\b/i,
  ]],
  ['service_fee', [
    /service\s+fee/i, /\bjasa\b/i, /\bconsult/i, /professional\s+service/i,
    /management\s+fee/i, /\bkonsultan\b/i, /\blegal\s+service/i,
  ]],
];

/** @returns { treatment_key, confidence, matched_on, matched_term } */
function detectTreatment({ description = '', vendor_name = '' } = {}) {
  const hay = `${description || ''} ${vendor_name || ''}`.trim();
  if (!hay) return { treatment_key: 'unknown', confidence: 'Needs accountant review', matched_on: 'none', matched_term: null };

  for (const [key, res] of PATTERNS) {
    const hit = res.find((re) => re.test(hay));
    if (hit) {
      // A description match is a stronger signal than a vendor-name match, and the
      // difference is reported rather than hidden.
      const inDesc = description && hit.test(description);
      return {
        treatment_key: key,
        // Only rent can reach High, because only rent has a source-backed rule behind it.
        confidence: key === 'rent_land_building' ? (inDesc ? 'High' : 'Medium') : 'Needs accountant review',
        matched_on: inDesc ? 'description' : 'vendor_name',
        matched_term: String(hit).replace(/^\/|\/i?$/g, ''),
      };
    }
  }
  return { treatment_key: 'unknown', confidence: 'Needs accountant review', matched_on: 'none', matched_term: null };
}

const round = (n) => Math.round(Number(n) || 0);

/**
 * Build the full suggestion. Pure — no DB, no writes.
 * @param invoice { invoice_number, vendor_name, vendor_npwp, invoice_date, due_date,
 *                  description, gross_amount, currency, document_id }
 * @param opts    { treatment_key } to override detection (user correction)
 */
function buildTaxSplit(invoice = {}, opts = {}) {
  const gross = Number(invoice.gross_amount || 0);
  const currency = String(invoice.currency || 'IDR').trim().toUpperCase() || 'IDR';
  // V1 auto-calculates for IDR only. Withholding is remitted to DJP in rupiah, so a
  // foreign-currency invoice needs an FX rate and a confirmed tax base before any
  // amount can be asserted. CFO AI holds neither, so it refuses to compute rather
  // than guessing a conversion — see canCompute below.
  const isIdr = currency === 'IDR';
  const detected = detectTreatment(invoice);
  const key = opts.treatment_key && TREATMENTS[opts.treatment_key] ? opts.treatment_key : detected.treatment_key;
  const t = TREATMENTS[key];
  const overridden = !!(opts.treatment_key && opts.treatment_key !== detected.treatment_key);

  const missing = [];
  if (!gross || gross <= 0) missing.push('gross amount');
  if (!invoice.vendor_name) missing.push('vendor name');
  if (!invoice.invoice_date) missing.push('invoice date');
  if (!invoice.description) missing.push('description');

  const canCompute = t.auto_calculate && gross > 0 && isIdr;
  let withholding = null;
  let vendorPayment = null;
  let reconciliation = null;

  if (canCompute) {
    withholding = round(gross * t.rate);
    // Reuse the existing tested reconciler rather than re-deriving the arithmetic.
    reconciliation = reconcileInvoice({
      subtotal_amount: gross, commercial_tax_amount: 0, gross_amount: gross,
      withholding_base: gross, withholding_rate: t.rate, withholding_amount: withholding,
    });
    vendorPayment = reconciliation.expected_vendor_net_amount;
  }

  // Lead with the currency reason: it is why an otherwise-computable invoice did not compute.
  const reviewReasons = (t.auto_calculate && !isIdr)
    ? [`Non-IDR invoice (${currency}) requires FX and tax-base confirmation before any withholding is suggested.`,
       'CFO AI does not convert currency and holds no official exchange rate, so it will not create a DJP tax payable from a non-IDR amount in V1.',
       ...t.review_reasons]
    : t.review_reasons;

  const status = !gross ? 'missing_data'
    : canCompute ? 'suggested'
    : 'needs_accountant_review';

  return {
    version: 'tax-split-v1',
    disclaimer: DISCLAIMER,

    invoice: {
      invoice_number: invoice.invoice_number || null,
      vendor_name: invoice.vendor_name || null,
      vendor_npwp: invoice.vendor_npwp || null,
      invoice_date: invoice.invoice_date || null,
      due_date: invoice.due_date || null,
      description: invoice.description || null,
      gross_amount: gross || null,
      currency,
      document_id: invoice.document_id || null,
    },

    detected_payment_type: t.key,
    detected_label: t.label,
    detection: { ...detected, overridden_by_user: overridden },
    confidence_score: overridden ? 'Needs accountant review' : detected.confidence,

    tax_type: t.tax_type,
    tax_rate: canCompute ? t.rate : null,
    tax_base: t.base,
    tax_base_label: t.base_label,
    tax_base_note: t.base_note,
    final_or_creditable: t.final_or_creditable,

    gross_amount: gross || null,
    tax_payment_amount: withholding,
    vendor_payment_amount: vendorPayment,
    reconciliation,

    auto_calculated: canCompute,
    currency_supported: isIdr,
    status,
    accountant_review_required: true,
    accountant_review_status: 'ai_suggested',
    legal_verified: false,
    active: false,

    official_rule_reference: t.official_rule_reference,
    source_ids: t.source_ids,
    kb_candidate_id: t.kb_candidate_id,
    kb_status: t.kb_status,

    required_documents: t.required_documents,
    review_reasons: reviewReasons,
    missing_data: missing,
    asset_hook: !!t.asset_hook,

    payment_instruction: canCompute
      ? {
          pay_vendor: vendorPayment,
          pay_tax_to_djp: withholding,
          currency,
          warning: 'Do not pay the full gross amount to the vendor. Pay the net amount, and remit the withheld tax to DJP.',
        }
      : {
          pay_vendor: null, pay_tax_to_djp: null, currency,
          warning: (t.auto_calculate && !isIdr)
            ? `No tax split is suggested: this invoice is in ${currency}, and a non-IDR amount requires FX and tax-base confirmation by your accountant.`
            : 'No tax split is suggested. Confirm the treatment with your accountant before paying.',
        },

    // Steps are guidance, not automation. CFO AI never pays anything.
    tax_payment_guide: canCompute ? [
      'Create or check the kode billing in Coretax DJP.',
      'Pay using bank, mobile banking, ATM or another approved channel.',
      'Save the payment proof carrying the NTPN / BPN.',
      'Upload that proof back into CFO AI.',
      'Prepare the bukti potong through e-Bupot in Coretax, using the same tax base and rate your accountant confirms.',
      'Send the package to accountant review.',
      'Include it in the monthly tax package.',
    ] : [],

    next_actions: [
      { key: 'create_vendor_payable', label: 'Create vendor payable', enabled: canCompute },
      { key: 'create_tax_payable', label: 'Create tax payable', enabled: canCompute },
      { key: 'add_tax_deadline', label: 'Add tax deadline', enabled: canCompute },
      { key: 'upload_tax_payment_proof', label: 'Upload tax payment proof', enabled: false,
        note: 'Available after the tax payable exists' },
      { key: 'prepare_bukti_potong', label: 'Prepare bukti potong', enabled: false,
        note: 'Prepared in Coretax e-Bupot; CFO AI records it, it does not file it' },
      { key: 'request_accountant_review', label: 'Request accountant review', enabled: gross > 0 },
    ],
  };
}

/** Status tracker vocabulary. UI-ready in V1; most steps are recorded, not automated. */
const TRACKER_STATES = [
  'tax_suggested', 'waiting_for_accountant_review', 'billing_code_needed', 'billing_code_created',
  'tax_payment_due', 'tax_paid', 'proof_uploaded', 'bukti_potong_prepared', 'reported', 'closed',
];

/** Accountant review flow, stored in tax_treatments.treatment_status (free TEXT, no CHECK). */
const REVIEW_STATES = [
  'ai_suggested', 'owner_confirmed', 'sent_to_accountant_review',
  'accountant_approved', 'accountant_edited', 'rejected_needs_more_info',
];

module.exports = {
  DISCLAIMER, TREATMENTS, TRACKER_STATES, REVIEW_STATES,
  detectTreatment, buildTaxSplit,
};
