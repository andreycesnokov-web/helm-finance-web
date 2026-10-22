// OCR / Vision fallback for documents that carry no embedded text.
//
// WHY THIS EXISTS
// server/lib/pdfText.js reads embedded text only. A scanned page or a photographed
// kwitansi carries none, so the intake pipeline correctly answered "unsupported" —
// honest, but a dead end for a document a human can plainly read.
//
// WHAT IT IS NOT
//   · not a new provider. The Anthropic SDK and client are already in this codebase and
//     already used elsewhere; this module only borrows the client it is handed.
//   · not automatic bookkeeping. It returns a SUGGESTION in the same review-safe shape
//     the text extractor produces. It creates nothing and links nothing.
//   · not on by default. DOCUMENT_OCR_VISION_ENABLED gates every call, because reading a
//     document costs money and that is the operator's decision, not this module's.
//
// FAIL-OPEN BY CONSTRUCTION
// Every path returns a result object; nothing here throws. A missing key, a disabled
// flag, an oversized file, a timeout, a refusal, unparseable output — each becomes
// { ok: false, reason } and the caller carries on exactly as it did before OCR existed.
// An upload must never fail because a document could not be read.
'use strict';

/** Vision is opt-in per environment. Read at call time so tests can flip it. */
const ocrEnabled = () => process.env.DOCUMENT_OCR_VISION_ENABLED === 'true';

// A vision call is billed per document, so the guards are size and time, not cleverness.
const MAX_OCR_BYTES = 8 * 1024 * 1024;   // ~10.7 MB base64, well inside the API limit
const OCR_TIMEOUT_MS = 45000;
const MAX_TEXT_CHARS = 6000;             // transcript we keep; the rest is not needed
const DEFAULT_MODEL = 'claude-sonnet-4-5';

const SUPPORTED_OCR_MODELS = new Set([
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-3-7-sonnet',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku',
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
  'claude-3-opus',
  'claude-3-opus-latest',
  'claude-3-opus-20240229',
]);

function getOcrModel() {
  const envVal = process.env.ANTHROPIC_OCR_MODEL ? process.env.ANTHROPIC_OCR_MODEL.trim() : '';
  if (!envVal) return DEFAULT_MODEL;
  if (SUPPORTED_OCR_MODELS.has(envVal)) return envVal;
  console.warn(`[OCR] Configured ANTHROPIC_OCR_MODEL "${envVal}" is not in the supported list. Falling back to default "${DEFAULT_MODEL}".`);
  return DEFAULT_MODEL;
}

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Types the reader may answer with — the same vocabulary the text extractor uses, so a
 *  document classified by vision and one classified from text are indistinguishable
 *  downstream. */
const OCR_TYPES = ['invoice', 'faktur_pajak', 'payment_proof', 'receipt', 'contract',
  'bank_statement', 'tax_document', 'payroll_document', 'unknown'];

// Field-by-field, so a model that invents a key cannot put it into the pipeline.
const FIELD_KEYS = [
  'document_number', 'issuer_name', 'buyer_name', 'counterparty_name',
  'date', 'invoice_date', 'due_date', 'currency', 'amount',
  'subtotal', 'commercial_base_amount', 'tax_base_dpp', 'discount_amount',
  'commercial_tax_amount', 'gross_amount',
  'payment_method', 'period_start', 'period_end', 'reference_number',
  'npwp', 'issuer_npwp', 'buyer_npwp', 'tax_invoice_serial',
];

const NUMERIC_FIELDS = new Set([
  'amount', 'subtotal', 'commercial_base_amount', 'tax_base_dpp', 'discount_amount',
  'commercial_tax_amount', 'gross_amount',
]);

