'use strict';

/**
 * CFO AI — Document Extraction Benchmark Runner (Phase 0A)
 *
 * Evaluates native extraction against human-reviewed ground truth fixtures.
 * CRITICAL INVARIANT: 100% Read-Only, Deterministic, ZERO paid network/API calls.
 *
 * Supports evaluating:
 *   - Local baseline engine (current active branch)
 *   - Release Candidate P0 engine (worktree commit 8085655 if present)
 *
 * Run: node tests/benchmark/runner.cjs [--engine=local|p0|both]
 */

const fs = require('fs');
const path = require('path');

// Determine engine paths
const localEnginePath = path.resolve(__dirname, '../../server/lib/documentExtraction.js');
const localDatesPath = path.resolve(__dirname, '../../server/lib/documentDates.js');
const p0WorktreeEnginePath = 'C:/tmp/cfo-v2-prod-int/server/lib/documentExtraction.js';
const p0WorktreeDatesPath = 'C:/tmp/cfo-v2-prod-int/server/lib/documentDates.js';

const hasP0Worktree = fs.existsSync(p0WorktreeEnginePath);

// Local fixtures
const circlekaFixture = require('./fixtures/circleka_fixture.cjs');
const lmxFixture = require('./fixtures/lmx_fixture.cjs');
const bcaFixture = require('./fixtures/bca_payment_confirmation_fixture.cjs');
const alfamartFixture = require('./fixtures/alfamart_fixture.cjs');
const primaSentralFixture = require('./fixtures/prima_sentral_fixture.cjs');

// Ground truth paths
const GT_DIR = path.join(__dirname, 'ground_truth');
const CASES = [
  {
    id: 'CASE_A_CIRCLEKA',
    gtFile: 'circleka_ground_truth.json',
    text: circlekaFixture.CIRCLEKA_FULL_PACKAGE_TEXT,
    expectedDocType: 'invoice'
  },
  {
    id: 'CASE_B_LMX',
    gtFile: 'lmx_ground_truth.json',
    text: lmxFixture.LMX_PAGE_1_INVOICE,
    expectedDocType: 'invoice'
  },
  {
    id: 'CASE_B_BCA_CONFIRMATION',
    gtFile: 'bca_payment_confirmation_ground_truth.json',
    text: bcaFixture.BCA_PAYMENT_CONFIRMATION_TEXT,
    expectedDocType: 'payment_proof'
  },
  {
    id: 'CASE_C_ALFAMART',
    gtFile: 'alfamart_ground_truth.json',
    text: alfamartFixture.ALFAMART_FULL_PACKAGE_TEXT,
    expectedDocType: 'receipt'
  },
  {
    id: 'CASE_D_PRIMA_SENTRAL',
    gtFile: 'prima_sentral_ground_truth.json',
    text: primaSentralFixture.PRIMA_SENTRAL_PAGE_1_INVOICE,
    expectedDocType: 'invoice'
  }
];

function validateGroundTruthSchema(gt) {
  const errors = [];
  if (!gt.case_id) errors.push('missing case_id');
  if (!gt.document_type) errors.push('missing document_type');
  if (!gt.verification_status) errors.push('missing verification_status');
  if (!gt.missing_artifacts) errors.push('missing missing_artifacts');
  if (!gt.financials) errors.push('missing financials');
  if (!gt.parties) errors.push('missing parties');
  if (!gt.dates) errors.push('missing dates');

  if (gt.financials) {
    if (!gt.financials.currency) errors.push('financials.currency required');
    if (gt.financials.gross_payable_total === undefined) errors.push('financials.gross_payable_total required');
    const hasSubtotal = gt.financials.invoice_subtotal !== undefined;
    const hasDpp = gt.financials.faktur_pajak_dpp !== undefined;
    const hasReceiptTotal = gt.financials.receipt_total !== undefined;
    if (!hasSubtotal && !hasDpp && !hasReceiptTotal && !gt.financials.settled_amount) {
      errors.push('financials must specify at least one distinct amount');
    }
  }

  return errors;
}

