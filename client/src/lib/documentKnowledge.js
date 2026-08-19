// AI Accountant — Document Knowledge Base (Phase 1).
//
// A flat "you are missing 3 documents" list gives no way to judge whether a document is a
// company-foundation document or a payroll formality, and no way to answer "what is this
// actually called, and where do I get it?". This module supplies both: per-document knowledge,
// and the grouping/priority the checklist and the Workbench render.
//
// Scope and honesty:
//   * Static local config. No backend, no migration, no network call, no AI.
//   * Descriptive only — it explains what a document IS and where it is issued. It never
//     asserts that a document you uploaded is officially valid, and it is not legal or tax
//     advice. Whether a document is REQUIRED still comes from the backend checklist
//     (/api/ai-accountant/required-documents), never from this file.
//   * Indonesia-focused, matching the checklist's own jurisdiction handling.

export const TRUNCATED_NOTICE =
  'Checklist incomplete — too many documents to verify automatically. Review the full document list.';

export const DISCLAIMER =
  'Preliminary guidance only. This explains what each document is and where it is normally ' +
  'issued — it does not verify that your document is officially valid and it is not legal or ' +
  'tax advice. Confirm with a licensed professional.';

// Groups, in the order they should be rendered.
export const GROUPS = [
  { key: 'identity', label: 'Core company identity',
    blurb: 'The documents that establish the company itself. Almost every filing, bank or partner request starts here.' },
  { key: 'tax_registration', label: 'Tax registration',
    blurb: 'Confirms how the company is registered with the tax office. What applies depends on your PKP status.' },
  { key: 'payroll', label: 'Payroll compliance',
    blurb: 'Applies only once the company has employees. These are payroll formalities, not company foundation documents.' },
  { key: 'operational', label: 'Operational & supporting',
    blurb: 'Useful evidence for bookkeeping, reconciliation and audits. Helpful rather than foundational.' },
];
export const GROUP_ORDER = GROUPS.map(g => g.key);
const GROUP_LABEL = Object.fromEntries(GROUPS.map(g => [g.key, g.label]));

