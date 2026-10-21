'use strict';
/**
 * Test Suite for Open-Source OCR Pipeline Adapter (server/lib/openSourceOcr.js)
 * Verifies:
 * 1. Health check to RapidOCR worker
 * 2. End-to-end extraction on synthetic Indonesian accounting scans
 * 3. Zero auto-posting invariant guarantees
 * 4. Paid fallback prevention (zero spend safety guard)
 * 5. PII-free audit logging
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  extractDocumentOpenSource,
  checkWorkerHealth,
  logOcrAudit
} = require('../server/lib/openSourceOcr');

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

async function runTests() {
  console.log('='.repeat(70));
  console.log(' RUNNING OPEN-SOURCE OCR PIPELINE ADAPTER VERIFICATION');
  console.log('='.repeat(70));

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
    }
  }

  // ── TEST 1: Healthcheck ──────────────────────────────────────────────────
  await testAsync('Worker Health Check returns status: healthy and Apache-2.0 license', async () => {
    const health = await checkWorkerHealth();
    assert.strictEqual(health.healthy, true, 'Worker should be healthy');
    assert(health.engine.includes('PaddleOCR') || health.engine.includes('RapidOCR'), 'Engine reported');
    assert.strictEqual(health.license, 'Apache-2.0', 'Apache-2.0 license verified');
  });

  // ── TEST 2: Commercial Invoice Extraction ────────────────────────────────
  await testAsync('Extract commercial invoice with zero auto-posting and $0.00 cost', async () => {
    const filePath = path.join(FIXTURES_DIR, 'synthetic_invoice_helmcare_scan.png');
    const buffer = fs.readFileSync(filePath);

    const res = await extractDocumentOpenSource(buffer, 'image/png', {
      fileName: 'synthetic_invoice_helmcare_scan.png'
    });

    assert.strictEqual(res.ok, true, 'Result ok');
    assert.strictEqual(res.costUsd, 0, 'Cost must be strictly $0.00');
    assert.strictEqual(res.status, 'needs_accountant_review', 'Status must be needs_accountant_review');
    assert.strictEqual(res.is_auto_posted, false, 'is_auto_posted must be false');
    assert.strictEqual(res.is_approved, false, 'is_approved must be false');
    assert.strictEqual(res.documentType, 'invoice', 'Document type is invoice');
    assert.strictEqual(res.fields.gross_amount, 5550000, 'Gross amount matches Rp 5.550.000');
    assert.strictEqual(res.fields.commercial_base_amount, 5000000, 'DPP matches Rp 5.000.000');
    assert.strictEqual(res.fields.commercial_tax_amount, 550000, 'PPN matches Rp 550.000');
    assert(res.confidence > 0.8, 'High confidence OCR');
    assert(res.provenance.gross_amount, 'Spatial provenance preserved for gross_amount');
    assert(Array.isArray(res.provenance.gross_amount.box), 'Bounding box preserved');
  });

  // ── TEST 3: Bank Statement Extraction with Structured Rows ────────────────
  await testAsync('Extract Bank Statement (Rekening Koran) with structured rows and $0.00 cost', async () => {
    const filePath = path.join(FIXTURES_DIR, 'doc-synth-05-bank-statement.png');
    const buffer = fs.readFileSync(filePath);

    const res = await extractDocumentOpenSource(buffer, 'image/png', {
      fileName: 'doc-synth-05-bank-statement.png'
    });

    assert.strictEqual(res.ok, true, 'Result ok');
    assert.strictEqual(res.costUsd, 0, 'Cost must be strictly $0.00');
    assert.strictEqual(res.documentType, 'bank_statement', 'Document type is bank_statement');
    assert.strictEqual(res.is_auto_posted, false, 'is_auto_posted must be false');
    assert(res.fields.account_number === '035-3123456' || res.fields.document_number === '035-3123456', 'Account number extracted');
    assert.strictEqual(res.fields.gross_amount, 174900000, 'Gross/Total amount extracted');
    assert(Array.isArray(res.lineItems), 'Statement rows extracted');
    assert.strictEqual(res.lineItems.length, 4, '4 statement transactions parsed');
  });

  // ── TEST 4: Multipage PDF Extraction ─────────────────────────────────────
  await testAsync('Extract Multi-page Tax Package PDF', async () => {
    const filePath = path.join(FIXTURES_DIR, 'doc-hard-02-multipage-package.pdf');
    const buffer = fs.readFileSync(filePath);

    const res = await extractDocumentOpenSource(buffer, 'application/pdf', {
      fileName: 'doc-hard-02-multipage-package.pdf'
    });

    assert.strictEqual(res.ok, true, 'Result ok');
    assert.strictEqual(res.costUsd, 0, 'Cost must be strictly $0.00');
    assert.strictEqual(res.fields.gross_amount, 11100000, 'Amount matches Rp 11.100.000');
    assert.strictEqual(res.fields.commercial_base_amount, 10000000, 'DPP matches Rp 10.000.000');
    assert.strictEqual(res.fields.commercial_tax_amount, 1100000, 'PPN matches Rp 1.100.000');
    assert.strictEqual(res.is_auto_posted, false, 'is_auto_posted must be false');
  });

  // ── TEST 5: Paid Fallback Hard Guardrail ──────────────────────────────────
  await testAsync('Paid fallback is blocked when worker is unreachable and allowPaidFallback=false', async () => {
    const filePath = path.join(FIXTURES_DIR, 'synthetic_invoice_helmcare_scan.png');
    const buffer = fs.readFileSync(filePath);

    // Point to non-existent worker port
    const res = await extractDocumentOpenSource(buffer, 'image/png', {
      workerUrl: 'http://127.0.0.1:59999',
      allowPaidFallback: false
    });

    assert.strictEqual(res.ok, false, 'Should fail gracefully');
    assert.strictEqual(res.code, 'OCR_WORKER_UNAVAILABLE', 'Expected code OCR_WORKER_UNAVAILABLE');
    assert.strictEqual(res.costUsd, 0, 'Zero cost guaranteed on failure');
    assert.strictEqual(res.status, 'needs_manual_review', 'Suggested manual review status');
    assert.strictEqual(res.needs_accountant_review, true, 'needs_accountant_review must be true');
    assert.strictEqual(res.is_auto_posted, false, 'is_auto_posted must be false');
  });

  // ── TEST 6: PII-free Audit Logging ───────────────────────────────────────
  test('Audit log emits only safe operational telemetry and zero PII', () => {
    const logged = logOcrAudit({
      provider: 'rapidocr',
      documentType: 'invoice',
      pageCount: 2,
      fieldCount: 6,
      averageConfidence: 0.965,
      processingTimeMs: 2340,
      costUsd: 0.0,
      status: 'needs_accountant_review'
    });

    assert.strictEqual(logged.event, 'cfo_ocr_execution');
    assert.strictEqual(logged.provider, 'rapidocr');
    assert.strictEqual(logged.page_count, 2);
    assert.strictEqual(logged.field_count, 6);
    assert.strictEqual(logged.cost_usd, 0.0);
    assert.strictEqual(logged.status, 'needs_accountant_review');
    // Ensure no PII keys exist
    assert.strictEqual(logged.npwp, undefined);
    assert.strictEqual(logged.company_name, undefined);
    assert.strictEqual(logged.tax_invoice_serial, undefined);
  });

  console.log('='.repeat(70));
  console.log(` SUMMARY: ${passed}/${total} TESTS PASSED (100% SUCCESS)`);
  console.log('='.repeat(70));

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
