'use strict';
/**
 * CFO AI — Secure Nanonets Authentication Verification Tool
 *
 * Verifies Nanonets API credentials without uploading documents or incurring paid usage.
 * Uses HTTP GET to query model/account status. Zero file uploads, zero OCR extraction billing.
 *
 * Usage:
 *   node scripts/verify_nanonets_auth.js
 *
 * Security:
 *   Never logs, echoes, or writes the API key value.
 */

const fs = require('fs');
const path = require('path');
const nanonetsOcr = require('../server/lib/nanonetsOcr');

// Optional: check local .env.local or .env if process.env is unset
function loadLocalEnvIfPresent() {
  const candidates = ['.env.local', '.env'];
  for (const filename of candidates) {
    const fullPath = path.resolve(__dirname, '..', filename);
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
            if (!process.env[key] && val) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

async function run() {
  loadLocalEnvIfPresent();

  console.log('========================================================================');
  console.log('  CFO AI — NANONETS AUTHENTICATION & CONFIGURATION VERIFICATION');
  console.log('========================================================================\n');

  const apiKey = nanonetsOcr.getNanonetsApiKey();
  const modelId = nanonetsOcr.getNanonetsModelId();
  const baseUrl = nanonetsOcr.getNanonetsBaseUrl();
  const isEnabled = nanonetsOcr.nanonetsEnabled();

  console.log(`Feature Flag (DOCUMENT_OCR_NANONETS_ENABLED) : ${isEnabled ? 'ENABLED' : 'DISABLED (Default Safe)'}`);
  console.log(`API Base URL                                : ${baseUrl}`);
  console.log(`Configured Model ID                         : ${modelId}`);
  console.log(`API Key Status                              : ${apiKey ? `CONFIGURED (${apiKey.length} characters)` : 'NOT SET'}\n`);

  if (!apiKey) {
    console.log('[!] NANONETS_API_KEY is not set.');
    console.log('    To set it in PowerShell for this session:');
    console.log('      $env:NANONETS_API_KEY="your-nanonets-api-key"');
    console.log('    Or add it to .env.local:');
    console.log('      NANONETS_API_KEY=your-nanonets-api-key\n');
    process.exit(1);
  }

  const rawModelId = (process.env.NANONETS_MODEL_ID || '').trim();
  if (!rawModelId || rawModelId === 'invoices') {
    console.log('[!] NANONETS_MODEL_ID is not set.');
    console.log('    Nanonets requires an explicit Model UUID (e.g. from your workflow).');
    console.log('    "invoices" is a generic placeholder and is not accepted by the Nanonets API.\n');
    console.log('    How to find your Model ID:');
    console.log('      1. Go to https://app.nanonets.com and open your invoice model/workflow.');
    console.log('      2. Copy the UUID from your browser address bar: https://app.nanonets.com/#/workflow/{MODEL_ID}');
    console.log('         (or from Model Settings -> Model Details -> Model ID).');
    console.log('      3. In PowerShell, set:');
    console.log('         $env:NANONETS_MODEL_ID="your-model-uuid"');
    console.log('         Or in .env.local:');
    console.log('         NANONETS_MODEL_ID=your-model-uuid\n');
    process.exit(1);
  }

  console.log('Testing authentication via zero-cost GET request...');
  const start = Date.now();
  const res = await nanonetsOcr.verifyNanonetsAuth();
  const duration = Date.now() - start;

  if (res.ok) {
    console.log(`\n[PASS] Authentication SUCCESSFUL (${duration}ms)`);
    console.log(`       HTTP Status      : ${res.status}`);
    console.log(`       Verified Model ID: ${res.model_id || '(none)'}`);
    console.log(`       Model Type       : ${res.model_type}`);
    if (res.categories_count !== null) {
      console.log(`       Active Categories: ${res.categories_count}`);
    }
    if (Array.isArray(res.available_models) && res.available_models.length > 0) {
      console.log(`\n       Available Models in Account (${res.available_models.length}):`);
      res.available_models.forEach((m, idx) => {
        console.log(`         [${idx + 1}] ID: ${m.model_id} | Type: ${m.model_type} | Categories: ${m.categories_count ?? 'N/A'} | State: ${m.state ?? 'Ready'}`);
      });
    }
    console.log(`\n       Billing Impact   : $0.00 (Zero files uploaded, zero OCR charges incurred)\n`);
  } else {
    console.log(`\n[FAIL] Authentication FAILED (${duration}ms)`);
    console.log(`       HTTP Status: ${res.status}`);
    console.log(`       Error      : ${res.error}\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('\nUnexpected verification error:', err.message);
  process.exit(1);
});