const PROMPT = `You are reading a scanned business document for an Indonesian accounting system.

Return ONLY a JSON object, no markdown fence, no commentary:
{"text":"","document_type":"","confidence":"","fields":{},"line_items":[],"warnings":[],"supporting_documents":{}}

document_type must be exactly one of: ${OCR_TYPES.join(', ')}.
Indonesian guidance:
- "KWITANSI"/"KUITANSI" (often with "Sudah terima dari", "Berupa", "Untuk pembayaran",
  "Terbilang") is a RECEIPT for money already handed over -> "receipt", NOT "invoice".
- Multi-page document / package rule:
  * When a document contains a commercial invoice / bill asking for payment, the primary
    document_type is "invoice", even if accompanied by a Faktur Pajak or contract/agreement.
  * When a document contains a Kwitansi / receipt attached with Faktur Pajak or contract/agreement,
    the primary document_type is "receipt", with supporting_documents.tax_invoice = true.
    A Kwitansi is proof of payment already made, not an open invoice or tax bill.
  * Report attached supporting documents in supporting_documents:
    {"invoice": true/false, "tax_invoice": true/false, "contract": true/false, "payment_proof": true/false}.
- Standalone "Faktur Pajak" (with a Kode dan Nomor Seri and no commercial invoice) -> "faktur_pajak".
- "Invoice"/"Tagihan" asking for payment -> "invoice".
- A bank transfer slip / "Bukti Transfer" -> "payment_proof".
- "Rekening Koran"/"Mutasi Rekening" -> "bank_statement".
- "Bukti Potong", "SSP", "NTPN", "Kode Billing" -> "tax_document".
- "Slip Gaji"/"Daftar Gaji" -> "payroll_document".

confidence: "high" only if the document type and the total amount are both unambiguous;
"medium" if one is inferred; "low" if the page is unclear.

fields (use null for anything not printed on the document — never guess):
 document_number (commercial invoice reference, e.g. X2610001139),
 tax_invoice_serial (16-digit Faktur Pajak serial, digits only),
 issuer_name (supplier/seller), buyer_name (customer/buyer), counterparty_name,
 issuer_npwp, buyer_npwp,
 date (YYYY-MM-DD), invoice_date (YYYY-MM-DD), due_date (YYYY-MM-DD),
 currency (ISO, "IDR" for Rp),
 subtotal (commercial subtotal before tax/incentives),
 commercial_base_amount (tax base or commercial base),
 tax_base_dpp (Dasar Pengenaan Pajak on Faktur Pajak),
 discount_amount (trade discount / incentive),
 commercial_tax_amount (PPN / VAT),
 gross_amount (total payable printed on commercial invoice, e.g. 143856000),
 amount (same as gross_amount for invoices),
 payment_method, period_start, period_end, reference_number, npwp.

line_items: array of line items with:
 item_number (integer, e.g. 1),
 description (clean text, e.g. "Software Subscription"),
 quantity (number, default 1),
 unit_price (number),
 total_amount (number),
 currency (ISO, e.g. "IDR", "USD").
 If no item lines appear on the document, return [].

FINANCIAL RECONCILIATION RULE:
- NEVER confuse Dasar Pengenaan Pajak (DPP, tax base) with commercial Subtotal or Total.
  In Indonesian retail/consignment invoices, the commercial Subtotal and Faktur Pajak DPP may differ
  due to fee calculations, trade incentives, or statutory tax base adjustments.
  Keep Subtotal, DPP, and Gross Total strictly separate as printed.
  Do NOT assume a difference between Subtotal and DPP is a discount unless explicitly stated on the document.
  Read the explicit total printed on the commercial invoice for gross_amount.
  Never calculate Gross Total as DPP + PPN if an explicit commercial total is printed.
- Amounts: digits only, no separators. "Rp 143.856.000" -> 143856000.
- On a kwitansi: issuer_name is who RECEIVED the money, counterparty_name is who PAID
  ("Sudah terima dari"), and amount is the "Jumlah".

text: a short plain-text transcript of the document, at most 1500 characters.
warnings: short strings for anything unreadable, ambiguous or contradictory.

If the image is unreadable, return document_type "unknown", null fields and say so in
warnings. Never invent a number.`;