function evaluateEngine(engineLabel, engineExtract, engineDates) {
  console.log(`\n========================================================================`);
  console.log(`  EVALUATING ENGINE: ${engineLabel}`);
  console.log(`========================================================================`);

  let passedTests = 0;
  let totalTests = 0;
  const results = [];
  const missingArtifactsReport = [];

  for (const c of CASES) {
    console.log(`\n── [${c.id}] ─────────────────────────────────────────────────────────`);
    const gtRaw = fs.readFileSync(path.join(GT_DIR, c.gtFile), 'utf8');
    const gt = JSON.parse(gtRaw);

    // 1. Schema Validation
    totalTests++;
    const schemaErrors = validateGroundTruthSchema(gt);
    if (schemaErrors.length === 0) {
      passedTests++;
      console.log(`  PASS: Ground Truth Schema Validation (${c.gtFile})`);
    } else {
      console.error(`  FAIL: Ground Truth Schema Errors: ${schemaErrors.join(', ')}`);
    }

    // 2. Missing Artifacts Recording
    if (gt.missing_artifacts.original_pdf_missing || gt.missing_artifacts.nanonets_json_missing) {
      missingArtifactsReport.push({
        case_id: c.id,
        title: gt.title,
        status: gt.verification_status,
        original_pdf_missing: gt.missing_artifacts.original_pdf_missing,
        nanonets_json_missing: gt.missing_artifacts.nanonets_json_missing,
        notes: gt.missing_artifacts.notes
      });
    }

    // 3. Deterministic Local Extraction
    const extraction = engineExtract.extractFromText(c.text);
    const dateExtraction = engineDates.extractDates(c.text, { document_type: extraction.document_type });

    // 4. Invariant Tests & Field Exact-Match Comparisons
    let casePass = 0;
    let caseTotal = 0;

    // A. Zero-Posting Guard Invariant
    caseTotal++;
    totalTests++;
    if (extraction.status === 'suggested' || extraction.status === 'needs_manual_review') {
      casePass++;
      passedTests++;
      console.log('  PASS [Invariant]: Zero-Posting Guard (status is suggestion, no auto-approval)');
    } else {
      console.error(`  FAIL [Invariant]: Document status was auto-committed: ${extraction.status}`);
    }

    // B. Document Type Detection
    caseTotal++;
    totalTests++;
    if (extraction.document_type === c.expectedDocType) {
      casePass++;
      passedTests++;
      console.log(`  PASS: Document Type detected as '${extraction.document_type}'`);
    } else {
      console.log(`  NOTE [Lineage Gap]: Document Type detected as '${extraction.document_type}', expected '${c.expectedDocType}'`);
    }

    // C. Monetary Entities & Tax Reconciliation Checks
    if (c.id === 'CASE_A_CIRCLEKA') {
      caseTotal++;
      totalTests++;
      const extractedGross = extraction.fields.gross_amount || extraction.fields.amount;
      if (extractedGross === gt.financials.gross_payable_total) {
        casePass++;
        passedTests++;
        console.log(`  PASS [Invariant]: Gross Payable matches exact IDR ${extractedGross?.toLocaleString('id-ID')}`);
      } else {
        console.log(`  NOTE: Gross Payable was ${extractedGross}, expected ${gt.financials.gross_payable_total}`);
      }

      caseTotal++;
      totalTests++;
      const subtotal = extraction.fields.subtotal || extraction.fields.commercial_base_amount;
      const dpp = extraction.fields.tax_base_dpp;
      if (subtotal === gt.financials.invoice_subtotal && dpp === gt.financials.faktur_pajak_dpp) {
        casePass++;
        passedTests++;
        console.log(`  PASS [Invariant]: Subtotal (${subtotal?.toLocaleString('id-ID')}) and DPP (${dpp?.toLocaleString('id-ID')}) preserved distinctly`);
      } else {
        console.log(`  NOTE [Lineage Gap]: Subtotal/DPP separation not present in baseline: subtotal=${subtotal}, dpp=${dpp}`);
      }

      caseTotal++;
      totalTests++;
      const variance = extraction.fields.subtotal_dpp_variance;
      if (variance === gt.financials.subtotal_dpp_variance) {
        casePass++;
        passedTests++;
        console.log(`  PASS [Invariant]: Neutral variance recorded as IDR ${variance?.toLocaleString('id-ID')}`);
      } else {
        console.log(`  NOTE [Lineage Gap]: Subtotal/DPP variance not present in baseline: got ${variance}`);
      }
    }

    if (c.id === 'CASE_B_LMX') {
      caseTotal++;
      totalTests++;
      const amount = extraction.fields.amount || extraction.fields.gross_amount;
      if (amount === gt.financials.gross_payable_total) {
        casePass++;
        passedTests++;
        console.log(`  PASS: LMX Total Payable matches USD ${amount}`);
      } else {
        console.log(`  NOTE: LMX amount mismatch: got ${amount}, expected ${gt.financials.gross_payable_total}`);
      }
    }

    if (c.id === 'CASE_B_BCA_CONFIRMATION') {
      caseTotal++;
      totalTests++;
      const amount = extraction.fields.amount;
      if (amount === gt.financials.settled_amount) {
        casePass++;
        passedTests++;
        console.log(`  PASS: BCA Remittance settled amount matches USD ${amount}`);
      } else {
        console.log(`  NOTE: BCA Remittance amount mismatch: got ${amount}, expected ${gt.financials.settled_amount}`);
      }
    }

    if (c.id === 'CASE_C_ALFAMART') {
      caseTotal++;
      totalTests++;
      if (extraction.document_type === 'receipt') {
        casePass++;
        passedTests++;
        console.log('  PASS [Invariant]: Kwitansi correctly classified as receipt (outflow voucher)');
      } else {
        console.log(`  NOTE [Lineage Gap]: Kwitansi classified as ${extraction.document_type} (requires package segmentation)`);
      }

      caseTotal++;
      totalTests++;
      const total = extraction.fields.amount || extraction.fields.receipt_total;
      if (total === gt.financials.receipt_total) {
        casePass++;
        passedTests++;
        console.log(`  PASS: Alfamart receipt total matches IDR ${total?.toLocaleString('id-ID')}`);
      } else {
        console.log(`  NOTE: Alfamart receipt total: got ${total}, expected ${gt.financials.receipt_total}`);
      }
    }

    if (c.id === 'CASE_D_PRIMA_SENTRAL') {
      caseTotal++;
      totalTests++;
      const amount = extraction.fields.amount || extraction.fields.gross_amount;
      if (amount === gt.financials.gross_payable_total) {
        casePass++;
        passedTests++;
        console.log(`  PASS: Prima Sentral payable matches IDR ${amount?.toLocaleString('id-ID')}`);
      } else {
        console.log(`  NOTE [Regex Gap]: Prima Sentral payable: got ${amount}, expected ${gt.financials.gross_payable_total} (requires Vision OCR or keyword expansion)`);
      }
    }

    // D. Dates Exact Match
    caseTotal++;
    totalTests++;
    const docDate = dateExtraction.document_date?.value || extraction.fields.date;
    if (docDate === gt.dates.document_date) {
      casePass++;
      passedTests++;
      console.log(`  PASS: Document Date matches ${docDate}`);
    } else {
      console.log(`  NOTE: Document Date mismatch: got ${docDate}, expected ${gt.dates.document_date}`);
    }

    results.push({
      case_id: c.id,
      title: gt.title,
      status: gt.verification_status,
      passed: casePass,
      total: caseTotal,
      score: `${((casePass / caseTotal) * 100).toFixed(1)}%`
    });
  }

  console.log(`\nSummary for ${engineLabel}:`);
  console.table(results);
  console.log(`Checks Passed: ${passedTests} / ${totalTests} (${((passedTests / totalTests) * 100).toFixed(1)}%).\n`);

  return { engineLabel, passedTests, totalTests, results, missingArtifactsReport };
}

