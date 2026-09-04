// Document Extraction V1 — structured fields from a document's EMBEDDED text.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
// A label-driven parser for Indonesian invoices, Faktur Pajak and bank transfer
// receipts. Pure: it takes text and returns a suggestion. No DB, no network, no
// file access.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//   * NOT OCR. It reads text a PDF already carries (server/lib/pdfText.js). A
//     scanned page carries none, and the honest result is needs_manual_review —
//     never a guess, never a blank field presented as a finding.
//   * NOT a writer. Every result is a SUGGESTION for a human to confirm. Saving
//     happens only through PATCH /api/documents/:id/financial-fields.
//   * NOT a validator. "This looks like a Faktur Pajak" is a reading of the text,
//     never a statement that the document is officially valid.
//
// The rule throughout: a field we cannot read stays null and is listed in
// missing_fields. Inventing a plausible number here would corrupt a ledger.
'use strict';

const { parseAmount } = require('./invoiceSettlement');

const TYPES = [
  'invoice', 'faktur_pajak', 'payment_proof', 'receipt', 'contract',
  'bank_statement', 'tax_document', 'payroll_document', 'bank_fee',
  'asset_purchase', 'funding_document', 'unknown',
];

/* ── type detection ────────────────────────────────────────────────────────
   Anchors are phrases that are close to unique for a document kind. Generic
   vocabulary ("Total", "Bank") is deliberately absent: it appears on all three. */
const ANCHORS = {
  faktur_pajak: [
    /faktur\s+pajak/i, /kode\s+dan\s+nomor\s+seri/i,
    /pengusaha\s+kena\s+pajak/i, /pembeli\s+barang\s+kena\s+pajak/i,
    /dasar\s+pengenaan\s+pajak/i,
  ],
  payment_proof: [
    /bukti\s+transfer/i, /transfer\s+receipt/i, /\breference\s*(no|number)\b/i,
    /\bno\.?\s*referensi\b/i, /transfer\s+ke\s+rekening/i, /other\s+bca\s+account/i,
    /\bsuccessful\b/i, /\bberhasil\b/i, /rekening\s+tujuan/i,
  ],
  invoice: [
    /\binvoice\b/i, /\btagihan\b/i, /\bno\.?\s*invoice\b/i,
    /\bbill\s+to\b/i, /\bkepada\s+yth\b/i, /\bnetto\b/i, /harga\s+jual/i,
  ],
  // A receipt records money already handed over; an invoice asks for it. Kwitansi is
  // the Indonesian form and is a strong signal on its own.
  receipt: [/\bkwitansi\b/i, /\breceipt\b/i, /\bnota\b/i, /\btelah\s+terima\s+dari\b/i,
    /\bsudah\s+dibayar\b/i, /\bpaid\s+in\s+full\b/i],
  contract: [/\bperjanjian\b/i, /\bkontrak\b/i, /\bcontract\b/i, /\bagreement\b/i,
    /\bsyarat\s+dan\s+ketentuan\b/i, /terms\s+and\s+conditions/i, /\bpara\s+pihak\b/i,
    /\bpasal\s+\d/i, /\bmemorandum\s+of\s+understanding\b/i],
  bank_statement: [/rekening\s+koran/i, /bank\s+statement/i, /account\s+statement/i,
    /mutasi\s+rekening/i, /saldo\s+akhir/i, /opening\s+balance[\s\S]{0,40}closing\s+balance/i],
  tax_document: [/\bspt\b/i, /surat\s+setoran\s+pajak/i, /\bssp\b/i, /\bbukti\s+potong\b/i,
    /\be-?bupot\b/i, /\bntpn\b/i, /kode\s+billing/i, /\bdjp\s+online\b/i, /surat\s+ketetapan\s+pajak/i],
  payroll_document: [/\bslip\s+gaji\b/i, /\bpayslip\b/i, /\bpayroll\b/i, /\bdaftar\s+gaji\b/i,
    /\bthr\b/i, /\btunjangan\b/i, /\bbpjs\s+ketenagakerjaan\b/i],
  bank_fee: [/biaya\s+admin/i, /admin\s+fee/i, /\bbank\s+charge/i, /biaya\s+transfer/i,
    /monthly\s+maintenance\s+fee/i],
  asset_purchase: [/\bfaktur\s+pembelian\s+(mesin|peralatan)\b/i, /purchase\s+order/i,
    /\bdelivery\s+order\b/i, /\bsurat\s+jalan\b/i, /\basset\s+purchase\b/i],
  funding_document: [/perjanjian\s+(kredit|pinjaman)/i, /loan\s+agreement/i,
    /\bfacility\s+agreement\b/i, /\bpromissory\s+note\b/i, /setoran\s+modal/i,
    /capital\s+injection/i, /\bshareholder\s+loan\b/i],
};