/* ── output sanitising ─────────────────────────────────────────────────────── */

const asNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  // Tolerate "11.322.000", "11,322,000" and "Rp 11.322.000" even though the prompt
  // asks for digits — a model that formats nicely should not cost us the figure.
  const digits = String(v).replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '').replace(/,/g, '.');
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};
const asString = (v, cap = 200) => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && !/^(null|n\/a|-|unknown)$/i.test(s) ? s.slice(0, cap) : null;
};

function normalizeLineItems(rawItems, defaultCurrency = 'IDR') {
  if (!Array.isArray(rawItems)) return [];
  const normalized = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    if (!it || typeof it !== 'object') continue;
    const desc = asString(it.description || it.name || it.item_name || it.deskripsi, 300);
    if (!desc) continue;
    const qty = asNumber(it.quantity ?? it.qty) ?? 1;
    const unitPrice = asNumber(it.unit_price ?? it.price ?? it.rate ?? it.harga_satuan);
    const total = asNumber(it.total_amount ?? it.total ?? it.amount ?? it.total_price)
      ?? (unitPrice !== null ? Math.round(qty * unitPrice * 100) / 100 : null);
    const cur = asString(it.currency, 8) ? String(it.currency).toUpperCase().slice(0, 8) : defaultCurrency;
    normalized.push({
      item_number: asNumber(it.item_number ?? it.line_number) ?? (i + 1),
      description: desc,
      quantity: qty,
      unit_price: unitPrice,
      total_amount: total,
      currency: cur,
    });
  }
  return normalized;
}

/** Coerce the model's answer into the exact documented shape. Unknown keys are dropped. */
function normalizeResult(parsed) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  const fields = {};
  const rawFields = src.fields && typeof src.fields === 'object' ? src.fields : {};
  for (const k of FIELD_KEYS) {
    fields[k] = NUMERIC_FIELDS.has(k) ? asNumber(rawFields[k]) : asString(rawFields[k]);
  }
  if (fields.currency) fields.currency = fields.currency.toUpperCase().slice(0, 8);

  const line_items = normalizeLineItems(src.line_items || rawFields.line_items, fields.currency || 'IDR');

  const type = OCR_TYPES.includes(src.document_type) ? src.document_type : 'unknown';
  const confidence = ['high', 'medium', 'low'].includes(src.confidence) ? src.confidence : 'low';
  const warnings = Array.isArray(src.warnings)
    ? src.warnings.filter((w) => typeof w === 'string' && w).slice(0, 10).map((w) => w.slice(0, 300))
    : [];

  // A type with no amount at all has not really been read; say so rather than let a
  // confident-sounding label travel downstream on nothing.
  const anyAmount = fields.amount ?? fields.gross_amount ?? fields.commercial_base_amount;
  if (type !== 'unknown' && anyAmount === null && !warnings.length) {
    warnings.push('No amount could be read from this document. Check it before using the result.');
  }

  const supporting_documents = src.supporting_documents && typeof src.supporting_documents === 'object'
    ? {
      invoice: !!src.supporting_documents.invoice,
      tax_invoice: !!src.supporting_documents.tax_invoice,
      contract: !!src.supporting_documents.contract,
      payment_proof: !!src.supporting_documents.payment_proof,
    }
    : null;

  return {
    ok: true,
    source: 'ocr_vision',
    text: asString(src.text, MAX_TEXT_CHARS) || '',
    document_type: type,
    confidence: anyAmount === null && confidence === 'high' ? 'medium' : confidence,
    fields,
    line_items,
    supporting_documents,
    warnings,
  };
}

const failure = (reason, warning) => ({
  ok: false, source: 'ocr_vision', reason,
  text: '', document_type: 'unknown', confidence: 'low',
  fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, null])),
  line_items: [],
  warnings: warning ? [warning] : [],
});