// ── the knowledge base ──────────────────────────────────────────────────────
export const DOCUMENT_KNOWLEDGE = {
  npwp: {
    doc_type: 'npwp',
    issuing_body: 'Direktorat Jenderal Pajak (DJP)',
    display_label: 'NPWP',
    official_indonesian_name: 'Nomor Pokok Wajib Pajak (NPWP)',
    aliases: ['NPWP badan', 'Kartu NPWP', 'tax ID'],
    plain_language_description: 'The company’s tax identification number, issued by the Indonesian tax authority.',
    why_needed: 'It is the company’s tax identity — filings, invoices, withholding and most official forms reference it.',
    when_required: 'Every registered Indonesian taxpayer has one.',
    where_to_get: 'DJP — Coretax / the online DJP portal, or your KPP (tax office).',
    confirms_profile_fields: ['npwp'],
    group: 'identity',
  },
  nib: {
    doc_type: 'nib',
    issuing_body: 'Lembaga OSS (Online Single Submission)',
    display_label: 'NIB',
    official_indonesian_name: 'Nomor Induk Berusaha (NIB)',
    aliases: ['business registration number', 'OSS NIB'],
    plain_language_description: 'The single business identification number issued through the OSS system.',
    why_needed: 'It is the company’s official business identity and the base for licensing.',
    when_required: 'Required for Indonesian business entities.',
    where_to_get: 'OSS (Online Single Submission) — oss.go.id.',
    confirms_profile_fields: ['nib'],
    group: 'identity',
  },
  akta: {
    doc_type: 'akta',
    issuing_body: 'Notaris (notary)',
    display_label: 'Akta / Deed',
    official_indonesian_name: 'Akta Pendirian (dan Akta Perubahan, if any)',
    aliases: ['deed of establishment', 'akta notaris', 'articles of association'],
    plain_language_description: 'The notarial deed that establishes the company and records its articles.',
    why_needed: 'It records who owns the company, its capital and its purpose — banks, partners and auditors ask for it.',
    when_required: 'Expected for incorporated entities (PT, CV, Yayasan).',
    where_to_get: 'The notary who prepared it; they keep the original.',
    confirms_profile_fields: ['legal_entity_type'],
    group: 'identity',
  },
  sk_kemenkumham: {
    doc_type: 'sk_kemenkumham',
    issuing_body: 'Kementerian Hukum — Direktorat Jenderal AHU',
    display_label: 'SK Kemenkumham approval',
    official_indonesian_name: 'Keputusan Menteri Hukum tentang Pengesahan Pendirian Badan Hukum Perseroan Terbatas',
    aliases: ['SK Kemenkumham', 'SK pengesahan', 'AHU decision letter'],
    plain_language_description: 'The ministry decision letter approving the company as a legal entity.',
    why_needed: 'It confirms the PT was approved as a legal entity — the deed alone does not.',
    when_required: 'Accompanies the deed for incorporated Indonesian entities.',
    where_to_get: 'Your notary, or the AHU system (ahu.go.id).',
    confirms_profile_fields: ['legal_entity_type'],
    group: 'identity',
  },
  pkp_certificate: {
    doc_type: 'pkp_certificate',
    issuing_body: 'Direktorat Jenderal Pajak (DJP) / KPP',
    display_label: 'PKP certificate',
    official_indonesian_name: 'Surat Pengukuhan Pengusaha Kena Pajak (SPPKP)',
    aliases: ['SPPKP', 'PKP certificate', 'VAT registration'],
    plain_language_description: 'The letter confirming the company is registered as a VAT-taxable entrepreneur.',
    why_needed: 'It confirms VAT/PPN status — it decides whether you must issue faktur pajak and file PPN.',
    when_required: 'When the profile states the company is PKP-registered.',
    where_to_get: 'DJP / your KPP, or Coretax.',
    confirms_profile_fields: ['pkp_status', 'vat_status'],
    group: 'tax_registration',
  },
  kpp_registration: {
    doc_type: 'kpp_registration',
    issuing_body: 'Kantor Pelayanan Pajak (KPP)',
    display_label: 'KPP registration',
    official_indonesian_name: 'Surat Keterangan Terdaftar (SKT) — Kantor Pelayanan Pajak',
    aliases: ['SKT', 'KPP registration letter'],
    plain_language_description: 'The letter confirming which tax office the company is registered with.',
    why_needed: 'It identifies the KPP that handles your filings — useful when correspondence or filing questions arise.',
    when_required: 'Supporting document; not usually mandatory on its own.',
    where_to_get: 'Your KPP, or Coretax.',
    confirms_profile_fields: [],
    group: 'tax_registration',
  },
  oss_license: {
    doc_type: 'oss_license',
    issuing_body: 'Lembaga OSS',
    display_label: 'OSS / business licence',
    official_indonesian_name: 'Izin Usaha / Sertifikat Standar (via OSS)',
    aliases: ['izin usaha', 'business licence', 'sertifikat standar'],
    plain_language_description: 'The operating licence or standard certificate for your business activity.',
    why_needed: 'Some activities (and many foreign-owned companies) may not operate on the NIB alone.',
    when_required: 'When your KBLI activity requires a licence beyond the NIB.',
    where_to_get: 'OSS (oss.go.id).',
    confirms_profile_fields: [],
    group: 'tax_registration',
  },
  payroll_document: {
    doc_type: 'payroll_document',
    issuing_body: 'The company itself (payroll system / HR)',
    display_label: 'Payroll document',
    official_indonesian_name: 'Slip gaji / Daftar gaji',
    aliases: ['payslip', 'payroll register', 'daftar gaji'],
    plain_language_description: 'The payroll register or payslips showing salaries and withholding per employee.',
    why_needed: 'It supports PPh 21 withholding and the payroll figures in your books.',
    when_required: 'Once the profile states the company has employees.',
    where_to_get: 'Your own payroll system, HR/admin, or your payroll provider.',
    confirms_profile_fields: ['employee_status'],
    group: 'payroll',
  },
  bpjs_document: {
    doc_type: 'bpjs_document',
    issuing_body: 'BPJS Ketenagakerjaan / BPJS Kesehatan',
    display_label: 'BPJS document',
    official_indonesian_name: 'BPJS Ketenagakerjaan / BPJS Kesehatan — employer registration or payment proof',
    aliases: ['BPJS', 'Jamsostek', 'social security registration'],
    plain_language_description: 'Employer registration with, or payment proof to, the social-security agencies.',
    why_needed: 'Employee social-security compliance once you have staff.',
    when_required: 'Once an Indonesian employer has employees.',
    where_to_get: 'The BPJS employer portals, or your HR/admin records.',
    confirms_profile_fields: ['employee_status', 'bpjs_registered'],
    group: 'payroll',
  },
  bank_statement: {
    doc_type: 'bank_statement',
    issuing_body: 'The company’s bank',
    display_label: 'Bank statement',
    official_indonesian_name: 'Rekening koran / Mutasi rekening',
    aliases: ['bank statement', 'e-statement', 'mutasi'],
    plain_language_description: 'The bank’s record of money in and out of the company account.',
    why_needed: 'It is the evidence behind reconciliation and cash verification.',
    when_required: 'Recommended each period; not a registration document.',
    where_to_get: 'Your bank’s internet/mobile banking, or a branch.',
    confirms_profile_fields: [],
    group: 'operational',
  },
  tax_report: {
    doc_type: 'tax_report',
    issuing_body: 'Direktorat Jenderal Pajak (DJP) — filed by the taxpayer',
    display_label: 'Tax report',
    official_indonesian_name: 'Surat Pemberitahuan (SPT) — Tahunan / Masa',
    aliases: ['SPT', 'tax return', 'bukti lapor'],
    plain_language_description: 'A filed tax return and its filing receipt.',
    why_needed: 'Proof of what was filed and when.',
    when_required: 'Keep each filed return for your records.',
    where_to_get: 'DJP Online / Coretax, or whoever filed on your behalf.',
    confirms_profile_fields: [],
    group: 'operational',
  },
  tax_payment_proof: {
    doc_type: 'tax_payment_proof',
    issuing_body: 'Direktorat Jenderal Pajak (DJP) via the receiving bank',
    display_label: 'Tax payment proof',
    official_indonesian_name: 'Bukti Penerimaan Negara (BPN) / NTPN — Surat Setoran Pajak',
    aliases: ['NTPN', 'SSP', 'billing code receipt'],
    plain_language_description: 'The state receipt confirming a tax payment, identified by an NTPN.',
    why_needed: 'Proof that a tax liability was actually paid.',
    when_required: 'Keep for each tax payment.',
    where_to_get: 'The paying bank, or DJP Online / Coretax.',
    confirms_profile_fields: [],
    group: 'operational',
  },
  contract: {
    doc_type: 'contract',
    issuing_body: 'The contracting parties',
    display_label: 'Contract',
    official_indonesian_name: 'Perjanjian / Kontrak',
    aliases: ['agreement', 'MoU', 'SPK'],
    plain_language_description: 'An agreement with a customer, supplier or contractor.',
    why_needed: 'It supports the terms behind recorded revenue, costs and withholding.',
    when_required: 'As applicable to your arrangements.',
    where_to_get: 'Your own records or the counterparty.',
    confirms_profile_fields: [],
    group: 'operational',
  },
  invoice: {
    doc_type: 'invoice',
    issuing_body: 'The issuing party (e-Faktur for faktur pajak)',
    display_label: 'Invoice',
    official_indonesian_name: 'Faktur / Faktur Pajak / Tagihan',
    aliases: ['invoice', 'tagihan', 'faktur pajak'],
    plain_language_description: 'A bill issued to a customer or received from a supplier. A faktur pajak is the VAT-specific form.',
    why_needed: 'It is the source document behind receivables, payables and PPN.',
    when_required: 'As transactions occur.',
    where_to_get: 'Your invoicing system, the supplier, or e-Faktur for faktur pajak.',
    confirms_profile_fields: [],
    group: 'operational',
  },
  receipt: {
    doc_type: 'receipt',
    issuing_body: 'The merchant or counterparty',
    display_label: 'Receipt',
    official_indonesian_name: 'Kwitansi / Nota / Struk',
    aliases: ['receipt', 'kwitansi', 'struk'],
    plain_language_description: 'Proof that a payment was made or received.',
    why_needed: 'It substantiates expenses and payments in your books.',
    when_required: 'As transactions occur.',
    where_to_get: 'The merchant or counterparty.',
    confirms_profile_fields: [],
    group: 'operational',
  },
};

