// CFO AI — P0 Document Extraction Pipeline & Circle K Regression Suite.
// Verifies all 12 scenarios required for financial data integrity and Indonesian tax reconciliation.
//
// Run: node tests/circleka_extraction_regression.test.js
'use strict';

const assert = require('node:assert');
const docExtract = require('../server/lib/documentExtraction');
const docDates = require('../server/lib/documentDates');
const docOcr = require('../server/lib/documentOcr');
const docParties = require('../server/lib/documentParties');
const docIntake = require('../server/lib/documentIntakeOrchestrator');
const SETTLE = require('../server/lib/invoiceSettlement');
const CUR = require('../server/lib/telegramCurrency');
const { buildServer } = require('../server/mcp/server');
const {
  CIRCLEKA_PAGE_1_INVOICE,
  CIRCLEKA_PAGE_2_TAC,
  CIRCLEKA_PAGE_3_FAKTUR_PAJAK,
  CIRCLEKA_FULL_PACKAGE_TEXT,
  CIRCLEKA_VISION_MOCK,
} = require('./fixtures/circleka_invoice');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.error(`  FAIL  ${name}`);
    console.error(e);
  }
};

(async () => {
  console.log('\n── 1. Primary Circle K 3-Page Commercial Package ──');

  await t('1. Circle K 3-page package text extraction preserves commercial total and DPP separately', () => {
    const r = docExtract.extractFromText(CIRCLEKA_FULL_PACKAGE_TEXT);
    // Primary document must be invoice, not faktur_pajak
    assert.strictEqual(r.document_type, 'invoice');

    // Values verified from production invoice
    assert.ok(r.fields.issuer_name.toUpperCase().includes('CIRCLEKA INDONESIA UTAMA'));
    assert.ok(r.fields.buyer_name.toUpperCase().includes('HELM CARE INDONESIA'));
    assert.strictEqual(r.fields.issuer_npwp, '00.207.974.4-507.000');
    assert.strictEqual(r.fields.buyer_npwp, '1000000002284592');
    assert.strictEqual(r.fields.tax_invoice_serial, '04002600313616020');

    // Commercial subtotal vs DPP
    assert.strictEqual(r.fields.subtotal, 129600000);
    assert.strictEqual(r.fields.tax_base_dpp, 118800000);
    assert.strictEqual(r.fields.commercial_base_amount, 129600000);
    assert.strictEqual(r.fields.commercial_tax_amount, 14256000);
    assert.strictEqual(r.fields.gross_amount, 143856000);

    // CRITICAL: Gross total must NEVER be overwritten with 133,056,000 (DPP + PPN)
    assert.notStrictEqual(r.fields.gross_amount, 133056000);

    // Subtotal vs DPP variance must be recorded neutrally (10,800,000)
    assert.strictEqual(r.fields.subtotal_dpp_variance, 10800000);

    // Supporting documents detected
    assert.strictEqual(r.detected_supporting_documents.invoice, true);
    assert.strictEqual(r.detected_supporting_documents.tax_invoice, true);
    assert.strictEqual(r.detected_supporting_documents.contract, true);
  });

  await t('2. Circle K dates: invoice date and estimated payment date are correctly identified', () => {
    const dates = docDates.extractDates(CIRCLEKA_FULL_PACKAGE_TEXT, { document_type: 'invoice' });
    assert.strictEqual(dates.document_date.status, 'detected');
    assert.strictEqual(dates.document_date.value, '2026-07-31');
    assert.strictEqual(dates.estimated_payment_date.status, 'detected');
    assert.strictEqual(dates.estimated_payment_date.value, '2026-08-14');
  });

  await t('3. Circle K OCR/Vision merge accurately folds vision fields into intake shape', () => {
    const base = docExtract.extractFromText(CIRCLEKA_FULL_PACKAGE_TEXT);
    const merged = docOcr.mergeIntoExtraction(base, CIRCLEKA_VISION_MOCK);
    assert.strictEqual(merged.document_type, 'invoice');
    assert.strictEqual(merged.fields.document_number, 'X2610001139');
    assert.strictEqual(merged.fields.tax_invoice_serial, '04002600313616020');
    assert.strictEqual(merged.fields.subtotal, 129600000);
    assert.strictEqual(merged.fields.tax_base_dpp, 118800000);
    assert.strictEqual(merged.fields.subtotal_dpp_variance, 10800000);
    assert.strictEqual(merged.fields.commercial_tax_amount, 14256000);
    assert.strictEqual(merged.fields.gross_amount, 143856000);
    assert.strictEqual(merged.fields.issuer_npwp, '00.207.974.4-507.000');
    assert.strictEqual(merged.fields.buyer_npwp, '1000000002284592');
    assert.strictEqual(merged.detected_supporting_documents.tax_invoice, true);
  });

  console.log('\n── 2. Single-Page Invoice ──');

  await t('4. Single-page commercial invoice without tax', () => {
    const text = `INVOICE
Invoice No : INV/2026/088
Date       : 12-08-2026
Bill To    : PT Helm Care Indonesia
Sub Total  : 50.000.000
Total      : 50.000.000`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.document_type, 'invoice');
    assert.strictEqual(r.fields.document_number, 'INV/2026/088');
    assert.strictEqual(r.fields.gross_amount, 50000000);
    assert.strictEqual(r.fields.commercial_tax_amount, null);
    assert.strictEqual(r.detected_supporting_documents.tax_invoice, false);
  });

  console.log('\n── 3. Multi-Page Package with Attached Faktur Pajak ──');

  await t('5. Multi-page package recognises Faktur Pajak as attached supporting document, satisfying readiness', () => {
    const r = docExtract.extractFromText(CIRCLEKA_FULL_PACKAGE_TEXT);
    const tax = { ppn_detected: true, ppn_amount: 14256000 };
    // Pass detected supporting documents to readiness preview
    const settlement = SETTLE.settlementOf({
      invoice_total: r.fields.gross_amount,
      base_amount: r.fields.commercial_base_amount,
      tax_amount: tax.ppn_amount,
      allocations: [],
    });
    const documents = {
      invoice: true,
      tax_invoice: r.detected_supporting_documents.tax_invoice,
      contract: r.detected_supporting_documents.contract,
    };
    const closeout = SETTLE.closeoutState({ settlement, documents, has_tax: true });

    // Faktur Pajak must be marked PRESENT, NOT missing!
    assert.strictEqual(documents.tax_invoice, true);
    assert.ok(!closeout.missing_documents.includes('Faktur Pajak'),
      `Missing documents should not contain Faktur Pajak: ${closeout.missing_documents.join(', ')}`);
  });

  console.log('\n── 4. DPP != Commercial Subtotal Variance ──');

  await t('6. DPP != subtotal records variance and warns without corrupting payable total', () => {
    const text = `INVOICE No: INV-9901
Sub Total: 200.000.000
Dasar Pengenaan Pajak: 180.000.000
Jumlah PPN: 21.600.000
Total Tagihan: 221.600.000`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.fields.subtotal, 200000000);
    assert.strictEqual(r.fields.tax_base_dpp, 180000000);
    assert.strictEqual(r.fields.subtotal_dpp_variance, 20000000);
    assert.strictEqual(r.fields.discount_amount, null);
    assert.strictEqual(r.fields.commercial_tax_amount, 21600000);
    assert.strictEqual(r.fields.gross_amount, 221600000);
    assert.ok(r.warnings.some((w) => /Commercial subtotal.*differs from Faktur Pajak DPP.*by 20000000/i.test(w)));
  });

  console.log('\n── 5. Discounts & Incentives Handling ──');

  await t('7. Explicit discounts are extracted and properly associated', () => {
    const text = `INVOICE No: INV-DISC-01
Harga Jual: 100.000.000
Diskon: 10.000.000
Dasar Pengenaan Pajak: 90.000.000
PPN: 10.800.000
Grand Total: 100.800.000`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.fields.subtotal, 100000000);
    assert.strictEqual(r.fields.discount_amount, 10000000);
    assert.strictEqual(r.fields.tax_base_dpp, 90000000);
    assert.strictEqual(r.fields.gross_amount, 100800000);
  });

  console.log('\n── 6. Partial Payments ──');

  await t('8. Partial payment matches against commercial gross total without premature close', () => {
    const inv = { total_amount: 143856000, currency: 'IDR', vendor_name: 'PT Circleka Indonesia Utama' };
    const proof = {
      amount: 43856000,
      currency: 'IDR',
      status: 'Successful',
      to_account_name: 'PT Circleka Indonesia Utama',
      reference_number: 'REF-BCA-001',
    };
    const match = SETTLE.matchPaymentToInvoice(proof, inv, 143856000);
    assert.strictEqual(match.matched, true);
    assert.strictEqual(match.suggested_allocation, 43856000);

    const settlement = SETTLE.settlementOf({
      invoice_total: 143856000,
      allocations: [{ allocated_amount: 43856000 }],
    });
    assert.strictEqual(settlement.status, 'partially_paid');
    assert.strictEqual(settlement.remaining_amount, 100000000);

    const closeout = SETTLE.closeoutState({ settlement, documents: { invoice: true, payment_proof: true } });
    assert.strictEqual(closeout.can_close, false);
    assert.ok(closeout.blockers.some((b) => /Remaining balance: 100000000/i.test(b)));
  });

  console.log('\n── 7. Multiple Tax Lines / PPN ──');

  await t('9. PPN calculation is verified against stated DPP', () => {
    const text = `INVOICE No: INV-TAX-12
Dasar Pengenaan Pajak: 100.000.000
Jumlah PPN: 12.000.000
Total: 112.000.000`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.fields.tax_base_dpp, 100000000);
    assert.strictEqual(r.fields.commercial_tax_amount, 12000000);
    assert.strictEqual(r.fields.gross_amount, 112000000);
    // 100M * 12% = 12M -> base + tax reconciles to total
    assert.strictEqual(r.fields.commercial_base_amount + r.fields.commercial_tax_amount, r.fields.gross_amount);
  });

  console.log('\n── 8. Missing Total Derivation with Explicit Warning ──');

  await t('10. Missing total is derived from base + tax with honest warning, never silent', () => {
    const text = `INVOICE No: INV-NOTOTAL-01
Harga Jual: 50.000.000
PPN: 6.000.000`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.fields.gross_amount, 56000000);
    assert.ok(r.warnings.some((w) => /Total was not found on the document; derived from base \+ tax/i.test(w)));
  });

  console.log('\n── 9. Unreadable Scan Fallback ──');

  await t('11. Scanned page with no embedded text returns needs_manual_review without guessing', () => {
    const r = docExtract.extractFromText('', { text_available: false, extraction_reason: 'no_embedded_text' });
    assert.strictEqual(r.status, 'needs_manual_review');
    assert.strictEqual(r.confidence, 'needs_review');
    assert.strictEqual(r.fields.gross_amount, null);
    assert.strictEqual(r.fields.commercial_base_amount, null);
    assert.ok(r.warnings.some((w) => /scanned image/i.test(w)));
  });

  console.log('\n── 10. Conflicting Values / Reconciliation Warning ──');

  await t('12. Conflicting total that contradicts base + tax triggers reconciliation warning', () => {
    const text = `INVOICE No: INV-CONFLICT
Sub Total: 100.000.000
PPN: 12.000.000
Total: 150.000.000`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.fields.gross_amount, 150000000);
    assert.ok(r.warnings.some((w) => /Read total 150000000 does not equal base 100000000 \+ tax 12000000/i.test(w)));
  });

  console.log('\n── 11. Duplicate Upload Detection ──');

  await t('13. Duplicate document with same invoice number and amount is flagged', () => {
    const candidate = { document_number: 'X2610001139', amount: 143856000 };
    const existing = [
      { document_number: 'X2610001139', amount: 143856000, id: 'doc-old' },
    ];
    const dup = docExtract.findDuplicateDocument(candidate, existing);
    assert.strictEqual(dup.duplicate, true);
    assert.ok(/already recorded/i.test(dup.reason));
  });

  console.log('\n── 12. Foreign Currency & Credit Notes ──');

  await t('14. Foreign currency is preserved and non-IDR is flagged', () => {
    const text = `INVOICE No: INV-USD-001
Currency: USD
Subtotal: $5,000.00
Total: $5,000.00`;
    const r = docExtract.extractFromText(text);
    assert.strictEqual(r.fields.currency, 'USD');
    assert.strictEqual(r.fields.gross_amount, 5000);
  });

  console.log('\n── 13. End-to-End MCP analyze_invoice and submit_invoice_draft with Circle K ──');

  await t('15. analyze_invoice returns complete Circle K breakdown including DPP, PPN, and subtotal', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

    const biz = {
      business: { id: 'biz-circleka', name: 'PT Helm Care Indonesia', business_code: 'HF-BIZ-000004', base_currency: 'IDR', type: 'business' },
      role: 'owner', ownerUserId: -1,
    };

    const s = {
      calls: [],
      resolveBusinessReadOnly: async () => biz,
      listAccessibleWorkspaces: async () => [{ role: 'owner', businesses: biz.business }],
      findDefaultBusiness: async () => ({ business: biz.business, membership: { role: 'owner' } }),
      resolveCompanyMembership: async () => biz,
      readTextForIntake: (text) => {
        const extraction = docExtract.extractFromText(text, { text_available: true });
        return {
          file: null, buf: null, extraction, readSource: 'client_model_text', ocr: null,
          dates: docDates.extractDates(text, { document_type: extraction.document_type }),
          parties: docParties.extractParties(text),
        };
      },
      analyzeDocumentReading: async (b, d, read) => {
        const ex = read.extraction;
        return {
          status: 'draft_ready',
          document: { id: null, document_type: ex.document_type },
          tax: { ppn_detected: true, ppn_amount: ex.fields.commercial_tax_amount },
          counterparty: { counterparty: { id: 'cp-circleka', name: ex.fields.issuer_name } },
          financial_record: { currency: 'IDR', amount: ex.fields.gross_amount, direction: 'payable' },
          missing_fields: ex.missing_fields,
          warnings: ex.warnings,
          blockers: [],
          next_actions: ['submit_invoice_draft'],
        };
      },
      invoiceReadinessPreview: (f, tax, det) => {
        const settlement = SETTLE.settlementOf({
          invoice_total: f.gross_amount,
          base_amount: f.commercial_base_amount,
          tax_amount: tax.ppn_amount,
          allocations: [],
        });
        const hasTax = !!(det?.tax_invoice || f.tax_invoice_serial);
        const documents = { invoice: true, tax_invoice: hasTax };
        return {
          basis: 'preview_as_new_invoice',
          settlement,
          documents,
          closeout: SETTLE.closeoutState({ settlement, documents, has_tax: true }),
        };
      },
      findDocumentDuplicate: async () => ({ duplicate: false }),
      linkedInvoiceSettlement: async () => null,
      canViewBusinessFinance: () => true,
      hasDocumentsAccess: () => true,
      canCreateFinancialRequest: () => true,
      canUploadDocument: () => true,
      canCreateFinancialRecord: () => true,
      canApproveFinancialRecord: () => true,
      normalizeCurrency: CUR.normalizeCurrency,
      isSupportedTelegramCurrency: CUR.isSupportedTelegramCurrency,
      isAllowedCurrency: CUR.isSupportedTelegramCurrency,
      findExistingPayable: async () => null,
      checkCompanyPlanLimit: async () => ({ allowed: true }),
      createPendingPayableDraft: async (b, u, draft) => ({ debt: { id: 'debt-circleka', ...draft, approval_status: 'pending_approval' } }),
      notifyTelegramApprovalNeeded: async () => ({ ok: true }),
    };

    const server = await buildServer({ mcpUser: { userId: -1 }, services: s, writeToolsEnabled: true, webAppUrl: 'https://cfo.example' });
    const [c, sv] = InMemoryTransport.createLinkedPair();
    await server.connect(sv);
    const client = new Client({ name: 'circleka-test', version: '0' });
    await client.connect(c);

    try {
      // Step A: analyze_invoice
      const aRes = await client.callTool({
        name: 'analyze_invoice',
        arguments: { invoice_text: CIRCLEKA_FULL_PACKAGE_TEXT },
      });
      assert.ok(!aRes.isError);
      const a = JSON.parse(aRes.content[0].text);

      assert.strictEqual(a.invoice.invoice_number, 'X2610001139');
      assert.strictEqual(a.invoice.subtotal, 129600000);
      assert.strictEqual(a.invoice.tax_base_dpp, 118800000);
      assert.strictEqual(a.invoice.subtotal_dpp_variance, 10800000);
      assert.strictEqual(a.invoice.tax_amount_read, 14256000);
      assert.strictEqual(a.invoice.total, 143856000);
      assert.strictEqual(a.invoice.invoice_date.value, '2026-07-31');
      assert.strictEqual(a.invoice.estimated_payment_date.value, '2026-08-14');
      assert.strictEqual(a.invoice.supplier_npwp, '00.207.974.4-507.000');
      assert.strictEqual(a.invoice.buyer_npwp, '1000000002284592');
      assert.strictEqual(a.invoice.tax_invoice_serial, '04002600313616020');

      // Package readiness: Faktur Pajak must NOT be reported missing
      assert.ok(!a.package_readiness.missing_documents.includes('Faktur Pajak'));

      // Step B: submit_invoice_draft with correct amount (143,856,000)
      const sRes = await client.callTool({
        name: 'submit_invoice_draft',
        arguments: {
          request_key: crypto.randomUUID(),
          invoice_text: CIRCLEKA_FULL_PACKAGE_TEXT,
          amount: 143856000,
        },
      });
      assert.ok(!sRes.isError, `submit_invoice_draft failed: ${sRes.content?.[0]?.text}`);
      const sBody = JSON.parse(sRes.content[0].text);
      assert.strictEqual(sBody.written, true);
      assert.strictEqual(sBody.draft.amount, 143856000);
      assert.strictEqual(sBody.draft.amount_source, 'cfo_extraction');
      assert.strictEqual(sBody.draft.approval_status, 'pending_approval');
    } finally {
      await client.close();
      await server.close();
    }
  });

  console.log(`\n========================================`);
  console.log(`RESULTS: ${pass} passed, ${fail} failed`);
  console.log(`========================================\n`);

  if (fail > 0) process.exit(1);
})();
