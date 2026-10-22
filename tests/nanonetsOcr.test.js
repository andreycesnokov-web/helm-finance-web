'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Nanonets = require('../server/lib/nanonetsOcr');

const DUMMY_PDF = Buffer.from('%PDF-1.4 dummy content');

test('Nanonets OCR: returns nanonets_disabled when flag is OFF', async () => {
  const orig = process.env.DOCUMENT_OCR_NANONETS_ENABLED;
  try {
    delete process.env.DOCUMENT_OCR_NANONETS_ENABLED;
    const res = await Nanonets.readDocumentWithNanonets(DUMMY_PDF, { mime_type: 'application/pdf' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'nanonets_disabled');
    assert.equal(res.source, 'ocr_nanonets');
    assert.equal(res.document_type, 'unknown');
  } finally {
    if (orig !== undefined) process.env.DOCUMENT_OCR_NANONETS_ENABLED = orig;
  }
});

test('Nanonets OCR: returns nanonets_not_configured when key is missing', async () => {
  const origFlag = process.env.DOCUMENT_OCR_NANONETS_ENABLED;
  const origKey = process.env.NANONETS_API_KEY;
  try {
    process.env.DOCUMENT_OCR_NANONETS_ENABLED = 'true';
    delete process.env.NANONETS_API_KEY;

    const res = await Nanonets.readDocumentWithNanonets(DUMMY_PDF, { mime_type: 'application/pdf' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'nanonets_not_configured');
  } finally {
    if (origFlag !== undefined) process.env.DOCUMENT_OCR_NANONETS_ENABLED = origFlag;
    else delete process.env.DOCUMENT_OCR_NANONETS_ENABLED;
    if (origKey !== undefined) process.env.NANONETS_API_KEY = origKey;
  }
});

test('Nanonets OCR: rejects empty and oversized files', async () => {
  const origFlag = process.env.DOCUMENT_OCR_NANONETS_ENABLED;
  const origKey = process.env.NANONETS_API_KEY;
  try {
    process.env.DOCUMENT_OCR_NANONETS_ENABLED = 'true';
    process.env.NANONETS_API_KEY = 'test_key';

    const empty = await Nanonets.readDocumentWithNanonets(Buffer.alloc(0), { mime_type: 'application/pdf' });
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, 'empty_file');

    const big = Buffer.alloc(9 * 1024 * 1024);
    const oversized = await Nanonets.readDocumentWithNanonets(big, { mime_type: 'application/pdf' });
    assert.equal(oversized.ok, false);
    assert.equal(oversized.reason, 'file_too_large_for_ocr');

    const unsupp = await Nanonets.readDocumentWithNanonets(DUMMY_PDF, { mime_type: 'text/csv', file_name: 'test.csv' });
    assert.equal(unsupp.ok, false);
    assert.equal(unsupp.reason, 'unsupported_media_type_for_ocr');
  } finally {
    if (origFlag !== undefined) process.env.DOCUMENT_OCR_NANONETS_ENABLED = origFlag;
    else delete process.env.DOCUMENT_OCR_NANONETS_ENABLED;
    if (origKey !== undefined) process.env.NANONETS_API_KEY = origKey;
    else delete process.env.NANONETS_API_KEY;
  }
});

test('Nanonets OCR: parses Standard Prediction API schema with table cells', () => {
  const standardPayload = {
    message: 'Success',
    result: [
      {
        message: 'Success',
        input: 'invoice_test.pdf',
        prediction: [
          { label: 'invoice_number', ocr_text: 'INV-2026-001', score: 0.98 },
          { label: 'seller_name', ocr_text: 'PT Vendor Sukses', score: 0.95 },
          { label: 'buyer_name', ocr_text: 'PT Helm Care Indonesia', score: 0.94 },
          { label: 'seller_tax_id', ocr_text: '01.234.567.8-901.000', score: 0.96 },
          { label: 'buyer_tax_id', ocr_text: '98.765.432.1-012.000', score: 0.93 },
          { label: 'invoice_date', ocr_text: '2026-09-15', score: 0.97 },
          { label: 'due_date', ocr_text: '2026-09-30', score: 0.92 },
          { label: 'currency', ocr_text: 'IDR', score: 0.99 },
          { label: 'subtotal', ocr_text: '10.000.000', score: 0.95 },
          { label: 'tax_amount', ocr_text: '1.200.000', score: 0.91 },
          { label: 'total_amount', ocr_text: '11.200.000', score: 0.98 },
          {
            label: 'table',
            type: 'table',
            cells: [
              { row: 1, label: 'item_name', text: 'Software Consulting', score: 0.95 },
              { row: 1, label: 'quantity', text: '2', score: 0.99 },
              { row: 1, label: 'price', text: '5.000.000', score: 0.94 },
              { row: 1, label: 'total', text: '10.000.000', score: 0.96 }
            ]
          }
        ]
      }
    ]
  };

  const res = Nanonets.normalizeNanonetsResponse(standardPayload);
  assert.equal(res.ok, true);
  assert.equal(res.source, 'ocr_nanonets');
  assert.equal(res.document_type, 'invoice');
  assert.equal(res.confidence, 'medium'); // Capped at medium
  assert.equal(res.fields.document_number, 'INV-2026-001');
  assert.equal(res.fields.issuer_name, 'PT Vendor Sukses');
  assert.equal(res.fields.buyer_name, 'PT Helm Care Indonesia');
  assert.equal(res.fields.issuer_npwp, '01.234.567.8-901.000');
  assert.equal(res.fields.subtotal, 10000000);
  assert.equal(res.fields.commercial_tax_amount, 1200000);
  assert.equal(res.fields.gross_amount, 11200000);
  assert.equal(res.fields.amount, 11200000);

  // Line items
  assert.equal(res.line_items.length, 1);
  assert.equal(res.line_items[0].description, 'Software Consulting');
  assert.equal(res.line_items[0].quantity, 2);
  assert.equal(res.line_items[0].unit_price, 5000000);
  assert.equal(res.line_items[0].total_amount, 10000000);
});

test('Nanonets OCR: parses Agent JSON export (Circle K benchmark schema)', () => {
  const agentPayload = {
    vendor_name: { value: 'PT. Circleka Indonesia Utama' },
    vendor_npwp: { value: '0020797445007000' },
    customer_name: { value: 'PT. HELM CARE INDONESIA' },
    customer_npwp: { value: '0280145224415000' },
    invoice_number: { value: 'X2610001139' },
    faktur_pajak_number: { value: '0400260010010123' },
    invoice_date: { value: '2026-09-10' },
    due_date: { value: '2026-09-24' },
    currency: { value: 'IDR' },
    subtotal: { value: '143.856.000.00' },
    subtotal_dpp: { value: '129.600.000.00' },
    ppn_tax_amount: { value: '14.256.000.00' },
    grand_total: { value: '143.856.000.00' },
    subtotal_dpp_uncertainty_flag: { value: true },
    subtotal_dpp_uncertainty_reason: { value: 'Listing fee subtotal differs from tax base DPP.' },
    line_items: [
      {
        item_number: { value: '1' },
        description: { value: 'Listing Fee - Bali Store Network' },
        quantity: { value: '1' },
        unit_price: { value: '143856000' },
        total_price: { value: '143856000' }
      }
    ]
  };

  const res = Nanonets.normalizeNanonetsResponse(agentPayload);
  assert.equal(res.ok, true);
  assert.equal(res.document_type, 'invoice');
  assert.equal(res.fields.document_number, 'X2610001139');
  assert.equal(res.fields.tax_invoice_serial, '0400260010010123');
  assert.equal(res.fields.issuer_name, 'PT. Circleka Indonesia Utama');
  assert.equal(res.fields.issuer_npwp, '0020797445007000');
  assert.equal(res.fields.buyer_name, 'PT. HELM CARE INDONESIA');
  assert.equal(res.fields.subtotal, 143856000);
  assert.equal(res.fields.tax_base_dpp, 129600000);
  assert.equal(res.fields.commercial_tax_amount, 14256000);
  assert.equal(res.fields.gross_amount, 143856000);

  // Variance check preserved
  assert.equal(res.fields.subtotal_dpp_variance, 14256000);

  // Warning preserved
  assert.ok(res.warnings.some((w) => /Listing fee subtotal differs from tax base DPP/i.test(w)));

  // Line items
  assert.equal(res.line_items.length, 1);
  assert.equal(res.line_items[0].description, 'Listing Fee - Bali Store Network');
  assert.equal(res.line_items[0].quantity, 1);
  assert.equal(res.line_items[0].total_amount, 143856000);
});

test('Nanonets OCR: never infers PPN, DPP, or NPWP when absent from output', () => {
  const minimalPayload = {
    vendor_name: { value: 'Toko Elektronik Makmur' },
    invoice_number: { value: 'INV-99' },
    grand_total: { value: '500000' }
  };

  const res = Nanonets.normalizeNanonetsResponse(minimalPayload);
  assert.equal(res.ok, true);
  assert.equal(res.fields.issuer_name, 'Toko Elektronik Makmur');
  assert.equal(res.fields.gross_amount, 500000);
  assert.equal(res.fields.tax_base_dpp, null);
  assert.equal(res.fields.commercial_tax_amount, null);
  assert.equal(res.fields.subtotal, null);
  assert.equal(res.fields.issuer_npwp, null);
  assert.equal(res.fields.buyer_npwp, null);
});

test('Nanonets OCR: merges into CFO AI extraction and caps confidence at medium', () => {
  const baseExtraction = {
    document_type: 'unknown',
    confidence: 'medium',
    fields: {
      document_number: null,
      issuer_name: null,
      buyer_name: null,
      gross_amount: null,
      currency: 'IDR'
    },
    missing_fields: ['document_number', 'issuer_name', 'gross_amount'],
    warnings: []
  };

  const ocrResult = {
    ok: true,
    source: 'ocr_nanonets',
    document_type: 'invoice',
    confidence: 'high', // Will be capped to medium
    fields: {
      document_number: 'INV-888',
      issuer_name: 'PT Mitra Sukses',
      buyer_name: 'PT Helm Care',
      gross_amount: 2500000,
      currency: 'IDR'
    },
    line_items: [
      { item_number: 1, description: 'Office Equipment', quantity: 1, unit_price: 2500000, total_amount: 2500000, currency: 'IDR' }
    ],
    warnings: ['Low confidence on invoice_date']
  };

  const merged = Nanonets.mergeIntoExtraction(baseExtraction, ocrResult);
  assert.equal(merged.document_type, 'invoice');
  assert.equal(merged.confidence, 'medium'); // capped at medium
  assert.equal(merged.read_source, 'ocr_nanonets');
  assert.equal(merged.status, 'suggested');
  assert.equal(merged.fields.document_number, 'INV-888');
  assert.equal(merged.fields.issuer_name, 'PT Mitra Sukses');
  assert.equal(merged.fields.gross_amount, 2500000);
  assert.equal(merged.line_items.length, 1);
  assert.ok(merged.warnings.some((w) => /read by Nanonets OCR/i.test(w)));
});

test('Nanonets OCR: handles simulated timeout and network error via fetchFn', async () => {
  const origFlag = process.env.DOCUMENT_OCR_NANONETS_ENABLED;
  const origKey = process.env.NANONETS_API_KEY;
  try {
    process.env.DOCUMENT_OCR_NANONETS_ENABLED = 'true';
    process.env.NANONETS_API_KEY = 'test_key';

    // Simulated timeout
    const timeoutFetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
    const timeoutRes = await Nanonets.readDocumentWithNanonets(DUMMY_PDF, {
      mime_type: 'application/pdf',
      fetchFn: timeoutFetch,
    });
    assert.equal(timeoutRes.ok, false);
    assert.equal(timeoutRes.reason, 'nanonets_timeout');

    // Simulated network 500 error
    const serverErrFetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });
    const serverErrRes = await Nanonets.readDocumentWithNanonets(DUMMY_PDF, {
      mime_type: 'application/pdf',
      fetchFn: serverErrFetch,
    });
    assert.equal(serverErrRes.ok, false);
    assert.equal(serverErrRes.reason, 'nanonets_request_failed');
  } finally {
    if (origFlag !== undefined) process.env.DOCUMENT_OCR_NANONETS_ENABLED = origFlag;
    else delete process.env.DOCUMENT_OCR_NANONETS_ENABLED;
    if (origKey !== undefined) process.env.NANONETS_API_KEY = origKey;
    else delete process.env.NANONETS_API_KEY;
  }
});