// ── entity-specific legal-entity document ───────────────────────────────────
// `sk_kemenkumham` is ONE stored doc_type, but the document it names differs by entity: a PT
// receives a ministerial approval decision, a CV is registered in AHU rather than approved as
// a badan hukum, and other forms follow their own route. Showing PT wording ("Perseroan
// Terbatas") to a CV or Yayasan would be wrong, so the presentation varies while the taxonomy
// does not. Where the exact official title is not certain for an entity form, the wording is
// deliberately NEUTRAL rather than guessed — see the disclaimer.
export const LEGAL_ENTITY_DOC_VARIANTS = {
  pt: {
    display_label: 'SK Kemenkumham approval',
    official_indonesian_name: 'Keputusan Menteri Hukum tentang Pengesahan Pendirian Badan Hukum Perseroan Terbatas',
    aliases: ['SK Kemenkumham', 'SK pengesahan', 'AHU decision letter'],
    plain_language_description: 'The ministry decision letter approving the PT as a legal entity.',
    why_needed: 'It confirms the PT was approved as a legal entity — the deed alone does not.',
    when_required: 'Issued with the deed for a PT / PT PMA.',
  },
  cv: {
    display_label: 'AHU CV registration proof',
    official_indonesian_name: 'Surat Keterangan Terdaftar Persekutuan Komanditer (CV)',
    aliases: ['SKT CV', 'AHU CV registration', 'pendaftaran CV'],
    plain_language_description: 'Proof that the CV is registered in the AHU system.',
    why_needed: 'A CV is registered rather than approved as a badan hukum, so this is the registration evidence — not a PT approval decision.',
    when_required: 'For a CV registered in Indonesia.',
  },
  other: {
    display_label: 'AHU legal entity approval / registration',
    official_indonesian_name: 'AHU legal entity approval or registration document',
    aliases: ['AHU approval', 'AHU registration'],
    plain_language_description: 'The AHU approval or registration document for this entity form.',
    why_needed: 'It evidences that the entity is recognised by the ministry. The exact document depends on the entity form.',
    when_required: 'For registered Indonesian legal entities other than a PT or CV — confirm the exact document with your notary.',
  },
};

