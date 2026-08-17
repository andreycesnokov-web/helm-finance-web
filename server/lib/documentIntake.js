// AI Accountant document intake — Phase 1 (deterministic, no OCR, no AI provider).
//
// Scope and honesty rules:
//   * This is a PRELIMINARY product taxonomy, not a statement of legal completeness.
//     Nothing here verifies that a document is officially valid.
//   * Classification uses ONLY the file name and MIME type. No text extraction, no AI call,
//     no new provider, no new env var.
//   * "auto_classified" is reserved for a STRONG match. Anything weaker is needs_review, so a
//     guess can never quietly satisfy a compliance requirement.
//
// Storage note: migration 031 constrains financial_documents.document_type to a fixed CHECK
// list that does not include NPWP/NIB/Akta/etc. Rather than alter that constraint (a
// migration), the intake taxonomy lives in the existing free-form extracted_json.ai_intake,
// and document_type keeps a CHECK-valid value. See INTAKE_TYPES[].maps_to.

// ── Taxonomy ────────────────────────────────────────────────────────────────
// area  = where a confirmed document routes to
// maps_to = the CHECK-valid financial_documents.document_type to keep on the row
const INTAKE_TYPES = [
  { type: 'npwp',              label: 'NPWP',                      area: 'company_identity', maps_to: 'other' },
  { type: 'nib',               label: 'NIB',                       area: 'company_identity', maps_to: 'other' },
  { type: 'akta',              label: 'Akta / Deed',               area: 'company_identity', maps_to: 'other' },
  { type: 'sk_kemenkumham',    label: 'SK Kemenkumham approval',   area: 'company_identity', maps_to: 'other' },
  { type: 'oss_license',       label: 'OSS / business licence',    area: 'compliance',       maps_to: 'other' },
  { type: 'pkp_certificate',   label: 'PKP certificate',           area: 'compliance',       maps_to: 'other' },
  { type: 'kpp_registration',  label: 'KPP registration',          area: 'compliance',       maps_to: 'other' },
  { type: 'bank_statement',    label: 'Bank statement',            area: 'finance',          maps_to: 'bank_document' },
  { type: 'invoice',           label: 'Invoice',                   area: 'finance',          maps_to: 'vendor_invoice' },
  { type: 'receipt',           label: 'Receipt',                   area: 'finance',          maps_to: 'payment_proof' },
  { type: 'payroll_document',  label: 'Payroll document',          area: 'payroll',          maps_to: 'other' },
  { type: 'bpjs_document',     label: 'BPJS document',             area: 'payroll',          maps_to: 'other' },
  { type: 'tax_report',        label: 'Tax report',                area: 'compliance',       maps_to: 'filing_confirmation' },
  { type: 'tax_payment_proof', label: 'Tax payment proof',         area: 'compliance',       maps_to: 'tax_billing' },
  { type: 'contract',          label: 'Contract',                  area: 'finance',          maps_to: 'other' },
  { type: 'unknown',           label: 'Other / unknown',           area: 'needs_review',     maps_to: 'other' },
];
const TYPE_BY_KEY = Object.fromEntries(INTAKE_TYPES.map(t => [t.type, t]));
const isIntakeType = (t) => Object.prototype.hasOwnProperty.call(TYPE_BY_KEY, t);
const labelFor = (t) => TYPE_BY_KEY[t]?.label || 'Other / unknown';
const areaFor = (t) => TYPE_BY_KEY[t]?.area || 'needs_review';
const mapsTo = (t) => TYPE_BY_KEY[t]?.maps_to || 'other';

