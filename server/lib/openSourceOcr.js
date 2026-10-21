'use strict';
/**
 * CFO AI — Open-Source OCR Pipeline Adapter
 *
 * Integrates local high-speed PaddleOCR / RapidOCR microservice with
 * CFO AI document extraction and layout-aware Indonesian accounting extractor.
 *
 * CORE SAFETY INVARIANTS:
 * 1. Zero auto-posting: All extractions are tagged 'needs_accountant_review' with
 *    is_auto_posted: false and is_approved: false.
 * 2. Zero unexpected spend: Cost is $0.00 for self-hosted. Automatic paid fallback is
 *    HARD-BLOCKED unless OCR_ALLOW_PAID_FALLBACK === 'true'.
 * 3. Tier-0 Native PDF Bypass: If a PDF contains digital text, text is parsed directly
 *    without invoking OCR models.
 * 4. Spatial Provenance: Bounding boxes and confidence metrics are preserved per field.
 * 5. PII-Free Audit Logging: Telemetry logs metadata only (durations, counts, types),
 *    never tax IDs (NPWP), counterparty names, or financial numbers.
 */

const { extractPdfText } = require('./pdfText');
const { extractFromText } = require('./documentExtraction');
const { extractDocumentV2 } = require('./layoutAwareExtractor');

const DEFAULT_WORKER_URL = process.env.PADDLEOCR_WORKER_URL || process.env.OCR_WORKER_URL || 'http://127.0.0.1:55480';
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_DPI = 200;

/**
 * PII-free audit logging helper for OCR executions.
 * Emits telemetry without sensitive company or individual identifiers.
 *
 * @param {object} meta
 */
function logOcrAudit(meta = {}) {
  const payload = {
    event: 'cfo_ocr_execution',
    timestamp: new Date().toISOString(),
    provider: meta.provider || 'rapidocr',
    document_type: meta.documentType || 'unknown',
    page_count: Number(meta.pageCount) || 1,
    field_count: Number(meta.fieldCount) || 0,
    average_confidence: Number(meta.averageConfidence) || 0.0,
    processing_time_ms: Number(meta.processingTimeMs) || 0,
    cost_usd: Number(meta.costUsd) || 0.0,
    status: meta.status || 'needs_accountant_review'
  };

  // Structured logging to stdout/logger
  console.log(`[open-source-ocr][audit] ${JSON.stringify(payload)}`);
  return payload;
}

/**
 * Checks connectivity and health of the open-source OCR worker.
 *
 * @param {string} [workerUrl]
 * @returns {Promise<{ healthy: boolean, engine?: string, error?: string }>}
 */
async function checkWorkerHealth(workerUrl = DEFAULT_WORKER_URL) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${workerUrl}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { healthy: false, error: `HTTP ${resp.status}` };
    }
    const data = await resp.json().catch(() => ({}));
    return {
      healthy: data.status === 'healthy',
      engine: data.engine || 'PaddleOCR PP-OCRv4 (ONNX Runtime)',
      license: data.license || 'Apache-2.0'
    };
  } catch (err) {
    return {
      healthy: false,
      error: err.name === 'AbortError' ? 'Healthcheck timeout (5s)' : err.message
    };
  }
}

/**
 * Extract structured accounting fields using the open-source OCR pipeline.
 *
 * @param {Buffer} fileBuffer - Document raw binary buffer
 * @param {string} mimeType - e.g. 'application/pdf', 'image/png', 'image/jpeg'
 * @param {object} [options]
 * @param {string} [options.fileName]
 * @param {string} [options.provider] - 'paddleocr' | 'rapidocr' (default: 'rapidocr')
 * @param {string} [options.workerUrl]
 * @param {boolean} [options.allowPaidFallback] - default: false (controlled by OCR_ALLOW_PAID_FALLBACK)
 * @param {number} [options.timeoutMs]
 * @param {number} [options.dpi]
 * @returns {Promise<object>} Standardized ExtractionResult
 */