test('Nanonets OCR: parses real benchmark export files correctly', () => {
  const userUploads = 'C:/Users/HUAWEI/.gemini/antigravity/brain/396847ea-25f9-4094-a805-2ea7638707db/.user_uploaded';

  // 1. Circle K
  const ckPath = path.join(userUploads, 'media_1792380770400_c56c1032.json');
  if (fs.existsSync(ckPath)) {
    const ckRaw = JSON.parse(fs.readFileSync(ckPath, 'utf8'));
    const ckRes = Nanonets.normalizeNanonetsResponse(ckRaw);
    assert.equal(ckRes.ok, true);
    assert.equal(ckRes.document_type, 'invoice');
    assert.equal(ckRes.fields.document_number, 'X2610001139');
    assert.equal(ckRes.fields.gross_amount, 143856000);
    assert.equal(ckRes.fields.tax_base_dpp, 129600000);
    assert.equal(ckRes.fields.commercial_tax_amount, 14256000);
    assert.ok(ckRes.warnings.some((w) => /subtotal\/dpp uncertainty flag/i.test(w)));
  }

  // 2. Alfamart Kwitansi
  const alfaPath = path.join(userUploads, 'media_1792380770400_cc92bbea.json');
  if (fs.existsSync(alfaPath)) {
    const alfaRaw = JSON.parse(fs.readFileSync(alfaPath, 'utf8'));
    const alfaRes = Nanonets.normalizeNanonetsResponse(alfaRaw);
    assert.equal(alfaRes.ok, true);
    assert.equal(alfaRes.document_type, 'receipt'); // Kwitansi
    assert.equal(alfaRes.fields.gross_amount, 11322000);
  }

  // 3. LMX
  const lmxPath = path.join(userUploads, 'media_1792380770400_9f8f0833.json');
  if (fs.existsSync(lmxPath)) {
    const lmxRaw = JSON.parse(fs.readFileSync(lmxPath, 'utf8'));
    const lmxRes = Nanonets.normalizeNanonetsResponse(lmxRaw);
    assert.equal(lmxRes.ok, true);
    assert.equal(lmxRes.document_type, 'invoice');
    assert.equal(lmxRes.fields.document_number, 'IVLMXS-26-0215');
    assert.equal(lmxRes.fields.gross_amount, 472);
  }
});

