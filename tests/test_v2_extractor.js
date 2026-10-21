'use strict';
const fs = require('fs');
const path = require('path');
const { extractDocumentV2 } = require('../server/lib/layoutAwareExtractor');

const OCR_BASE_URL = process.env.OCR_WORKER_URL || 'http://127.0.0.1:55480';
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const SYNTHETIC_DATA_PATH = path.join(FIXTURES_DIR, 'syntheticIndonesianAccountingDocuments.json');
const syntheticData = JSON.parse(fs.readFileSync(SYNTHETIC_DATA_PATH, 'utf8'));

const DOC_FILES = {
  'doc-synth-01-invoice': path.join(FIXTURES_DIR, 'synthetic_invoice_helmcare_scan.png'),
  'doc-synth-02-receipt': path.join(FIXTURES_DIR, 'doc-synth-02-receipt.png'),
  'doc-synth-03-kwitansi': path.join(FIXTURES_DIR, 'doc-synth-03-kwitansi.png'),
  'doc-synth-04-faktur-pajak': path.join(FIXTURES_DIR, 'doc-synth-04-faktur-pajak.png'),
  'doc-synth-05-bank-statement': path.join(FIXTURES_DIR, 'doc-synth-05-bank-statement.png'),
  'doc-hard-01-skewed-invoice': path.join(FIXTURES_DIR, 'doc-hard-01-skewed-invoice.png'),
  'doc-hard-02-multipage-package': path.join(FIXTURES_DIR, 'doc-hard-02-multipage-package.pdf'),
  'doc-hard-03-exempt-faktur': path.join(FIXTURES_DIR, 'doc-hard-03-exempt-faktur.png')
};

async function sendOcrRequest(filePath) {
  const fileBytes = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : 'image/png';
  const formData = new FormData();
  formData.append('file', new Blob([fileBytes], { type: mimeType }), fileName);

  const resp = await fetch(`${OCR_BASE_URL}/ocr/predict`, {
    method: 'POST',
    body: formData
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

function normalizeStr(s) {
  return String(s || '').replace(/[\s.\-/]/g, '').toUpperCase();
}

function evaluateField(actual, expected) {
  if (expected === null || expected === undefined) return { match: true, note: 'n/a' };
  if (typeof expected === 'number') {
    const actNum = Number(actual);
    const match = !isNaN(actNum) && Math.abs(actNum - expected) < 1.0;
    return { match, actual: actNum, expected };
  }
  const normAct = normalizeStr(actual);
  const normExp = normalizeStr(expected);
  const match = normAct.includes(normExp) || normExp.includes(normAct);
  return { match, actual, expected };
}

async function run() {
  console.log('='.repeat(70));
  console.log(' TESTING LAYOUT-AWARE EXTRACTOR V2 WITH RAPIDOCR');
  console.log('='.repeat(70));

  let grandMatched = 0;
  let grandTotal = 0;

  for (const doc of syntheticData.documents) {
    const filePath = DOC_FILES[doc.id];
    console.log(`\nDocument: [${doc.type.toUpperCase()}] ${doc.title}`);

    const ocrResult = await sendOcrRequest(filePath);
    const v2Result = extractDocumentV2(ocrResult);
    const f = v2Result.fields;
    const gt = doc.ground_truth;

    const evals = {
      type: { match: v2Result.document_type === gt.document_type, actual: v2Result.document_type, expected: gt.document_type },
      doc_no: evaluateField(f.document_number || f.tax_invoice_serial, gt.document_number),
      issuer_npwp: evaluateField(f.issuer_npwp || f.merchant_npwp || f.bank_npwp, gt.issuer_npwp),
      buyer_npwp: evaluateField(f.buyer_npwp || f.customer_npwp, gt.buyer_npwp),
      gross: evaluateField(f.gross_amount, gt.gross_amount),
      dpp: evaluateField(f.tax_base_dpp, gt.tax_base_dpp),
      tax: evaluateField(f.tax_amount, gt.tax_amount)
    };

    let matched = 0, total = 0;
    for (const [k, v] of Object.entries(evals)) {
      if (gt[k === 'doc_no' ? 'document_number' : (k === 'gross' ? 'gross_amount' : (k === 'dpp' ? 'tax_base_dpp' : (k === 'tax' ? 'tax_amount' : k)))] !== undefined) {
        total++;
        if (v.match) matched++;
      }
    }

    grandMatched += matched;
    grandTotal += total;

    console.log(`  Accuracy: ${((matched/total)*100).toFixed(1)}% (${matched}/${total} fields matched)`);
    console.log(`  Detected Type : ${v2Result.document_type} (expected: ${gt.document_type})`);
    console.log(`  Doc Number    : ${f.document_number || f.tax_invoice_serial}`);
    console.log(`  Gross Amount  : Rp ${f.gross_amount?.toLocaleString()}`);
    console.log(`  DPP (Base)    : Rp ${f.tax_base_dpp?.toLocaleString()}`);
    console.log(`  PPN (Tax)     : Rp ${f.tax_amount?.toLocaleString()}`);
    console.log(`  Issuer NPWP   : ${f.issuer_npwp || f.merchant_npwp || f.bank_npwp}`);
    console.log(`  Buyer NPWP    : ${f.buyer_npwp || f.customer_npwp}`);
    if (f.transactions && f.transactions.length > 0) {
      console.log(`  Bank Rows     : ${f.transactions.length} transactions extracted!`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`OVERALL V2 ACCURACY: ${((grandMatched/grandTotal)*100).toFixed(1)}% (${grandMatched}/${grandTotal})`);
  console.log('='.repeat(70));
}

run().catch(console.error);
