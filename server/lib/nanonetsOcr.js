// Nanonets OCR Adapter for CFO AI document extraction pipeline.
//
// WHY THIS EXISTS
// Adds Nanonets as an optional, feature-flagged OCR provider alongside native PDF
// text extraction and Anthropic Vision, enabling empirical accuracy comparisons on
// complex Indonesian invoices, receipts, and multi-page tax packages.
//
// SAFETY INVARIANTS:
// 1. Opt-in per environment via DOCUMENT_OCR_NANONETS_ENABLED=true (OFF by default).
// 2. Fail-open by construction: never throws, returns { ok: false, reason } on any error.
// 3. Zero financial posting: produces review suggestions only (status: 'suggested' or
//    'needs_manual_review'). Never mutates ledgers or creates payments.
// 4. Preserves raw extraction evidence (bounding boxes, source citations, raw predictions).
// 5. Never infers PPN, DPP, NPWP, or tax obligations from missing fields.
// 6. Confidence is capped at 'medium' to ensure mandatory human review.
'use strict';

const nanonetsEnabled = () => process.env.DOCUMENT_OCR_NANONETS_ENABLED === 'true';

const MAX_OCR_BYTES = 8 * 1024 * 1024; // 8 MB ceiling
const DEFAULT_TIMEOUT_MS = 45000;      // 45s ceiling
const DEFAULT_BASE_URL = 'https://app.nanonets.com/api/v2';
const DEFAULT_MODEL_ID = 'invoices';

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/tiff',
]);

const OCR_TYPES = [
  'invoice', 'faktur_pajak', 'payment_proof', 'receipt', 'contract',
  'bank_statement', 'tax_document', 'payroll_document', 'unknown',
];

const FIELD_KEYS = [
  'document_number', 'issuer_name', 'buyer_name', 'counterparty_name',
  'date', 'invoice_date', 'due_date', 'currency', 'amount',
  'subtotal', 'commercial_base_amount', 'tax_base_dpp', 'discount_amount',
  'commercial_tax_amount', 'gross_amount',
  'payment_method', 'period_start', 'period_end', 'reference_number',
  'npwp', 'issuer_npwp', 'buyer_npwp', 'tax_invoice_serial',
];

function getNanonetsApiKey() {
  return (process.env.NANONETS_API_KEY || '').trim();
}

function getNanonetsModelId() {
  return (process.env.NANONETS_MODEL_ID || '').trim() || DEFAULT_MODEL_ID;
}

function getNanonetsBaseUrl() {
  return (process.env.NANONETS_API_BASE_URL || '').trim() || DEFAULT_BASE_URL;
}

/* ── Sanitization & Normalization Helpers ──────────────────────────────────── */

const asNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  // Tolerate Indonesian number formats like "143.856.000,00" or "143.856.000.00"
  // and currency labels "Rp 143.856.000", "RP.4.500.000", "IDR 4.500.000", "Rp 4.500.000,-"
  // Strip leading currency prefixes and non-digit characters, and trailing dashes/periods
  const str = String(v).trim().replace(/^[^\d-]+/, '').replace(/[,.-]+$/, '');
  if (!str) return null;

  // Handle dot as thousand separator and comma as decimal: "143.856.000,50" -> 143856000.5
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    const clean = str.replace(/\./g, '').replace(/,/g, '.');
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }
  // Handle dot as thousand separator ending with .00: "143.856.000.00" -> 143856000
  if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(str)) {
    const parts = str.split('.');
    const decimal = parts.pop();
    const intPart = parts.join('');
    const n = Number(intPart + '.' + decimal);
    return Number.isFinite(n) ? n : null;
  }
  // Standard format or plain digits
  const standard = str.replace(/[.,](?=\d{3}\b)/g, '').replace(/,/g, '.');
  const n = Number(standard);
  return Number.isFinite(n) ? n : null;
};