test('Nanonets OCR: verifyNanonetsAuth handles success, 401, 404, and timeout safely', async () => {
  // 1. Missing key
  const missing = await Nanonets.verifyNanonetsAuth({ apiKey: '' });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);

  // 2. Success 200 OK
  const mockSuccessFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model_id: 'test-model-uuid',
      model_type: 'ocr',
      state: 5,
      categories: ['invoice_number', 'vendor_name', 'total_amount']
    })
  });
  const success = await Nanonets.verifyNanonetsAuth({
    apiKey: 'valid_test_key',
    modelId: 'test-model-uuid',
    fetchFn: mockSuccessFetch
  });
  assert.equal(success.ok, true);
  assert.equal(success.status, 200);
  assert.equal(success.model_id, 'test-model-uuid');
  assert.equal(success.categories_count, 3);

  // 3. Unauthorized 401
  const mock401Fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized'
  });
  const unauth = await Nanonets.verifyNanonetsAuth({
    apiKey: 'invalid_key',
    modelId: 'test-model-uuid',
    fetchFn: mock401Fetch
  });
  assert.equal(unauth.ok, false);
  assert.equal(unauth.status, 401);
  assert.ok(/Authentication failed/i.test(unauth.error));

  // 4. Model not found 404
  const mock404Fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => 'Model not found'
  });
  const notFound = await Nanonets.verifyNanonetsAuth({
    apiKey: 'valid_key',
    modelId: 'wrong-model-uuid',
    fetchFn: mock404Fetch
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);
  assert.ok(/was not found/i.test(notFound.error));
});