/* ── the call ──────────────────────────────────────────────────────────────── */

/**
 * Read a document with vision.
 *
 * @param {Buffer} buffer      the verified stored bytes
 * @param {object} opts        { mime_type, file_name, client } — `client` is the existing
 *                             Anthropic client, injected so this module owns no key and
 *                             tests can pass a stub.
 * @returns {Promise<object>}  never rejects; `ok:false` carries a machine-readable reason.
 */
async function readDocumentWithVision(buffer, opts = {}) {
  if (!ocrEnabled()) return failure('ocr_disabled');
  const client = opts.client;
  if (!client || typeof client?.messages?.create !== 'function') return failure('ocr_not_configured');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return failure('empty_file');
  if (buffer.length > MAX_OCR_BYTES) {
    return failure('file_too_large_for_ocr',
      'This document is too large to read automatically. Enter the values manually.');
  }

  const mime = String(opts.mime_type || '').toLowerCase();
  const isPdf = /pdf/.test(mime) || /\.pdf$/i.test(opts.file_name || '');
  const imageMime = IMAGE_MIME.find((m) => mime === m);
  if (!isPdf && !imageMime) return failure('unsupported_media_type_for_ocr');

  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: imageMime, data: buffer.toString('base64') } };

  let resp;
  try {
    // A vision call runs inside an HTTP request that already holds a stored file, so it
    // gets a hard ceiling rather than the SDK's default patience.
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('ocr_timeout')), OCR_TIMEOUT_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    try {
      resp = await Promise.race([
        client.messages.create({
          model: getOcrModel(), max_tokens: 2000,
          messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    const timedOut = /ocr_timeout/.test(e.message || '');
    return failure(timedOut ? 'ocr_timeout' : 'ocr_request_failed',
      'Automatic reading did not finish. Enter the values manually or try again.');
  }

  const raw = (resp?.content?.[0]?.text || '').trim()
    .replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (!raw) return failure('ocr_empty_response');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return failure('ocr_unparseable_response'); }

  return normalizeResult(parsed);
}

/* ── folding a vision reading into the normal extraction shape ─────────────── */

// Which OCR field answers which extraction field. The parser that ran over the
// transcript wins wherever it found something: it read the actual characters, while
// these are the model's own structured answer.
const FILL_FROM_OCR = {
  document_number: (f) => f.document_number,
  tax_invoice_serial: (f) => f.tax_invoice_serial,
  issuer_name: (f) => f.issuer_name,
  buyer_name: (f) => f.buyer_name ?? f.counterparty_name,
  issuer_npwp: (f) => f.issuer_npwp ?? f.npwp,
  buyer_npwp: (f) => f.buyer_npwp,
  description: () => null,
  currency: (f) => f.currency,
  subtotal: (f) => f.subtotal ?? f.commercial_base_amount,
  commercial_base_amount: (f) => f.commercial_base_amount ?? f.subtotal,
  tax_base_dpp: (f) => f.tax_base_dpp,
  discount_amount: (f) => f.discount_amount,
  commercial_tax_amount: (f) => f.commercial_tax_amount,
  gross_amount: (f) => f.gross_amount ?? f.amount,
  amount: (f) => f.amount ?? f.gross_amount,
  payment_method: (f) => f.payment_method,
  payment_reference_number: (f) => f.reference_number,
  transfer_date_text: (f) => f.date,
  document_date: (f) => f.invoice_date ?? f.date,
};

/**
 * Merge a vision reading into an extraction produced from its transcript.
 *
 * Confidence is deliberately CAPPED AT MEDIUM. A model reading a photographed page is
 * not in the same class of certainty as parsing embedded text, and "high" is what the
 * UI uses to relax its warnings — so a vision reading never earns it.
 */
function mergeIntoExtraction(base, ocr) {
  if (!ocr || !ocr.ok) return base;
  const fields = { ...(base.fields || {}) };
  const of = ocr.fields || {};
  for (const [key, pick] of Object.entries(FILL_FROM_OCR)) {
    if (!(key in fields)) continue;
    const current = fields[key];
    const isEmpty = current === null || current === undefined
      || (key === 'currency' && current === 'IDR' && of.currency && of.currency !== 'IDR');
    if (isEmpty) {
      const v = pick(of);
      if (v !== null && v !== undefined) fields[key] = v;
    }
  }

  const subtotalVal = fields.subtotal ?? fields.commercial_base_amount ?? null;
  const dppVal = fields.tax_base_dpp ?? null;
  if (subtotalVal !== null && dppVal !== null && subtotalVal !== dppVal) {
    fields.subtotal_dpp_variance = Math.abs(subtotalVal - dppVal);
  }

  let type = (base.document_type && base.document_type !== 'unknown')
    ? base.document_type : ocr.document_type;

  // Package reconciliation: if an invoice number/commercial bill exists alongside a Faktur Pajak,
  // the document is a commercial invoice package and its primary payable type is invoice.
  if (type === 'faktur_pajak' && (ocr.supporting_documents?.invoice || fields.document_number)) {
    type = 'invoice';
  }

  // Kwitansi / receipt package reconciliation: if a document contains a receipt/kwitansi,
  // classify as receipt over faktur_pajak, preserving zero-posting (needs manual review).
  if (type === 'faktur_pajak' && (ocr.supporting_documents?.payment_proof || /kwitansi|kuitansi/i.test(ocr.text || ''))) {
    type = 'receipt';
  }

  if ((!fields.line_items || fields.line_items.length === 0) && Array.isArray(ocr.line_items) && ocr.line_items.length > 0) {
    fields.line_items = ocr.line_items;
  } else if (!fields.line_items) {
    fields.line_items = [];
  }

  const detected_supporting_documents = {
    invoice: type === 'invoice' || !!(ocr.supporting_documents && ocr.supporting_documents.invoice),
    tax_invoice: type === 'faktur_pajak' || !!fields.tax_invoice_serial || !!(ocr.supporting_documents && ocr.supporting_documents.tax_invoice),
    contract: type === 'contract' || !!(ocr.supporting_documents && ocr.supporting_documents.contract),
    payment_proof: type === 'payment_proof' || type === 'receipt' || !!(ocr.supporting_documents && ocr.supporting_documents.payment_proof),
  };

  const RANK = { needs_review: 0, low: 1, medium: 2, high: 3 };
  const capped = Math.min(RANK[base.confidence] ?? 0, RANK[ocr.confidence] ?? 0, RANK.medium);
  const confidence = Object.keys(RANK).find((k) => RANK[k] === capped) || 'low';

  const warnings = [...new Set([
    ...(base.warnings || []),
    ...(ocr.warnings || []),
    'This document was read by OCR/Vision, not from embedded text. Check every value before saving.',
  ])];

  // Anything still missing after both readers is what the user is asked for.
  const missing = (base.missing_fields || []).filter((k) => fields[k] === null || fields[k] === undefined);

  return {
    ...base,
    document_type: type,
    confidence,
    status: 'suggested',
    fields,
    line_items: fields.line_items || [],
    detected_supporting_documents,
    missing_fields: missing,
    warnings,
    // Never the full transcript: this travels with the document row.
    raw_text_excerpt: String(ocr.text || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    reason: null,
    text_available: true,
    read_source: 'ocr_vision',
  };
}

module.exports = {
  readDocumentWithVision, normalizeResult, mergeIntoExtraction, ocrEnabled,
  getOcrModel, DEFAULT_MODEL, SUPPORTED_OCR_MODELS,
  normalizeLineItems,
  OCR_TYPES, FIELD_KEYS, MAX_OCR_BYTES, OCR_TIMEOUT_MS,
};