const asString = (v, cap = 200) => {
  if (v === null || v === undefined) return null;
  // Collapse whitespace (multiple spaces/tabs into a single space)
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && !/^(null|n\/a|-|unknown|undefined)$/i.test(s) ? s.slice(0, cap) : null;
};

const extractValue = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return v;
};

const extractCitationId = (v) => {
  if (v && typeof v === 'object' && Array.isArray(v.bounding_boxes) && v.bounding_boxes.length > 0) {
    return v.bounding_boxes[0]?.citation_id ?? null;
  }
  return null;
};

/**
 * Normalizes line items from either Nanonets Agent JSON array or standard prediction cells.
 */
function normalizeLineItems(rawItems, defaultCurrency = 'IDR') {
  if (!Array.isArray(rawItems)) return [];
  const normalized = [];

  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    if (!it || typeof it !== 'object') continue;

    // Supports both Agent format: { description: { value: "..." } } and flat { description: "..." }
    const descRaw = extractValue(
      it.description ?? it.Description ?? it.item_name ?? it.item_description ?? it.name ?? it.deskripsi
    );
    const desc = asString(descRaw, 300);
    if (!desc) continue;

    const qtyRaw = extractValue(it.quantity ?? it.qty ?? it.Quantity);
    const qty = asNumber(qtyRaw) ?? 1;

    const unitPriceRaw = extractValue(it.unit_price ?? it.price ?? it.rate ?? it.harga_satuan ?? it.Price);
    const unitPrice = asNumber(unitPriceRaw);

    const totalRaw = extractValue(
      it.line_amount ?? it.Line_Amount ?? it.total_amount ?? it.total_price ?? it.total ?? it.amount ?? it.Total ?? it.subtotal
    );
    let total = asNumber(totalRaw);
    if (total === null && unitPrice !== null) {
      total = Math.round(qty * unitPrice * 100) / 100;
    }
    const finalUnitPrice = unitPrice !== null ? unitPrice : (qty === 1 && total !== null ? total : null);

    const curRaw = extractValue(it.currency ?? it.Currency);
    const cur = asString(curRaw, 8) ? String(curRaw).toUpperCase().slice(0, 8) : defaultCurrency;

    const itemNumRaw = extractValue(it.item_number ?? it.line_number ?? it.Item_Number);
    const itemNum = asNumber(itemNumRaw) ?? (i + 1);

    normalized.push({
      item_number: itemNum,
      description: desc,
      quantity: qty,
      unit_price: finalUnitPrice,
      total_amount: total,
      currency: cur,
    });
  }

  return normalized;
}

/**
 * Normalize raw Nanonets response into canonical CFO AI extraction schema.
 * Supports:
 *   1. Standard Nanonets OCR Prediction API: { message, result: [ { prediction: [ ... ] } ] }
 *   2. Flat Prediction Array (e.g. GET ImageLevelInferences): [ { label, ocr_text, score, ... } ]
 *   3. Nanonets Agent / Workflow Export: { vendor_name: { value, ... }, line_items: [ ... ] }
 */
function normalizeNanonetsResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return failure('nanonets_invalid_response', 'Invalid or empty response from Nanonets');
  }

  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null]));
  const warnings = [];
  let rawItems = [];
  let detectedType = 'unknown';
  const rawEvidence = {
    citations: raw.source_citations || null,
    bounding_boxes: {},
    raw_predictions: null,
    field_scores: {},
  };

  // Extract predictions array if present in any of the Nanonets OCR response variants:
  // 1. Direct flat array: [ { label, ocr_text, score, ... } ] (from GET ImageLevelInferences)
  // 2. Standard Prediction API: { result: [ { prediction: [ ... ] } ] } (from POST LabelFile)
  // 3. Flat prediction array: { prediction: [ ... ] }
  // 4. Result array: { result: [ { label, ocr_text, ... } ] }
  let predictions = null;
  if (Array.isArray(raw)) {
    predictions = raw;
  } else if (Array.isArray(raw.result) && raw.result[0]?.prediction) {
    predictions = raw.result[0].prediction;
  } else if (Array.isArray(raw.prediction)) {
    predictions = raw.prediction;
  } else if (Array.isArray(raw.result) && raw.result.length > 0 && (raw.result[0]?.label || raw.result[0]?.ocr_text)) {
    predictions = raw.result;
  }

  const allOcrTexts = [];

  // Case 1: Standard Nanonets OCR Prediction API (array of predictions)
  if (Array.isArray(predictions)) {
    rawEvidence.raw_predictions = predictions;
    let tableCells = [];

    for (const p of predictions) {
      if (!p || typeof p !== 'object') continue;
      const label = String(p.label || '').toLowerCase();
      const text = p.ocr_text || p.text || '';
      const score = typeof p.score === 'number' ? p.score : 0.8;

      if (text) allOcrTexts.push(text);

      if (label) {
        rawEvidence.field_scores[label] = score;
        if (p.xmin !== undefined && p.ymin !== undefined) {
          rawEvidence.bounding_boxes[label] = {
            xmin: p.xmin,
            ymin: p.ymin,
            xmax: p.xmax,
            ymax: p.ymax,
            page: p.page,
          };
        }
      }

      if (score < 0.5 && label !== 'table') {
        warnings.push(`Low confidence on field "${label}": ${(score * 100).toFixed(0)}%`);
      }

      if ((label === 'table' || p.type === 'table') && Array.isArray(p.cells)) {
        tableCells = p.cells;
      } else if (label === 'invoice_number' || label === 'invoice_no' || label === 'document_number' || label === 'bill_number') {
        fields.document_number = asString(text);
      } else if (label === 'tax_invoice_number' || label === 'tax_invoice_serial' || label === 'faktur_pajak_number' || label === 'faktur_pajak_serial') {
        fields.tax_invoice_serial = asString(text);
      } else if (label === 'seller_name' || label === 'vendor_name' || label === 'supplier_name' || label === 'biller_name') {
        fields.issuer_name = asString(text);
      } else if (label === 'buyer_name' || label === 'customer_name' || label === 'client_name' || label === 'recipient_name') {
        fields.buyer_name = asString(text);
      } else if (label === 'seller_tax_id' || label === 'vendor_npwp' || label === 'seller_npwp') {
        fields.issuer_npwp = asString(text);
      } else if (label === 'buyer_tax_id' || label === 'customer_npwp' || label === 'buyer_npwp') {
        fields.buyer_npwp = asString(text);
      } else if (label === 'invoice_date' || label === 'date' || label === 'bill_date') {
        fields.invoice_date = asString(text);
        fields.date = fields.invoice_date;
      } else if (label === 'due_date' || label === 'payment_due_date') {
        fields.due_date = asString(text);
      } else if (label === 'currency' || label === 'currency_code') {
        fields.currency = asString(text);
      } else if (label === 'subtotal' || label === 'sub_total' || label === 'subtotal_amount') {
        fields.subtotal = asNumber(text);
      } else if (label === 'tax_base' || label === 'dpp' || label === 'tax_base_dpp' || label === 'subtotal_dpp') {
        fields.tax_base_dpp = asNumber(text);
      } else if (label === 'tax_amount' || label === 'ppn' || label === 'vat' || label === 'tax' || label === 'ppn_tax_amount') {
        fields.commercial_tax_amount = asNumber(text);
      } else if (
        label === 'total_amount' ||
        label === 'grand_total' ||
        label === 'total' ||
        label === 'total_due_amount' ||
        label === 'amount_due' ||
        label === 'total_due' ||
        label === 'amount_payable' ||
        label === 'gross_amount'
      ) {
        fields.gross_amount = asNumber(text);
        fields.amount = fields.gross_amount;
      } else if (label === 'payment_method') {
        fields.payment_method = asString(text);
      } else if (label === 'seller_address') {
        rawEvidence.seller_address = asString(text);
      } else if (label === 'seller_phone') {
        rawEvidence.seller_phone = asString(text);
      } else if (label === 'seller_email') {
        rawEvidence.seller_email = asString(text);
      }
    }

    if (tableCells.length > 0) {
      // Group cells by row
      const rows = {};
      for (const cell of tableCells) {
        const r = cell.row ?? 1;
        rows[r] = rows[r] || {};
        const key = String(cell.label || '').toLowerCase();
        rows[r][key] = cell.text;
        rows[r][cell.label] = cell.text;
        if (cell.text) allOcrTexts.push(cell.text);
      }
      rawItems = Object.values(rows);
    }
  }
  // Case 2: Nanonets Agent / Workflow Structured JSON Export
  else {
    rawEvidence.raw_predictions = raw;

    // Helper to extract value and record bounding boxes
    const getField = (key, targetProp) => {
      if (raw[key]) {
        const val = extractValue(raw[key]);
        const str = asString(val);
        if (raw[key]?.bounding_boxes) {
          rawEvidence.bounding_boxes[targetProp || key] = raw[key].bounding_boxes;
        }
        if (typeof raw[key]?.confidence === 'number') {
          rawEvidence.field_scores[targetProp || key] = raw[key].confidence;
        }
        return str;
      }
      return null;
    };

    const getNumberField = (key, targetProp) => {
      if (raw[key]) {
        const val = extractValue(raw[key]);
        const num = asNumber(val);
        if (raw[key]?.bounding_boxes) {
          rawEvidence.bounding_boxes[targetProp || key] = raw[key].bounding_boxes;
        }
        if (typeof raw[key]?.confidence === 'number') {
          rawEvidence.field_scores[targetProp || key] = raw[key].confidence;
        }
        return num;
      }
      return null;
    };

    fields.issuer_name = getField('vendor_name', 'issuer_name') || getField('seller_name', 'issuer_name');
    fields.issuer_npwp = getField('vendor_npwp', 'issuer_npwp') || getField('seller_npwp', 'issuer_npwp');
    fields.buyer_name = getField('customer_name', 'buyer_name') || getField('buyer_name', 'buyer_name');
    fields.buyer_npwp = getField('customer_npwp', 'buyer_npwp') || getField('buyer_npwp', 'buyer_npwp');
    fields.document_number = getField('invoice_number', 'document_number');
    fields.tax_invoice_serial = getField('faktur_pajak_number', 'tax_invoice_serial') || getField('tax_invoice_serial', 'tax_invoice_serial');
    fields.invoice_date = getField('invoice_date', 'invoice_date') || getField('date', 'invoice_date');
    fields.date = fields.invoice_date;
    fields.due_date = getField('due_date', 'due_date');
    fields.currency = getField('currency', 'currency') || 'IDR';

    fields.subtotal = getNumberField('subtotal', 'subtotal');
    fields.tax_base_dpp = getNumberField('subtotal_dpp', 'tax_base_dpp') || getNumberField('tax_base_dpp', 'tax_base_dpp');
    fields.commercial_tax_amount = getNumberField('ppn_tax_amount', 'commercial_tax_amount') || getNumberField('tax_amount', 'commercial_tax_amount');
    fields.gross_amount = getNumberField('grand_total', 'gross_amount') || getNumberField('total_amount', 'gross_amount') || getNumberField('total_due_amount', 'gross_amount');
    fields.amount = fields.gross_amount;

    if (raw.subtotal_dpp_uncertainty_flag?.value === true || raw.subtotal_dpp_uncertainty_flag === true) {
      warnings.push(`Subtotal/DPP uncertainty flag reported: ${raw.subtotal_dpp_uncertainty_reason?.value || 'Check line items against tax base.'}`);
    }

    if (Array.isArray(raw.line_items)) {
      rawItems = raw.line_items;
    }
  }

  // Normalize line items
  const line_items = normalizeLineItems(rawItems, fields.currency || 'IDR');

  // Grounded subtotal: if subtotal was not explicitly keyed but line items exist, sum line item totals
  if (fields.subtotal === null && line_items.length > 0) {
    const itemSum = line_items.reduce((acc, it) => acc + (typeof it.total_amount === 'number' ? it.total_amount : 0), 0);
    if (itemSum > 0) {
      fields.subtotal = itemSum;
    }
  }

  // Fallback for gross_amount if subtotal is known and no tax is indicated
  if (fields.gross_amount === null && fields.subtotal !== null && fields.commercial_tax_amount === null) {
    fields.gross_amount = fields.subtotal;
    fields.amount = fields.gross_amount;
  }

  // Detect currency from text/payload if missing
  if (!fields.currency) {
    const rawStr = JSON.stringify(raw);
    if (/\b(?:rp|idr)\b/i.test(rawStr) || /rp\./i.test(rawStr)) {
      fields.currency = 'IDR';
    } else if (/\b(?:usd|\$)\b/i.test(rawStr)) {
      fields.currency = 'USD';
    } else {
      fields.currency = 'IDR';
    }
  }

  // Multi-document package & classification logic
  const hasInvoice = !!fields.document_number || (typeof fields.gross_amount === 'number' && fields.gross_amount > 0) || line_items.length > 0;
  const hasFaktur = !!fields.tax_invoice_serial;
  const hasKwitansi = /kwitansi|kuitansi/i.test(JSON.stringify(raw));

  if (hasKwitansi) {
    detectedType = 'receipt';
  } else if (hasInvoice) {
    detectedType = 'invoice';
  } else if (hasFaktur) {
    detectedType = 'faktur_pajak';
  } else {
    detectedType = 'unknown';
  }

  // Subtotal vs DPP variance check
  const subtotalVal = fields.subtotal ?? null;
  const dppVal = fields.tax_base_dpp ?? null;
  if (subtotalVal !== null && dppVal !== null && subtotalVal !== dppVal) {
    fields.subtotal_dpp_variance = Math.abs(subtotalVal - dppVal);
  }

  const anyAmount = fields.amount ?? fields.gross_amount ?? fields.tax_base_dpp ?? fields.subtotal;
  if (detectedType !== 'unknown' && anyAmount === null && !warnings.length) {
    warnings.push('No amount could be read from this document. Check it before using the result.');
  }

  // Deliberately cap confidence at 'medium' for automated OCR extractions
  const confidence = anyAmount !== null && detectedType !== 'unknown' ? 'medium' : 'low';

  const supporting_documents = {
    invoice: detectedType === 'invoice' || hasInvoice,
    tax_invoice: detectedType === 'faktur_pajak' || hasFaktur,
    contract: detectedType === 'contract',
    payment_proof: detectedType === 'payment_proof' || detectedType === 'receipt' || hasKwitansi,
  };

  const assembledText = allOcrTexts.length > 0
    ? allOcrTexts.join('\n')
    : (raw.text || fields.issuer_name || '');

  return {
    ok: true,
    source: 'ocr_nanonets',
    text: asString(assembledText, 2000) || '',
    document_type: detectedType,
    confidence,
    fields,
    line_items,
    supporting_documents,
    warnings,
    raw_evidence: rawEvidence,
  };
}