test('Nanonets OCR: parses Ary\'s mikro real API response schema (flat prediction array, total_due_amount, table cells)', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures', 'nanonets_arys_mikro_api_response.json');
  assert.ok(fs.existsSync(fixturePath), 'Fixture file must exist');

  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const res = Nanonets.normalizeNanonetsResponse(raw);

  assert.equal(res.ok, true);
  assert.equal(res.document_type, 'invoice');
  assert.equal(res.confidence, 'medium'); // Capped at medium for mandatory human review
  assert.equal(res.fields.issuer_name, "Ary's mikro"); // Whitespace collapsed
  assert.equal(res.fields.gross_amount, 4500000); // Mapped from total_due_amount "RP.4.500.000"
  assert.equal(res.fields.amount, 4500000);
  assert.equal(res.fields.subtotal, 4500000);
  assert.equal(res.fields.currency, 'IDR');
  assert.equal(res.fields.commercial_tax_amount, null); // Not invented
  assert.equal(res.fields.tax_base_dpp, null); // Not invented
  assert.equal(res.fields.issuer_npwp, null); // Not invented

  // Line item normalization
  assert.equal(res.line_items.length, 1);
  assert.equal(res.line_items[0].description, 'Sewa Tempat Helm Care di Arys mikro (singapadu, batubulan, buana raya)');
  assert.equal(res.line_items[0].quantity, 1);
  assert.equal(res.line_items[0].total_amount, 4500000);
  assert.equal(res.line_items[0].currency, 'IDR');

  // Raw evidence & field-level confidence preserved
  assert.ok(res.raw_evidence);
  assert.equal(res.raw_evidence.field_scores.total_due_amount, 0.83);
  assert.equal(res.raw_evidence.field_scores.seller_name, 0.8);
  assert.equal(res.raw_evidence.seller_address, 'Jl . Raya celuk No 8 X Sukawati - Gianyar');
  assert.equal(res.raw_evidence.seller_email, 'Arysdc@gmail.com');
  assert.equal(res.raw_evidence.seller_phone, '( 0361 ) 290407');
});