// 'pt' | 'cv' | 'other'. Mirrors the backend rule in server/lib/documentIntake.js.
export function entityFormOf(profile = {}) {
  const e = String(profile?.legal_entity_type || '').toLowerCase();
  if (/\bpt\b/.test(e)) return 'pt';
  if (/\bcv\b/.test(e)) return 'cv';
  return 'other';
}

/**
 * Knowledge for a document type. Pass the profile so the legal-entity document is described
 * in terms of the entity the user actually has.
 */
export const knowledgeFor = (docType, profile) => {
  const base = DOCUMENT_KNOWLEDGE[docType] || null;
  if (!base) return null;
  if (docType !== 'sk_kemenkumham' || profile === undefined) return base;
  return { ...base, ...LEGAL_ENTITY_DOC_VARIANTS[entityFormOf(profile)] };
};
export const groupOf = (docType) => DOCUMENT_KNOWLEDGE[docType]?.group || 'operational';

// ── priority ────────────────────────────────────────────────────────────────
// Derived from the BACKEND requirement plus the group — the group decides how a requirement
// reads, so payroll formalities never look like company foundation documents.
export const PRIORITY_LABEL = {
  core_required: 'Required — company identity',
  conditional_required: 'Required — tax registration',
  payroll_required: 'Required for payroll compliance',
  recommended: 'Recommended',
  optional: 'Optional',
  not_required: 'Not required',
  needs_review: 'Needs review',
};

export function priorityOf(item) {
  if (!item) return 'optional';
  const group = groupOf(item.type);
  if (item.requirement === 'not_required') return 'not_required';
  const required = item.requirement === 'required' || item.requirement === 'conditional_required';
  if (required) {
    if (group === 'payroll') return 'payroll_required';
    if (group === 'identity') return 'core_required';
    return 'conditional_required';
  }
  return group === 'operational' ? 'recommended' : 'optional';
}

// Which priorities belong to the "minimum company pack" — the short list an owner should
// actually work through first. Payroll is deliberately NOT part of it.
const PACK_PRIORITIES = new Set(['core_required', 'conditional_required']);
const URGENT_PRIORITIES = new Set(['core_required', 'conditional_required', 'payroll_required']);