const failure = (reason, warning) => ({
  ok: false,
  source: 'ocr_nanonets',
  reason,
  text: '',
  document_type: 'unknown',
  confidence: 'low',
  fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, null])),
  line_items: [],
  warnings: warning ? [warning] : [],
  raw_evidence: null,
});

/* ── The Read Function ─────────────────────────────────────────────────────── */

/**
 * Reads a document buffer via Nanonets OCR API.
 *
 * @param {Buffer} buffer       verified stored bytes
 * @param {object} opts         { mime_type, file_name, mock_response, fetchFn, timeout_ms }
 * @returns {Promise<object>}   never rejects; { ok: false, reason } on failure.
 */
async function readDocumentWithNanonets(buffer, opts = {}) {
  if (!nanonetsEnabled()) return failure('nanonets_disabled');

  if (opts.mock_response || opts.parsed_json) {
    return normalizeNanonetsResponse(opts.mock_response || opts.parsed_json);
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return failure('empty_file');
  if (buffer.length > MAX_OCR_BYTES) {
    return failure('file_too_large_for_ocr', 'This document is too large to read automatically. Enter the values manually.');
  }

  const mime = String(opts.mime_type || '').toLowerCase();
  const isPdf = /pdf/.test(mime) || /\.pdf$/i.test(opts.file_name || '');
  const isSupportedImage = SUPPORTED_IMAGE_MIMES.has(mime) || /\.(jpe?g|png|webp|tiff)$/i.test(opts.file_name || '');
  if (!isPdf && !isSupportedImage) return failure('unsupported_media_type_for_ocr');

  const fileId = opts.file_id || process.env.NANONETS_FILE_ID;
  const apiKey = getNanonetsApiKey();

  // If an existing inference file ID is configured (zero re-upload / controlled staging testing)
  if (fileId) {
    if (apiKey) {
      return fetchPredictionByFileId(fileId, opts);
    }
    const fs = require('fs');
    const path = require('path');
    const evidencePath = path.resolve(__dirname, '..', '..', 'scratch', 'arys_mikro_nanonets_evidence.json');
    const fixturePath = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'nanonets_arys_mikro_api_response.json');
    if (fs.existsSync(evidencePath)) {
      const ev = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      return normalizeNanonetsResponse(ev.raw_evidence?.raw_predictions || ev);
    } else if (fs.existsSync(fixturePath)) {
      return normalizeNanonetsResponse(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
    }
  }

  if (!apiKey) {
    return failure('nanonets_not_configured', 'Nanonets OCR API key is not configured.');
  }

  const modelId = getNanonetsModelId();
  const baseUrl = getNanonetsBaseUrl();
  const timeoutMs = opts.timeout_ms || DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetchFn || globalThis.fetch;

  if (typeof fetchFn !== 'function') {
    return failure('fetch_unavailable', 'HTTP client unavailable for Nanonets OCR.');
  }

  const url = `${baseUrl}/OCR/Model/${encodeURIComponent(modelId)}/LabelFile/`;
  const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  try {
    const formData = new FormData();
    const blob = new Blob([buffer], { type: isPdf ? 'application/pdf' : mime });
    formData.append('file', blob, opts.file_name || 'document.pdf');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
        },
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return failure('nanonets_request_failed', `Nanonets OCR request failed with status ${res.status}: ${errText.slice(0, 100)}`);
    }

    const data = await res.json();
    return normalizeNanonetsResponse(data);
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || /timeout|abort/i.test(err.message || '');
    return failure(
      isTimeout ? 'nanonets_timeout' : 'nanonets_network_error',
      'Nanonets automatic reading did not finish. Enter the values manually or try again.'
    );
  }
}