// ── Classification ──────────────────────────────────────────────────────────
// STRONG  → an unambiguous identifier appears in the name ⇒ auto_classified.
// WEAK    → the name merely suggests a category ⇒ needs_review.
const STRONG = [
  ['npwp',              [/\bnpwp\b/]],
  ['nib',               [/\bnib\b/, /nomor[\s_-]*induk[\s_-]*berusaha/]],
  ['sk_kemenkumham',    [/kemenkumham/, /\bsk[\s_-]*kemenkum/, /ahu[\s_-]*ah/]],
  ['akta',              [/\bakta\b/, /\bakte\b/, /notaris/, /deed[\s_-]*of[\s_-]*establishment/]],
  ['pkp_certificate',   [/\bpkp\b/, /pengukuhan[\s_-]*pkp/, /sppkp/]],
  ['oss_license',       [/\boss\b/, /izin[\s_-]*usaha/, /business[\s_-]*licen[cs]e/]],
  ['kpp_registration',  [/\bkpp\b/, /surat[\s_-]*keterangan[\s_-]*terdaftar/, /\bsket\b/]],
  ['bpjs_document',     [/\bbpjs\b/, /jamsostek/, /kesehatan[\s_-]*ketenagakerjaan/]],
  ['tax_payment_proof', [/\bntpn\b/, /bukti[\s_-]*(bayar|setor)/, /billing[\s_-]*code/, /\bssp\b/]],
  ['tax_report',        [/\bspt\b/, /e[\s_-]*filing/, /bukti[\s_-]*lapor/, /tax[\s_-]*return/]],
  ['payroll_document',  [/payroll/, /\bslip[\s_-]*gaji\b/, /\bpayslip\b/, /daftar[\s_-]*gaji/]],
  ['bank_statement',    [/rekening[\s_-]*koran/, /bank[\s_-]*statement/, /e[\s_-]*statement/]],
];
const WEAK = [
  ['invoice',          [/invoice/, /\binv\b/, /faktur/, /tagihan/]],
  ['receipt',          [/receipt/, /kwitansi/, /\bnota\b/, /struk/]],
  ['contract',         [/contract/, /agreement/, /perjanjian/, /\bmou\b/, /\bspk\b/]],
  ['bank_statement',   [/\bstatement\b/, /mutasi/]],
  ['payroll_document', [/\bgaji\b/, /salary/, /\bthr\b/]],
  ['tax_report',       [/\bpajak\b/, /\btax\b/],
  ],
];

/**
 * Classify a file from its NAME and MIME type only.
 * Returns { doc_type, confidence: high|medium|low|unknown, classification_status, matched_on }.
 * classification_status is 'auto_classified' ONLY for a strong match.
 */