function detectType(text = '', hints = {}) {
  const t = String(text || '');
  const score = {};
  for (const [type, list] of Object.entries(ANCHORS)) {
    score[type] = list.filter((re) => re.test(t)).length;
  }
  // A Faktur Pajak is also an invoice; the more specific claim wins when its own
  // anchors are present, which is why it is checked before the generic invoice.
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = ranked[0];
  if (topScore === 0) {
    // Fall back to the uploader's declared type rather than claiming nothing.
    const declared = hints.document_type;
    if (declared === 'payment_proof') return { type: 'payment_proof', anchors: 0, from: 'declared_type' };
    if (declared === 'tax_invoice') return { type: 'faktur_pajak', anchors: 0, from: 'declared_type' };
    if (declared === 'vendor_invoice' || declared === 'customer_invoice') return { type: 'invoice', anchors: 0, from: 'declared_type' };
    return { type: 'unknown', anchors: 0, from: 'no_anchors' };
  }
  return { type: topType, anchors: topScore, from: 'content_anchors' };
}

/* ── helpers ───────────────────────────────────────────────────────────────
   Text out of a PDF has unreliable whitespace, so labels are matched loosely and
   the value is taken from the same line or the one after it. */
// A label and its value are often separated by filler — "Jumlah PPN (Pajak
// Pertambahan Nilai) 14.256.000". So rather than demanding the value sit adjacent,
// look inside a BOUNDED window after the label: at most the rest of this line and
// the next one. Bounded matters — an unbounded search would happily pair a label
// with a number from further down the page.
function windowAfter(text, labelRe, chars = 200) {
  const m = new RegExp(labelRe.source, 'i').exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  return text.slice(start, start + chars).split(/\r?\n/).slice(0, 2).join('\n');
}

function afterLabel(text, labelRe, valueRe) {
  const win = windowAfter(text, labelRe);
  if (win === null) return null;
  const v = new RegExp(String.raw`[^\S\r\n]*[:\-]?[^\S\r\n]*(` + valueRe + ')', 'i').exec(win);
  return v ? v[1].trim() : null;
}

function amountAfter(text, labelRe) {
  const win = windowAfter(text, labelRe, 120);
  if (win === null) return null;
  const num = /(?:rp\.?\s*)?(\d[\d.,\s]*\d|\d)/i.exec(win);
  return num ? parseAmount(num[1].trim()) : null;
}

/* A captured party name must stop where the next field begins. PDF text often has
   no line breaks, so "Dari : PT Sumber Makmur NPWP : 01... Kepada : PT Helm Care"
   would otherwise capture everything after "Dari" — which then contains BOTH party
   names and makes direction detection impossible. Truncate at the next known label. */
const NAME_STOPS = [
  /\bnpwp\b/i, /\bkepada\b/i, /\bbill\s+to\b/i, /\bpembeli\b/i, /\bpengusaha\b/i,
  /\bbuyer\b/i, /\bdari\b/i, /\bfrom\b/i, /\bvendor\b/i, /\bpenjual\b/i,
  /\bnetto\b/i, /\btotal\b/i, /\bjumlah\b/i, /\bdasar\b/i, /\bharga\b/i,
  /\balamat\b/i, /\baddress\b/i, /\btanggal\b/i, /\bdate\b/i, /\bperiode\b/i,
  /\bno\.?\s*(invoice|faktur)\b/i, /\binvoice\b/i, /\bppn\b/i, /\bqty\b/i, /\brp\b/i,
  /\d{2}\.\d{3}\.\d{3}/,
];