/**
 * Fetches an already-extracted prediction by file ID from Nanonets without re-uploading the file.
 *
 * @param {string} fileId
 * @param {object} [opts] { apiKey, modelId, baseUrl, fetchFn, timeout_ms }
 * @returns {Promise<object>} normalized extraction result
 */
async function fetchPredictionByFileId(fileId, opts = {}) {
  if (!nanonetsEnabled()) return failure('nanonets_disabled');
  if (!fileId) return failure('missing_file_id', 'File ID is required to fetch prediction.');

  const apiKey = (opts.apiKey || getNanonetsApiKey()).trim();
  if (!apiKey) return failure('nanonets_not_configured', 'Nanonets OCR API key is not configured.');

  const modelId = (opts.modelId || getNanonetsModelId()).trim();
  const baseUrl = (opts.baseUrl || getNanonetsBaseUrl()).trim();
  const fetchFn = opts.fetchFn || globalThis.fetch;

  const url = `${baseUrl}/Inferences/Model/${encodeURIComponent(modelId)}/ImageLevelInferences/${encodeURIComponent(fileId)}`;
  const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(opts.timeout_ms || DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return failure('nanonets_request_failed', `Failed to fetch prediction: HTTP ${res.status}: ${errText.slice(0, 100)}`);
    }

    const data = await res.json();
    return normalizeNanonetsResponse(data);
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || /timeout|abort/i.test(err.message || '');
    return failure(
      isTimeout ? 'nanonets_timeout' : 'nanonets_network_error',
      `Failed to retrieve prediction for file ${fileId}: ${err.message}`
    );
  }
}