function classify({ file_name = '', mime_type = '' } = {}) {
  // Normalise separators to spaces before matching. Underscores and dots are word characters
  // in JS regex, so "NIB_123.pdf" would defeat a \bnib\b test — and separator-heavy names are
  // the norm for scanned documents.
  const name = ' ' + String(file_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const mime = String(mime_type || '').toLowerCase();

  for (const [type, patterns] of STRONG) {
    const hit = patterns.find(re => re.test(name));
    if (hit) return { doc_type: type, confidence: 'high', classification_status: 'auto_classified', matched_on: 'file_name' };
  }
  for (const [type, patterns] of WEAK) {
    const hit = patterns.find(re => re.test(name));
    if (hit) return { doc_type: type, confidence: 'medium', classification_status: 'needs_review', matched_on: 'file_name' };
  }
  // MIME alone is the weakest possible signal: a spreadsheet is *often* a statement/ledger,
  // but never assume. Low confidence always requires a human.
  if (/spreadsheet|excel|csv/.test(mime)) {
    return { doc_type: 'bank_statement', confidence: 'low', classification_status: 'needs_review', matched_on: 'mime_type' };
  }
  return { doc_type: 'unknown', confidence: 'unknown', classification_status: 'needs_review', matched_on: 'none' };
}

// ── Required documents (PRELIMINARY, profile-driven) ────────────────────────
// requirement: 'required' | 'conditional_required' | 'optional' | 'not_required'
// Every entry carries a plain-language reason so nothing looks like an oracle.
function requirementsFor(profile = {}) {
  const p = profile || {};
  const entity = String(p.legal_entity_type || '').toLowerCase();
  const isCompany = /pt|cv|yayasan|firma/.test(entity);
  const pkp = String(p.pkp_status || '').toLowerCase();
  const hasEmployees = String(p.employee_status || '') === 'has_employees';
  const foreign = String(p.foreign_owned || '') === 'yes';
  const known = (v) => v !== undefined && v !== null && v !== '';

  const out = [];
  const add = (type, requirement, reason) => out.push({ type, label: labelFor(type), area: areaFor(type), requirement, reason });

  add('npwp', 'required', 'Every registered taxpayer has an NPWP.');
  add('nib', 'required', 'Business identification number for Indonesian entities.');

  if (isCompany) add('akta', 'required', `Deed of establishment is expected for ${p.legal_entity_type}.`);
  else if (!known(p.legal_entity_type)) add('akta', 'optional', 'Set legal entity type to know whether a deed applies.');
  else add('akta', 'optional', 'Not typically required for this entity type.');

  if (isCompany) add('sk_kemenkumham', 'required', 'Ministry approval accompanies the deed for incorporated entities.');
  else add('sk_kemenkumham', 'optional', 'Applies to incorporated entities.');

  add('oss_license', 'optional', 'Recommended when your activity requires a licence.');

  if (pkp === 'pkp_registered') add('pkp_certificate', 'required', 'Profile states the company is PKP-registered.');
  else if (pkp === 'non_pkp') add('pkp_certificate', 'not_required', 'Profile states the company is not PKP.');
  else add('pkp_certificate', 'optional', 'Set PKP status to know whether this is required.');

  add('kpp_registration', 'optional', 'Useful for confirming the registered tax office.');

  if (hasEmployees) {
    add('payroll_document', 'conditional_required', 'Profile states the company has employees.');
    add('bpjs_document', 'conditional_required', 'BPJS applies once you have employees.');
  } else {
    add('payroll_document', 'not_required', 'Profile states there are no employees.');
    add('bpjs_document', 'not_required', 'Profile states there are no employees.');
  }

  if (foreign) add('oss_license', 'conditional_required', 'Foreign-owned companies usually hold additional licences.');

  add('tax_report', 'optional', 'Keep filed returns for your records.');
  add('tax_payment_proof', 'optional', 'Keep payment proofs for your records.');
  add('bank_statement', 'optional', 'Helps reconciliation and cash verification.');

  // De-duplicate by type, keeping the strictest requirement seen.
  const rank = { required: 3, conditional_required: 2, optional: 1, not_required: 0 };
  const byType = new Map();
  for (const item of out) {
    const prev = byType.get(item.type);
    if (!prev || rank[item.requirement] > rank[prev.requirement]) byType.set(item.type, item);
  }
  return [...byType.values()];
}

// ── Checklist ───────────────────────────────────────────────────────────────
// status: 'uploaded' | 'needs_review' | 'missing' | 'not_required' | 'optional'
//
// 'uploaded' is granted ONLY by a manually confirmed document, or an auto-classified one
// with HIGH confidence. A medium/low-confidence match shows needs_review — an uncertain
// guess must never mark a requirement satisfied.
function buildChecklist(profile = {}, docs = []) {
  const reqs = requirementsFor(profile);
  const byType = new Map();
  for (const d of docs || []) {
    const t = d?.intake?.doc_type;
    if (!t) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(d);
  }
  const counts = { uploaded: 0, needs_review: 0, missing: 0, not_required: 0, optional: 0 };
  const items = reqs.map(r => {
    const matches = byType.get(r.type) || [];
    const confirmed = matches.filter(d => d.intake.classification_status === 'manually_confirmed');
    const strongAuto = matches.filter(d => d.intake.classification_status === 'auto_classified' && d.intake.confidence === 'high');
    const weak = matches.filter(d => !confirmed.includes(d) && !strongAuto.includes(d));

    let status;
    if (confirmed.length || strongAuto.length) status = 'uploaded';
    else if (weak.length) status = 'needs_review';
    else if (r.requirement === 'not_required') status = 'not_required';
    else if (r.requirement === 'optional') status = 'optional';
    else status = 'missing';

    counts[status] += 1;
    return {
      ...r,
      status,
      documents: matches.map(d => ({
        id: d.id, file_name: d.file_name, confidence: d.intake.confidence,
        classification_status: d.intake.classification_status,
      })),
      match_count: matches.length,
    };
  });
  return {
    label: 'AI Accountant preliminary checklist',
    disclaimer: 'Preliminary only. This checklist reflects the profile you entered and file names — it does not verify that a document is officially valid or that your filing obligations are complete. Confirm with a licensed professional.',
    counts,
    items,
  };
}

// ── extracted_json.ai_intake helpers ───────────────────────────────────────
// Reads persisted intake metadata; falls back to deriving it from the file name so
// documents uploaded before this feature still appear correctly. Derivation is pure —
// GET endpoints never write.
function readIntake(doc = {}, file = {}) {
  const stored = doc?.extracted_json?.ai_intake;
  if (stored && isIntakeType(stored.doc_type)) {
    return {
      doc_type: stored.doc_type,
      label: labelFor(stored.doc_type),
      area: areaFor(stored.doc_type),
      confidence: stored.confidence || 'unknown',
      classification_status: stored.classification_status || 'needs_review',
      matched_on: stored.matched_on || 'stored',
      confirmed_at: stored.confirmed_at || null,
      persisted: true,
    };
  }
  const derived = classify({ file_name: file.file_name || doc.file_name, mime_type: file.mime_type || doc.mime_type });
  return { ...derived, label: labelFor(derived.doc_type), area: areaFor(derived.doc_type), confirmed_at: null, persisted: false };
}

// Builds the extracted_json patch for a manual confirmation. Never drops sibling keys.
function intakePatch(existingExtracted, { doc_type, actorUserId }) {
  return {
    ...(existingExtracted || {}),
    ai_intake: {
      doc_type,
      confidence: 'high',
      classification_status: 'manually_confirmed',
      matched_on: 'manual',
      confirmed_by_user_id: actorUserId ?? null,
      confirmed_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  INTAKE_TYPES, isIntakeType, labelFor, areaFor, mapsTo,
  classify, requirementsFor, buildChecklist, readIntake, intakePatch,
};
