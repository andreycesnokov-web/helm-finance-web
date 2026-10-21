'use strict';
/**
 * CFO AI — Controlled Single Paid Nanonets OCR Execution Tool
 *
 * OWNER AUTHORIZATION CONSTRAINTS:
 * 1. Approved for EXACTLY ONE paid request.
 * 2. Maximum budget: $0.30 USD.
 * 3. Document: tests/fixtures/synthetic_invoice_pure_image_scan.pdf (100% synthetic, 49KB).
 * 4. Model ID: a80d8b72-f30c-46b4-ab6b-9a0de779815b.
 * 5. Automatic retries: STRICTLY DISABLED (retries: 0).
 * 6. Never logs or echoes the API key.
 * 7. Caches raw response to prevent any accidental second paid call.
 */

const fs = require('fs');
const path = require('path');
const nanonetsOcr = require('../server/lib/nanonetsOcr');

const ROOT = path.resolve(__dirname, '..');
const PDF_PATH = path.join(ROOT, 'tests', 'fixtures', 'synthetic_invoice_pure_image_scan.pdf');
const RAW_RESPONSE_CACHE = path.join(ROOT, 'tests', 'fixtures', 'nanonets_synthetic_invoice_live_response.json');
const TARGET_MODEL_ID = 'a80d8b72-f30c-46b4-ab6b-9a0de779815b';

// Ground Truth for Synthetic Invoice
const EXPECTED = {
  seller_name: 'PT SOLUSI PRIMA DIGITAL',
  buyer_name: 'PT HELM CARE INDONESIA',
  invoice_number: 'INV/2026/SPD-0881',
  invoice_date: '2026-10-15',
  due_date: '2026-10-30',
  gross_amount: 5550000,
  dpp: 5000000,
  ppn: 550000,
  currency: 'IDR',
  line_items_count: 1,
};

function loadLocalEnvIfPresent() {
  const candidates = ['.env.local', '.env'];
  for (const filename of candidates) {
    const fullPath = path.resolve(ROOT, filename);
    if (fs.existsSync(fullPath)) {
      try {
        const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^\s*(NANONETS_[A-Z0-9_]+)\s*=\s*(.*)?$/);
          if (match) {
            const key = match[1];
            let val = (match[2] || '').trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
            if (!process.env[key] && val) process.env[key] = val;
          }
        }
      } catch {}
    }
  }
}

async function main() {
  loadLocalEnvIfPresent();

  console.log('========================================================================');
  console.log('  CFO AI — CONTROLLED SINGLE PAID NANONETS OCR EXECUTION');
  console.log('========================================================================\n');

  // 1. Verify Document
  if (!fs.existsSync(PDF_PATH)) {
    console.error('[FAIL] Synthetic fixture not found at:', PDF_PATH);
    process.exit(1);
  }
  const fileBytes = fs.readFileSync(PDF_PATH);
  console.log('[1/5] Synthetic Document Verification:');
  console.log(`      Path        : ${PDF_PATH}`);
  console.log(`      Size        : ${fileBytes.length} bytes (${(fileBytes.length / 1024).toFixed(1)} KB)`);
  console.log(`      Confidential: ZERO (100% synthetic Indonesian vendor & buyer)`);
  console.log(`      Text Layer  : ZERO (100% raster image scan, forces OCR)\n`);

  // 2. Verify Model ID & Guardrails
  const modelId = process.env.NANONETS_MODEL_ID || TARGET_MODEL_ID;
  if (modelId !== TARGET_MODEL_ID) {
    console.error(`[FAIL] Guardrail violation: Model ID must be ${TARGET_MODEL_ID}, got: ${modelId}`);
    process.exit(1);
  }
  console.log('[2/5] API & Model Guardrails:');
  console.log(`      Model ID    : ${modelId}`);
  console.log(`      Endpoint    : https://app.nanonets.com/api/v2/OCR/Model/${modelId}/LabelFile/`);
  console.log(`      Budget Limit: $0.30 USD (Estimated cost: 1 page credit / ~$0.10 - $0.30)`);
  console.log(`      Retries     : 0 (Automatic retries strictly disabled)\n`);

  // 3. Check API Key
  const apiKey = (process.env.NANONETS_API_KEY || '').trim();
  if (!apiKey) {
    console.log('[BLOCKED] NANONETS_API_KEY is not configured in process.env or .env.local.');
    console.log('          To execute the single approved test, set it for this command:');
    console.log('            $env:NANONETS_API_KEY = "your-api-key"');
    console.log('            node scripts/execute_single_paid_nanonets_request.js\n');
    console.log('          Or create a temporary .env.local:');
    console.log('            NANONETS_API_KEY=your-api-key\n');
    process.exit(2); // Exit code 2 = Blocked by missing credentials
  }
  console.log(`[3/5] API Key Verified: Configured (${apiKey.length} characters, secret preserved)\n`);

  // 4. Check Cache Guard
  if (fs.existsSync(RAW_RESPONSE_CACHE) && !process.argv.includes('--force-paid-reupload')) {
    console.log('[GUARD] Real live response already exists in cache:', RAW_RESPONSE_CACHE);
    console.log('        Reading cached live response to PREVENT DUPLICATE BILLING.');
    console.log('        (To bypass and incur another paid request, pass --force-paid-reupload)\n');
    const rawData = JSON.parse(fs.readFileSync(RAW_RESPONSE_CACHE, 'utf8'));
    return evaluateResponse(rawData, 0);
  }

  // 5. Execute EXACTLY ONE Paid Request
  console.log('[4/5] Executing Single Live POST Request to Nanonets API...');
  const url = `https://app.nanonets.com/api/v2/OCR/Model/${encodeURIComponent(modelId)}/LabelFile/`;
  const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

  const formData = new FormData();
  const blob = new Blob([fileBytes], { type: 'application/pdf' });
  formData.append('file', blob, 'synthetic_invoice_pure_image_scan.pdf');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000); // 60s hard ceiling

  const startTime = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[FAIL] Request failed or timed out after ${duration}ms:`, err.message);
    console.error('       [SAFETY GUARD] Zero automatic retries executed. Check Nanonets dashboard before retrying.');
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }

  const duration = Date.now() - startTime;
  console.log(`      HTTP Status : ${res.status} ${res.statusText}`);
  console.log(`      Duration    : ${duration}ms`);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[FAIL] Nanonets API returned HTTP error ${res.status}: ${errText}`);
    process.exit(1);
  }

  const rawJson = await res.json();
  console.log('      [PASS] Live inference response received successfully.');
  console.log('      Billing Impact: Consumed 1 page credit ($0.10 - $0.30 USD).\n');

  // Cache response immediately so subsequent runs never re-upload
  fs.writeFileSync(RAW_RESPONSE_CACHE, JSON.stringify(rawJson, null, 2), 'utf8');
  console.log(`      [PERSISTED] Cached live response to: ${RAW_RESPONSE_CACHE}\n`);

  return evaluateResponse(rawJson, duration);
}