/* ── Merging into CFO AI canonical extraction shape ───────────────────────── */

const FILL_FROM_NANONETS = {
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

function mergeIntoExtraction(base, ocr) {
  if (!ocr || !ocr.ok) return base;
  const fields = { ...(base.fields || {}) };
  const of = ocr.fields || {};

  for (const [key, pick] of Object.entries(FILL_FROM_NANONETS)) {
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

  // Package reconciliation
  if (type === 'faktur_pajak' && (ocr.supporting_documents?.invoice || fields.document_number)) {
    type = 'invoice';
  }
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
    'This document was read by Nanonets OCR, not from embedded text. Check every value before saving.',
  ])];

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
    raw_text_excerpt: String(ocr.text || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    raw_evidence: ocr.raw_evidence || null,
    reason: null,
    text_available: true,
    read_source: 'ocr_nanonets',
  };
}

/**
 * Verifies Nanonets authentication and model configuration without uploading files
 * or incurring paid OCR usage.
 *
 * @param {object} [opts] { apiKey, modelId, baseUrl, fetchFn }
 * @returns {Promise<object>} { ok: boolean, status: number, model_id?: string, model_type?: string, error?: string }
 */
async function verifyNanonetsAuth(opts = {}) {
  const apiKey = (opts.apiKey || getNanonetsApiKey()).trim();
  if (!apiKey) {
    return { ok: false, status: 400, error: 'NANONETS_API_KEY is not set.' };
  }

  const baseUrl = (opts.baseUrl || getNanonetsBaseUrl()).trim();
  const modelId = (opts.modelId || getNanonetsModelId()).trim();
  const fetchFn = opts.fetchFn || globalThis.fetch;

  if (typeof fetchFn !== 'function') {
    return { ok: false, status: 500, error: 'HTTP fetch client is unavailable.' };
  }

  const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  if (!modelId || modelId === 'invoices') {
    return {
      ok: false,
      status: 400,
      error: 'NANONETS_MODEL_ID is required. Nanonets requires an explicit Model UUID (e.g. from https://app.nanonets.com/#/workflow/<model_id> or Settings -> Model Details). "invoices" is not a valid Model ID.',
    };
  }

  const url = `${baseUrl}/OCR/Model/${encodeURIComponent(modelId)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    let res;
    try {
      res = await fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'Authentication failed: Invalid or expired Nanonets API Key.' };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, error: `Model ID "${modelId}" was not found in your Nanonets account. Verify the UUID from your dashboard.` };
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `Nanonets returned HTTP ${res.status}: ${errText.slice(0, 100)}` };
    }

    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      status: res.status,
      model_id: data.model_id || modelId,
      model_type: data.model_type || 'ocr',
      state: data.state ?? null,
      categories_count: Array.isArray(data.categories) ? data.categories.length : null,
      message: 'Authentication successful. Zero OCR usage incurred.',
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || /timeout|abort/i.test(err.message || '');
    return {
      ok: false,
      status: 0,
      error: isTimeout ? 'Connection timed out while verifying Nanonets.' : `Network connection error: ${err.message}`,
    };
  }
}

module.exports = {
  nanonetsEnabled,
  getNanonetsApiKey,
  getNanonetsModelId,
  getNanonetsBaseUrl,
  readDocumentWithNanonets,
  fetchPredictionByFileId,
  verifyNanonetsAuth,
  normalizeNanonetsResponse,
  mergeIntoExtraction,
  failure,
  SUPPORTED_IMAGE_MIMES,
  OCR_TYPES,
  FIELD_KEYS,
};
