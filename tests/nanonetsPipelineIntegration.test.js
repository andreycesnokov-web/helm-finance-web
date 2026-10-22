'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const nanonetsOcr = require('../server/lib/nanonetsOcr');
// Portable synthetic image-only input; provider output below is explicitly mocked.
// Do not require or read the owner's original invoice for an offline RC gate.
const PDF_PATH = path.join(__dirname, 'fixtures', 'synthetic_invoice_pure_image_scan.pdf');

test('Nanonets Pipeline Integration: Image-only PDF intake mapping & review shape', async () => {
  assert.ok(fs.existsSync(PDF_PATH), 'Committed synthetic image-only PDF must exist');
  const pdfBuf = fs.readFileSync(PDF_PATH);

  // Mock Nanonets response for Ary's mikro
  const mockNanonetsResult = {
    message: 'Success',
    result: [
      {
        message: 'Success',
        input: "Ary's mikro.pdf",
        prediction: [
          { label: 'seller_name', ocr_text: "Ary's mikro", score: 0.98 },
          { label: 'seller_address', ocr_text: 'Jl. Raya celuk No 8 X Sukawati - Gianyar', score: 0.94 },
          { label: 'total_amount', ocr_text: '4500000', score: 0.99 },
          { label: 'subtotal', ocr_text: '4500000', score: 0.95 },
          { label: 'currency', ocr_text: 'IDR', score: 0.99 },
          { label: 'invoice_date', ocr_text: '2026-08-25', score: 0.96 },
          {
            label: 'table',
            type: 'table',
            cells: [
              { row: 1, label: 'description', text: 'Sewa Tempat Helm Care di Arys mikro', score: 0.97 },
              { row: 1, label: 'quantity', text: '1', score: 0.99 },
              { row: 1, label: 'price', text: '4500000', score: 0.98 },
              { row: 1, label: 'total', text: '4500000', score: 0.98 }
            ]
          }
        ]
      }
    ]
  };

  const origFlag = process.env.DOCUMENT_OCR_NANONETS_ENABLED;
  try {
    process.env.DOCUMENT_OCR_NANONETS_ENABLED = 'true';

    // 1. Read document via Nanonets adapter with mock response (offline integration verification)
    const ocr = await nanonetsOcr.readDocumentWithNanonets(pdfBuf, {
      mime_type: 'application/pdf',
      file_name: "Ary's mikro.pdf",
      mock_response: mockNanonetsResult,
    });

    assert.equal(ocr.ok, true);
    assert.equal(ocr.source, 'ocr_nanonets');
    assert.equal(ocr.document_type, 'invoice');

    // 2. Base extraction shape for an image-only PDF (no embedded text)
    const baseExtraction = {
      document_type: 'unknown',
      confidence: 'needs_review',
      fields: {
        document_number: null,
        issuer_name: null,
        buyer_name: null,
        gross_amount: null,
        currency: 'IDR',
        subtotal: null,
        commercial_tax_amount: null,
      },
      missing_fields: ['document_number', 'issuer_name', 'gross_amount'],
      warnings: [],
    };

    // 3. Merge into CFO AI extraction shape
    const merged = nanonetsOcr.mergeIntoExtraction(baseExtraction, ocr);

    // Verify UI mapping and invariants
    assert.equal(merged.read_source, 'ocr_nanonets');
    assert.equal(merged.status, 'suggested');
    assert.ok(['medium', 'needs_review', 'low'].includes(merged.confidence), 'Confidence must be capped and require review');
    assert.equal(merged.fields.issuer_name, "Ary's mikro");
    assert.equal(merged.fields.gross_amount, 4500000);
    assert.equal(merged.fields.subtotal, 4500000);
    assert.equal(merged.fields.currency, 'IDR');
    assert.equal(merged.fields.commercial_tax_amount, null); // Non-inferred PPN rule

    // Verify structured line items mapped into UI workbench
    assert.equal(Array.isArray(merged.line_items), true);
    assert.equal(merged.line_items.length, 1);
    assert.equal(merged.line_items[0].description, 'Sewa Tempat Helm Care di Arys mikro');
    assert.equal(merged.line_items[0].quantity, 1);
    assert.equal(merged.line_items[0].unit_price, 4500000);
    assert.equal(merged.line_items[0].total_amount, 4500000);

    // Verify raw evidence is retained for UI citation inspector
    assert.ok(merged.raw_evidence, 'Raw evidence must be preserved');
    assert.ok(merged.raw_evidence.raw_predictions, 'Predictions must be stored in raw_evidence');

    // Verify disclaimer warning is presented for UI display
    assert.ok(merged.warnings.some((w) => /read by Nanonets OCR/i.test(w)));
  } finally {
    if (origFlag !== undefined) process.env.DOCUMENT_OCR_NANONETS_ENABLED = origFlag;
    else delete process.env.DOCUMENT_OCR_NANONETS_ENABLED;
  }
});
