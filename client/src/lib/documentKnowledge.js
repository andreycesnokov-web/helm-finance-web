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

export const knowledgeFor = (docType) => DOCUMENT_KNOWLEDGE[docType] || null;
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
 * Group a checklist payload for display.
 *
 * @param {object|null} checklist the /required-documents payload
 * @returns {{available, groups:Array, pack:{items,total,satisfied,outstanding,complete},
 *            payroll:{items,total,satisfied,outstanding,applies}, disclaimer}}
 */
export function groupChecklist(checklist) {
  const base = { available: false, groups: [], disclaimer: checklist?.disclaimer || DISCLAIMER,
    pack: { items: [], total: 0, satisfied: 0, outstanding: [], complete: false },
    payroll: { items: [], total: 0, satisfied: 0, outstanding: [], applies: false } };
  if (!checklist || !Array.isArray(checklist.items)) return base;

  const decorate = (i) => {
    const k = knowledgeFor(i.type);
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
        missing: rows.filter(i => i.status === 'missing' && isUrgent(i)).length,
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
    groups,
    pack: {
      items: packItems,
      total: packItems.length,
      satisfied: packItems.filter(i => i.satisfied).length,
      outstanding: outstanding(packItems),
      complete: packItems.length > 0 && packItems.every(i => i.satisfied),
    },
    payroll: {
      items: payrollItems,
      total: payrollItems.length,
      satisfied: payrollItems.filter(i => i.satisfied).length,
      outstanding: outstanding(payrollItems),
      applies: payrollItems.length > 0,
    },
    disclaimer: checklist.disclaimer || DISCLAIMER,
  };
}

export default DOCUMENT_KNOWLEDGE;