function trimName(v) {
  if (!v) return null;
  let s = String(v).replace(/^[\s:.\-]+/, '');
  let cut = s.length;
  for (const re of NAME_STOPS) {
    const m = new RegExp(re.source, 'i').exec(s);
    // Ignore a hit at position 0: that is the label itself, not the next field.
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  s = s.slice(0, cut).replace(/[\s:,.\-]+$/, '').trim();
  return s.length >= 3 ? s : null;
}

/* ── invoice / faktur pajak ────────────────────────────────────────────────*/
function extractInvoiceFields(text) {
  const f = {};
  const warnings = [];

  // Faktur Pajak serial: 16 digits, usually printed with dots and dashes.
  const serialRaw = afterLabel(text, /kode\s+dan\s+nomor\s+seri\s+faktur\s+pajak/i, String.raw`[\d][\d.\-\s]{14,25}`)
    || (/\b(\d{3}\.\d{3}[-.]\d{2}\.\d{8})\b/.exec(text) || [])[1]
    || (/\b(\d{16,17})\b/.exec(text) || [])[1];
  if (serialRaw) f.tax_invoice_serial = serialRaw.replace(/[\s.\-]/g, '');

  // Commercial reference. Kept separate from the tax serial: they are different numbers.
  f.document_number =
    afterLabel(text, /\b(?:no\.?\s*)?invoice\s*(?:no\.?|number|#)?/i, String.raw`[A-Z0-9][A-Z0-9\/\-]{4,30}`)
    || afterLabel(text, /\b(?:nomor|no\.?)\s*(?:dokumen|tagihan|referensi)/i, String.raw`[A-Z0-9][A-Z0-9\/\-]{4,30}`)
    || (/\b([A-Z]\d{9,12})\b/.exec(text) || [])[1]
    || null;

  f.issuer_name = trimName(
    afterLabel(text, /pengusaha\s+kena\s+pajak[\s\S]{0,40}?nama/i, String.raw`[^\r\n]{3,120}`)
    || afterLabel(text, /\b(?:dari|from|vendor|penjual)\b/i, String.raw`[^\r\n]{3,120}`));
  f.buyer_name = trimName(
    afterLabel(text, /pembeli\s+barang\s+kena\s+pajak[\s\S]{0,40}?nama/i, String.raw`[^\r\n]{3,120}`)
    || afterLabel(text, /\b(?:kepada|bill\s+to|buyer|pembeli)\b/i, String.raw`[^\r\n]{3,120}`));

  const npwps = [...String(text).matchAll(/\b(\d{2}\.\d{3}\.\d{3}\.\d[-.]\d{3}\.\d{3})\b/g)].map((m) => m[1]);
  if (npwps[0]) f.issuer_npwp = npwps[0];
  if (npwps[1]) f.buyer_npwp = npwps[1];

  // Amounts. DPP and PPN are the anchors; the total is checked against them below.
  f.commercial_base_amount =
    amountAfter(text, /dasar\s+pengenaan\s+pajak/i)
    ?? amountAfter(text, /\b(?:dpp|harga\s+jual|penggantian)\b/i);
  f.commercial_tax_amount =
    amountAfter(text, /jumlah\s+ppn/i)
    ?? amountAfter(text, /\bppn\b(?!\s*:?\s*$)/i)
    ?? amountAfter(text, /pajak\s+pertambahan\s+nilai/i);
  f.gross_amount =
    amountAfter(text, /\b(?:netto|total\s+tagihan|grand\s+total|jumlah\s+total)\b/i)
    ?? amountAfter(text, /\btotal\b/i);

  // Arithmetic check. If base + tax does not equal the total we read, one of the three
  // was misread — say so rather than silently preferring one.
  const { commercial_base_amount: b, commercial_tax_amount: x, gross_amount: g } = f;
  if (b != null && x != null) {
    const sum = Math.round((b + x) * 100) / 100;
    if (g == null) { f.gross_amount = sum; warnings.push('Total was not found on the document; derived from base + tax.'); }
    else if (Math.abs(g - sum) > 0.5) {
      warnings.push(`Read total ${g} does not equal base ${b} + tax ${x} (${sum}). Confirm all three before saving.`);
    }
  }

  const period = /(\d{1,2}\s+\w+\s+\d{4})\s*(?:s\/d|sampai|-|–|to)\s*(\d{1,2}\s+\w+\s+\d{4})/i.exec(text);
  if (period) { f.period_start_text = period[1]; f.period_end_text = period[2]; }

  const desc = afterLabel(text, /\b(?:nama\s+barang|keterangan|description|uraian)\b/i, String.raw`[^\r\n]{5,200}`);
  if (desc) f.description = desc;

  return { fields: f, warnings };
}

/* ── bank payment proof ────────────────────────────────────────────────────*/
function extractPaymentProofFields(text) {
  const f = {};
  const warnings = [];

  f.bank_name = /\bbca\b/i.test(text) ? 'BCA'
    : /\bmandiri\b/i.test(text) ? 'Mandiri'
      : /\bbni\b/i.test(text) ? 'BNI'
        : /\bbri\b/i.test(text) ? 'BRI' : null;

  f.payment_reference_number =
    afterLabel(text, /\b(?:reference|referensi)\s*(?:no\.?|number)?/i, String.raw`[A-Z0-9]{6,32}`)
    || (/\b(\d{12,20})\b/.exec(text) || [])[1] || null;

  const dt = /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/.exec(text)
    || /(\d{2}\/\d{2}\/\d{4})/.exec(text)
    || /(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?)/.exec(text);
  if (dt) f.transfer_date_text = dt[1];

  // "772-1538064 / HELM CARE INDONESIA PT" — number and holder on one line.
  // The holder must END on an upper-case character and be followed by either a
  // Capitalised word (the next label, e.g. "Ke", "Amount"), a line break, or the end.
  // Without that lookahead the run of capitals eats the first letter of the next
  // label, giving "PT ALPHA SENTOSA K".
  const accounts = [...String(text).matchAll(
    /(\d{3}[-\s]?\d{6,10})\s*[/|]\s*([A-Z][A-Z\s.&']*[A-Z])(?=\s+[A-Z][a-z]|\s*\r?\n|\s*$)/g)]
    .map((m) => ({ number: m[1].trim(), name: m[2].trim() }));
  if (accounts[0]) { f.from_account_number = accounts[0].number; f.from_account_name = trimName(accounts[0].name); }
  if (accounts[1]) { f.to_account_number = accounts[1].number; f.to_account_name = trimName(accounts[1].name); }
  if (accounts.length === 1) warnings.push('Only one account could be read; confirm which side is the payee.');

  f.amount = amountAfter(text, /\b(?:amount|jumlah|nominal)\b/i);
  f.fee = amountAfter(text, /\b(?:fee|biaya|admin)\b/i);
  if (f.fee === null && /\bfee\b/i.test(text)) f.fee = 0;

  const st = /\b(successful|success|berhasil|completed|pending|failed|gagal)\b/i.exec(text);
  if (st) f.payment_status = st[1][0].toUpperCase() + st[1].slice(1).toLowerCase();
  if (f.payment_status && !/success|berhasil|complete/i.test(f.payment_status)) {
    warnings.push(`Payment status reads "${f.payment_status}" — only a successful transfer can settle an invoice.`);
  }
  return { fields: f, warnings };
}

/* ── public entry point ────────────────────────────────────────────────────*/
const EMPTY_FIELDS = {
  document_number: null, tax_invoice_serial: null, issuer_name: null, buyer_name: null,
  issuer_npwp: null, buyer_npwp: null, description: null,
  period_start: null, period_end: null, period_start_text: null, period_end_text: null,
  currency: 'IDR',
  commercial_base_amount: null, commercial_tax_amount: null, gross_amount: null,
  payment_reference_number: null, payment_status: null, bank_name: null,
  transfer_date_text: null, amount: null, fee: null,
  from_account_number: null, from_account_name: null,
  to_account_number: null, to_account_name: null,
};

// Kinds that are evidence rather than a transaction: nothing is created from them.
const SUPPORTING_TYPES = ['contract', 'bank_statement', 'tax_document', 'payroll_document', 'funding_document'];

const REQUIRED_BY_TYPE = {
  invoice: ['document_number', 'gross_amount'],
  faktur_pajak: ['commercial_base_amount', 'commercial_tax_amount', 'gross_amount'],
  payment_proof: ['amount', 'payment_reference_number'],
  receipt: ['gross_amount'],
  asset_purchase: ['gross_amount'],
  bank_fee: ['gross_amount'],
  contract: [], bank_statement: [], tax_document: [],
  payroll_document: [], funding_document: [],
  unknown: [],
};

/**
 * @param text  embedded text from the document (server/lib/pdfText.js), '' if none
 * @param opts  { text_available, document_type, file_name, extraction_reason }
 */
function extractFromText(text = '', opts = {}) {
  const available = opts.text_available !== false && String(text || '').trim().length > 0;

  if (!available) {
    // The honest answer for a scanned page. No fields, no confidence, no guess.
    return {
      document_type: opts.document_type === 'payment_proof' ? 'payment_proof' : 'unknown',
      confidence: 'needs_review',
      status: 'needs_manual_review',
      fields: { ...EMPTY_FIELDS },
      missing_fields: Object.keys(EMPTY_FIELDS).filter((k) => k !== 'currency'),
      warnings: ['Automatic extraction not available for a scanned image yet. Enter the values manually for now.'],
      raw_text_excerpt: '',
      reason: opts.extraction_reason || 'no_embedded_text',
    };
  }

  const det = detectType(text, opts);
  // Amount-bearing kinds get the invoice parser; a receipt or an asset purchase still
  // carries a total and a party, so it is worth reading even though it is not a bill.
  const isInvoiceLike = ['invoice', 'faktur_pajak', 'receipt', 'asset_purchase', 'bank_fee'].includes(det.type);
  const part = isInvoiceLike ? extractInvoiceFields(text)
    : det.type === 'payment_proof' ? extractPaymentProofFields(text)
      : SUPPORTING_TYPES.includes(det.type)
        ? { fields: {}, warnings: [`Recognised as a ${det.type.replace(/_/g, ' ')}. No financial record is created from it; it is supporting evidence.`] }
        : { fields: {}, warnings: ['Document kind not recognised from its text.'] };

  const fields = { ...EMPTY_FIELDS, ...part.fields };
  const required = REQUIRED_BY_TYPE[det.type] || [];
  const missing = required.filter((k) => fields[k] === null || fields[k] === undefined);

  // Confidence is earned by anchors AND by the required fields actually being found.
  let confidence;
  if (det.type === 'unknown') confidence = 'needs_review';
  else if (det.anchors >= 2 && missing.length === 0) confidence = 'high';
  else if (det.anchors >= 1 && missing.length <= 1) confidence = 'medium';
  else confidence = 'low';

  const warnings = [...part.warnings];
  if (missing.length) warnings.push(`Could not read: ${missing.join(', ')}. Enter these manually.`);
  if (confidence !== 'high') warnings.push('Review every value before saving — extraction is a suggestion, not a reading you can rely on.');

  return {
    document_type: det.type,
    confidence,
    // Nothing is ever saved by extraction itself.
    status: confidence === 'needs_review' ? 'needs_manual_review' : 'suggested',
    detection: det,
    fields,
    missing_fields: missing,
    warnings,
    raw_text_excerpt: String(text).replace(/\s+/g, ' ').trim().slice(0, 600),
    reason: null,
  };
}

/* ── duplicate detection ───────────────────────────────────────────────────
   A bank reference plus the same amount in the same business is a strong signal;
   the reference alone is already enough to warrant a warning. */
function findDuplicateDocument(candidate = {}, existing = []) {
  const ref = candidate.payment_reference_number || candidate.document_number;
  if (!ref) return { duplicate: false, reason: 'No reference number — duplicates cannot be detected automatically.' };
  const norm = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
  const hit = (existing || []).find((e) => {
    const eRef = norm(e.payment_reference_number || e.document_number);
    if (!eRef || eRef !== norm(ref)) return false;
    if (candidate.amount != null && e.amount != null) return Number(candidate.amount) === Number(e.amount);
    return true;
  });
  return hit
    ? { duplicate: true, reference: ref, match: hit,
        reason: `Reference ${ref} is already recorded in this workspace. Allocating it again would double-count the payment.` }
    : { duplicate: false, reference: ref };
}

module.exports = {
  TYPES, SUPPORTING_TYPES, EMPTY_FIELDS, detectType, extractFromText,
  extractInvoiceFields, extractPaymentProofFields, findDuplicateDocument,
};