function runBenchmark() {
  console.log('========================================================================');
  console.log('        CFO AI — DOCUMENT EXTRACTION BENCHMARK RUNNER (PHASE 0A)        ');
  console.log('        Read-Only Offline Evaluation | Zero Paid API Calls              ');
  console.log('========================================================================');

  // Evaluate local baseline
  const localExtract = require(localEnginePath);
  const localDates = require(localDatesPath);
  const baselineResults = evaluateEngine('Local Branch Baseline (feat/cfo-ai-cloudflare-launch)', localExtract, localDates);

  // Evaluate P0 Release Candidate if worktree exists
  let p0Results = null;
  if (hasP0Worktree) {
    const p0Extract = require(p0WorktreeEnginePath);
    const p0Dates = require(p0WorktreeDatesPath);
    p0Results = evaluateEngine('Release Candidate P0 Worktree (feature/doc-extraction-reliability-p0 @ 8085655)', p0Extract, p0Dates);
  }

  // Missing Artifacts Inventory
  console.log('========================================================================');
  console.log('                MISSING ARTIFACTS / REQUIRED USER INPUTS                ');
  console.log('========================================================================');
  console.log('The following original files must be provided by the user to complete');
  console.log('empirical head-to-head benchmarking against Nanonets:\n');

  baselineResults.missingArtifactsReport.forEach((m, idx) => {
    console.log(`${idx + 1}. [${m.case_id}] ${m.title}`);
    console.log(`   - Status               : ${m.status}`);
    console.log(`   - Original Binary PDF  : ${m.original_pdf_missing ? 'MISSING' : 'PRESENT'}`);
    console.log(`   - Nanonets JSON Export : ${m.nanonets_json_missing ? 'MISSING (need bounding boxes & source refs)' : 'PRESENT'}`);
    console.log(`   - Notes                : ${m.notes}\n`);
  });

  console.log('Zero external paid API calls made during this benchmark run.\n');
  return { baselineResults, p0Results };
}

if (require.main === module) {
  runBenchmark();
}

module.exports = { runBenchmark };