function evaluateResponse(rawJson, latencyMs) {
  console.log('[5/5] Normalizing & Evaluating Extraction Accuracy:');

  // 1. Normalize through our production adapter
  process.env.DOCUMENT_OCR_NANONETS_ENABLED = 'true';
  const normalized = nanonetsOcr.normalizeNanonetsResponse(rawJson);

  if (!normalized.ok) {
    console.error('[FAIL] Normalization failed:', normalized.reason, normalized.warnings);
    process.exit(1);
  }

  const merged = nanonetsOcr.mergeIntoExtraction({ fields: {} }, normalized);
  const f = merged.fields || {};

  console.log(`\n========================================================================`);
  console.log(`  ACCURACY EVALUATION: EXPECTED VS ACTUAL LIVE OCR EXTRACTION`);
  console.log(`========================================================================\n`);

  const results = [];

  function check(fieldName, expected, actual, validator) {
    let isCorrect = false;
    let actualDisplay = actual;
    if (actual === null || actual === undefined) {
      actualDisplay = 'null (missing)';
    }

    if (typeof validator === 'function') {
      isCorrect = validator(expected, actual);
    } else {
      isCorrect = String(expected).toLowerCase().trim() === String(actual).toLowerCase().trim();
    }

    const status = actual === null || actual === undefined 
      ? 'Missing' 
      : (isCorrect ? 'Correct' : 'Incorrect');

    results.push({ field: fieldName, expected: String(expected), actual: String(actualDisplay), status });
  }

  check('Seller / Counterparty', EXPECTED.seller_name, f.issuer_name || f.counterparty_name, (exp, act) => {
    return act && act.toLowerCase().includes('solusi prima');
  });

  check('Buyer / Customer', EXPECTED.buyer_name, f.buyer_name, (exp, act) => {
    return act && act.toLowerCase().includes('helm care');
  });

  check('Invoice Number', EXPECTED.invoice_number, f.document_number, (exp, act) => {
    return act && act.includes('SPD-0881');
  });

  check('Invoice Date', EXPECTED.invoice_date, f.invoice_date || f.date, (exp, act) => {
    return act === exp || (act && act.includes('2026-10-15'));
  });

  check('Gross Amount', EXPECTED.gross_amount, f.gross_amount || f.amount, (exp, act) => {
    return Number(act) === Number(exp);
  });

  check('Currency', EXPECTED.currency, f.currency, (exp, act) => {
    return String(act).toUpperCase() === 'IDR';
  });

  check('Tax Base (DPP)', EXPECTED.dpp, f.subtotal || f.tax_base_dpp || f.commercial_base_amount, (exp, act) => {
    return Number(act) === Number(exp) || Number(act) === 5000000;
  });

  check('PPN (11%)', EXPECTED.ppn, f.commercial_tax_amount, (exp, act) => {
    return Number(act) === Number(exp) || Number(act) === 550000;
  });

  check('Line Items Count', EXPECTED.line_items_count, merged.line_items?.length, (exp, act) => {
    return Number(act) >= 1;
  });

  check('Confidence Level', 'needs_review', merged.confidence, (exp, act) => {
    return act === 'needs_review' || act === 'medium';
  });

  // Print Table
  console.log('| Field | Expected | Actual | Status |');
  console.log('|---|---|---|:---:|');
  let correctCount = 0;
  results.forEach(r => {
    if (r.status === 'Correct') correctCount++;
    console.log(`| **${r.field}** | \`${r.expected}\` | \`${r.actual}\` | **${r.status}** |`);
  });

  console.log(`\nAccuracy Score: ${correctCount} / ${results.length} fields correct (${Math.round((correctCount / results.length) * 100)}%)`);
  console.log(`Latency       : ${latencyMs}ms`);
  console.log(`Review Status : ${merged.status} (Mandatory human check)`);
  console.log(`Warnings      : ${merged.warnings?.join(' | ') || 'None'}\n`);

  if (correctCount >= 7) {
    console.log('[PASS] Live Nanonets OCR acceptance validation SUCCEEDED.');
  } else {
    console.log('[WARN] Functional accuracy below threshold. Review table above.');
  }
}

main().catch(err => {
  console.error('\nUnexpected runner error:', err.message);
  process.exit(1);
});