export const isMinimumPack = (item) => PACK_PRIORITIES.has(priorityOf(item));
export const isUrgent = (item) => URGENT_PRIORITIES.has(priorityOf(item));

/**
 * Summary badges for the checklist header.
 *
 * `uploaded`, `needs_review`, `optional` and `not_required` are OBSERVATIONS of rows we were
 * given, so they survive truncation. `missing` is an INFERENCE about documents we may simply
 * not have fetched — on a truncated set it becomes `null` and renders as "missing unknown",
 * never as a confident "0 missing".
 *
 * @returns {Array<{key,count:number|null,label,tone}>}
 */
export function summaryBadges(checklist) {
  const counts = checklist?.counts || {};
  const truncated = !!checklist?.truncated;
  const badge = (key, label, tone) => ({ key, count: counts[key] ?? 0, label: `${counts[key] ?? 0} ${label}`, tone });
  return [
    badge('uploaded', 'uploaded', 'success'),
    badge('needs_review', 'need review', 'warning'),
    truncated
      ? { key: 'missing', count: null, label: 'missing unknown', tone: 'neutral' }
      : badge('missing', 'missing', 'danger'),
    badge('optional', 'optional', 'neutral'),
    badge('not_required', 'not required', 'neutral'),
  ];
}

/**
 * Group a checklist payload for display.
 *
 * @param {object|null} checklist the /required-documents payload
 * @returns {{available, groups:Array, pack:{items,total,satisfied,outstanding,complete},
 *            payroll:{items,total,satisfied,outstanding,applies}, disclaimer}}
 */
export function groupChecklist(checklist, profile) {
  const base = { available: false, truncated: false, disclaimer: checklist?.disclaimer || DISCLAIMER,
    summary: [], groups: [],
    pack: { items: [], total: null, satisfied: null, outstanding: [], complete: false, countable: false },
    payroll: { items: [], total: null, satisfied: null, outstanding: [], applies: false, countable: false } };
  if (!checklist || !Array.isArray(checklist.items)) return base;

  // A truncated document set cannot prove a document is ABSENT — a matching document may sit
  // outside the fetched page. Uploaded statuses that we DID see stay visible, but no count and
  // no "still needed" list is produced, because both would assert absence.
  const countable = !checklist.truncated;

  const decorate = (i) => {
    const k = knowledgeFor(i.type, profile);
    const priority = priorityOf(i);
    return {
      ...i,
      group: groupOf(i.type),
      group_label: GROUP_LABEL[groupOf(i.type)],
      priority,
      priority_label: i.status === 'needs_review' ? PRIORITY_LABEL.needs_review : PRIORITY_LABEL[priority],
      knowledge: k,
      satisfied: i.status === 'uploaded',
    };
  };
  const items = checklist.items.map(decorate);

  const groups = GROUPS.map(g => {
    const rows = items.filter(i => i.group === g.key);
    return {
      ...g,
      items: rows,
      counts: {
        total: rows.length,
        satisfied: rows.filter(i => i.satisfied).length,
        // "missing" asserts absence, so it is only counted on a complete set.
        missing: countable ? rows.filter(i => i.status === 'missing' && isUrgent(i)).length : null,
        needs_review: rows.filter(i => i.status === 'needs_review').length,
      },
    };
  }).filter(g => g.items.length);

  const packItems = items.filter(isMinimumPack);
  const payrollItems = items.filter(i => priorityOf(i) === 'payroll_required');
  const outstanding = (rows) => rows.filter(i => !i.satisfied);

  return {
    available: true,
    truncated: !!checklist.truncated,
    summary: summaryBadges(checklist),
    groups,
    pack: {
      items: packItems,
      countable,
      total: countable ? packItems.length : null,
      satisfied: countable ? packItems.filter(i => i.satisfied).length : null,
      outstanding: countable ? outstanding(packItems) : [],
      complete: countable && packItems.length > 0 && packItems.every(i => i.satisfied),
    },
    payroll: {
      items: payrollItems,
      countable,
      applies: payrollItems.length > 0,
      total: countable ? payrollItems.length : null,
      satisfied: countable ? payrollItems.filter(i => i.satisfied).length : null,
      outstanding: countable ? outstanding(payrollItems) : [],
    },
    disclaimer: checklist.disclaimer || DISCLAIMER,
  };
}

export default DOCUMENT_KNOWLEDGE;