async function extractDocumentOpenSource(fileBuffer, mimeType, options = {}) {
  const startTime = Date.now();
  const fileName = options.fileName || 'document';
  const provider = options.provider || process.env.DOCUMENT_OCR_PROVIDER || 'rapidocr';
  const workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const dpi = options.dpi || DEFAULT_DPI;
  const allowPaidFallback = options.allowPaidFallback === true || process.env.OCR_ALLOW_PAID_FALLBACK === 'true';

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    return {
      ok: false,
      error: 'Empty or invalid file buffer provided.',
      code: 'EMPTY_BUFFER',
      provider,
      status: 'needs_manual_review',
      needs_accountant_review: true,
      costUsd: 0,
      processingTimeMs: 0
    };
  }

  const isPdf = (mimeType && mimeType.toLowerCase().includes('pdf')) ||
                fileName.toLowerCase().endsWith('.pdf') ||
                fileBuffer.subarray(0, 5).toString('latin1') === '%PDF-';

  // ── TIER 0: Native PDF Text Extraction Bypass ──────────────────────────────
  // If the document is a digital PDF containing readable text, extract immediately
  // without launching OCR models, consuming zero GPU/CPU inference cycles.
  if (isPdf) {
    try {
      const pdfTextResult = extractPdfText(fileBuffer);
      if (pdfTextResult && pdfTextResult.text_available && pdfTextResult.text && pdfTextResult.text.length >= 40) {
        const textExtract = extractFromText(pdfTextResult.text);
        const processingTimeMs = Date.now() - startTime;

        const result = {
          ok: true,
          provider: 'native_pdf',
          documentType: textExtract.document_type || 'unknown',
          fields: textExtract.fields || {},
          lineItems: textExtract.line_items || [],
          confidence: textExtract.confidence === 'high' ? 0.98 : (textExtract.confidence === 'medium' ? 0.85 : 0.65),
          confidenceLevel: textExtract.confidence || 'medium',
          processingTimeMs,
          costUsd: 0.0,
          provenance: {
            method: 'native_pdf_text_layer',
            character_count: pdfTextResult.text.length
          },
          missingFields: textExtract.missing_fields || [],
          warnings: textExtract.warnings || [],
          status: 'needs_accountant_review',
          is_auto_posted: false,
          is_approved: false,
          raw_text_excerpt: String(pdfTextResult.text || '').replace(/\s+/g, ' ').trim().slice(0, 600),
          accounting_notice: 'Zero auto-posting guaranteed. Human accountant confirmation required.'
        };

        logOcrAudit({
          provider: 'native_pdf',
          processingTimeMs,
          pageCount: 1,
          documentType: result.documentType,
          fieldCount: Object.values(result.fields).filter(v => v !== null && v !== undefined).length,
          averageConfidence: result.confidence,
          costUsd: 0.0,
          status: result.status
        });

        return result;
      }
    } catch (nativeErr) {
      // Fail open: proceed to OCR worker if native PDF extraction encounters an issue
    }
  }

  // ── TIER 1: Open-Source OCR Worker (RapidOCR PP-OCRv4 ONNX) ──────────────────
  try {
    const formData = new FormData();
    const effectiveMime = isPdf ? 'application/pdf' : (mimeType || 'image/png');
    formData.append('file', new Blob([fileBuffer], { type: effectiveMime }), fileName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let ocrResponse;
    try {
      const resp = await fetch(`${workerUrl}/ocr/predict?dpi=${dpi}`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      if (!resp.ok) {
        throw new Error(`Worker returned HTTP ${resp.status}`);
      }
      ocrResponse = await resp.json();
    } finally {
      clearTimeout(timer);
    }

    // Process recognized lines with layout-aware spatial 2D extractor
    const v2Result = extractDocumentV2(ocrResponse);
    const processingTimeMs = Date.now() - startTime;

    // Field alias normalization (cross-compatibility between documentExtraction.js and layoutAwareExtractor.js)
    const f = v2Result.fields || {};
    f.commercial_base_amount = f.tax_base_dpp ?? f.commercial_base_amount ?? null;
    f.commercial_tax_amount = f.tax_amount ?? f.commercial_tax_amount ?? null;
    f.amount = f.gross_amount ?? f.amount ?? null;
    f.tax_base_dpp = f.tax_base_dpp ?? f.commercial_base_amount ?? null;
    f.tax_amount = f.tax_amount ?? f.commercial_tax_amount ?? null;
    f.gross_amount = f.gross_amount ?? f.amount ?? null;

    // Calculate average OCR confidence across pages
    let totalConf = 0;
    let pageCount = (ocrResponse.pages && ocrResponse.pages.length) || 1;
    if (ocrResponse.pages && ocrResponse.pages.length > 0) {
      for (const p of ocrResponse.pages) {
        totalConf += (p.avg_confidence || 0.85);
      }
      totalConf = totalConf / ocrResponse.pages.length;
    } else {
      totalConf = 0.90;
    }

    const fieldCount = Object.values(f).filter(v => v !== null && v !== undefined).length;

    // Structured line items: statement transactions or invoice line items
    const lineItems = f.transactions || f.statement_rows || f.line_items || [];

    const result = {
      ok: true,
      provider,
      documentType: v2Result.document_type || 'unknown',
      fields: f,
      lineItems,
      confidence: Math.round(totalConf * 100) / 100,
      confidenceLevel: v2Result.confidence || 'medium',
      processingTimeMs,
      costUsd: 0.0, // Always $0.00 for self-hosted ONNX engine
      provenance: v2Result.evidence || {},
      missingFields: v2Result.missing_fields || [],
      warnings: v2Result.warnings || [],
      status: 'needs_accountant_review',
      is_auto_posted: false,
      is_approved: false,
      raw_text_excerpt: String(ocrResponse.full_text || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      accounting_notice: 'Zero auto-posting guaranteed. Human accountant confirmation required.'
    };

    logOcrAudit({
      provider,
      processingTimeMs,
      pageCount,
      documentType: result.documentType,
      fieldCount,
      averageConfidence: result.confidence,
      costUsd: 0.0,
      status: result.status
    });

    return result;

  } catch (workerErr) {
    const isTimeout = workerErr.name === 'AbortError' || /timeout/i.test(workerErr.message || '');
    const errorMsg = isTimeout ? `OCR worker timed out after ${timeoutMs}ms` : workerErr.message;

    // ── TIER 2: Fallback Handling ───────────────────────────────────────────
    if (allowPaidFallback) {
      try {
        const nanonets = require('./nanonetsOcr');
        if (nanonets && typeof nanonets.readDocumentWithNanonets === 'function' && nanonets.nanonetsEnabled()) {
          console.warn(`[open-source-ocr] Worker failed (${errorMsg}). Authorized paid fallback to Nanonets initiated.`);
          const nanoRes = await nanonets.readDocumentWithNanonets(fileBuffer, {
            mime_type: mimeType,
            file_name: fileName
          });

          if (nanoRes && nanoRes.ok) {
            const processingTimeMs = Date.now() - startTime;
            const fieldCount = Object.values(nanoRes.fields || {}).filter(v => v !== null && v !== undefined).length;

            const result = {
              ok: true,
              provider: 'nanonets_paid_fallback',
              documentType: nanoRes.document_type || 'unknown',
              fields: nanoRes.fields || {},
              lineItems: nanoRes.line_items || [],
              confidence: nanoRes.confidence === 'high' ? 0.95 : (nanoRes.confidence === 'medium' ? 0.85 : 0.65),
              confidenceLevel: nanoRes.confidence || 'medium',
              processingTimeMs,
              costUsd: 0.15, // Nanonets list pricing per page
              provenance: nanoRes.raw_evidence || {},
              missingFields: nanoRes.missing_fields || [],
              warnings: [
                ...(nanoRes.warnings || []),
                'Worker failed; fallback to Nanonets paid provider was authorized.'
              ],
              status: 'needs_accountant_review',
              is_auto_posted: false,
              is_approved: false,
              raw_text_excerpt: String(nanoRes.text || '').slice(0, 600),
              accounting_notice: 'Zero auto-posting guaranteed. Human accountant confirmation required.'
            };

            logOcrAudit({
              provider: 'nanonets_paid_fallback',
              processingTimeMs,
              pageCount: 1,
              documentType: result.documentType,
              fieldCount,
              averageConfidence: result.confidence,
              costUsd: 0.15,
              status: result.status
            });

            return result;
          }
        }
      } catch (fallbackErr) {
        console.error(`[open-source-ocr] Paid fallback failed: ${fallbackErr.message}`);
      }
    }

    // Default safe failure: return informative error with zero cost and manual review flag
    const elapsed = Date.now() - startTime;
    return {
      ok: false,
      error: `Open-source OCR worker unavailable (${errorMsg}). Automatic paid fallback is blocked to prevent unapproved charges.`,
      code: 'OCR_WORKER_UNAVAILABLE',
      provider,
      status: 'needs_manual_review',
      needs_accountant_review: true,
      is_auto_posted: false,
      is_approved: false,
      costUsd: 0.0,
      processingTimeMs: elapsed,
      accounting_notice: 'Please enter document values manually or verify the OCR worker service status.'
    };
  }
}

module.exports = {
  extractDocumentOpenSource,
  checkWorkerHealth,
  logOcrAudit,
  DEFAULT_WORKER_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_DPI
};
