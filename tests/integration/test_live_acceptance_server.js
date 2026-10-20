'use strict';
/**
 * CFO AI — Live Acceptance Test Isolated Local Environment
 *
 * Guarantees:
 * 1. 100% Isolated in-memory PostgREST/Supabase layer via tests/integration/_memorySupabase.js
 * 2. In-memory private document storage (zero production storage calls)
 * 3. Seeded synthetic Business: "PT Helm Care Indonesia (Synthetic Test)" (biz-synthetic-sept2026)
 * 4. Zero paid API calls (ANTHROPIC_API_KEY unset, DOCUMENT_OCR_VISION_ENABLED=false)
 * 5. Serves both REST API on http://127.0.0.1:5611/api and built client SPA on http://127.0.0.1:5611
 */

const path = require('path');
const Module = require('module');
const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '../..');
const mem = require(path.join(ROOT, 'tests/integration/_memorySupabase'));

const PORT = 5611;
const JWT_SECRET = 'cfo-ai-acceptance-test-secret-2026';
const USER_ID = 950101;
const BIZ_ID = 'biz-synthetic-sept2026';

Object.assign(process.env, {
  PORT: String(PORT),
  NODE_ENV: 'development',
  JWT_SECRET,
  SUPABASE_URL: 'http://127.0.0.1:5613',
  SUPABASE_SECRET_KEY: 'synthetic-service-key',
  BOT_TOKEN: '0000000000:synthetic-test-bot',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic-webhook-secret',
  DOCUMENT_OCR_VISION_ENABLED: 'false',
  DOCUMENT_OCR_NANONETS_ENABLED: 'true',
  NANONETS_MODEL_ID: process.env.NANONETS_MODEL_ID || 'a80d8b72-f30c-46b4-ab6b-9a0de779815b',
  NANONETS_FILE_ID: process.env.NANONETS_FILE_ID || '94a89e4d-cb8a-11f1-b28c-166052257c09',
  CLIENT_URL: `http://127.0.0.1:${PORT}`,
});
delete process.env.ANTHROPIC_API_KEY;

// In-memory file storage
const MEMORY_STORAGE = new Map();

// Intercept Supabase client
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') {
    const client = mem.createClient();
    client.storage = {
      from: (bucket) => ({
        download: async (storagePath) => {
          const fileBuf = MEMORY_STORAGE.get(storagePath);
          if (!fileBuf) return { data: null, error: { message: 'Object not found in test storage' } };
          return {
            data: {
              arrayBuffer: async () => fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength),
            },
            error: null,
          };
        },
        createSignedUploadUrl: async (storagePath) => ({
          data: {
            signedUrl: `http://127.0.0.1:5613/test-storage-upload?path=${encodeURIComponent(storagePath)}`,
            token: 'test-upload-token',
            path: storagePath,
          },
          error: null,
        }),
        createSignedUrl: async (storagePath) => ({
          data: {
            signedUrl: `http://127.0.0.1:5613/test-storage-download?path=${encodeURIComponent(storagePath)}`,
          },
          error: null,
        }),
      }),
      createBucket: async () => ({ data: null, error: null }),
      getBucket: async () => ({ data: { id: 'financial-documents', public: false }, error: null }),
    };
    return { ...mem, createClient: () => client };
  }
  return origLoad.apply(this, arguments);
};

// Seed synthetic data
mem.__seed('users', [
  { id: USER_ID, username: 'cfo_acceptance_tester', created_at: '2026-01-01T00:00:00.000Z' }
]);

mem.__seed('businesses', [
  {
    id: BIZ_ID,
    name: 'PT Helm Care Indonesia (Synthetic Test)',
    legal_name: 'PT HELM CARE INDONESIA',
    type: 'company',
    base_currency: 'IDR',
    plan: 'founder',
    subscription_status: 'active',
    owner_user_id: USER_ID,
    npwp: '1000000002284592',
    created_at: '2026-01-01T00:00:00.000Z',
  }
]);

mem.__seed('business_members', [
  { id: 1, user_id: USER_ID, business_id: BIZ_ID, role: 'owner', status: 'active' }
]);

mem.__seed('business_addons', [
  { id: 'ad-ai', business_id: BIZ_ID, addon: 'ai_accountant', status: 'active' },
  { id: 'ad-doc', business_id: BIZ_ID, addon: 'document_center', status: 'active' }
]);

mem.__seed('tax_rules', [
  { rule_code: 'ID_PPN_12', status: 'active', rate: 0.12, last_verified_at: '2026-09-01T00:00:00Z', official_source_id: 'src-1' },
  { rule_code: 'ID_PPN_11', status: 'active', rate: 0.11, last_verified_at: '2026-09-01T00:00:00Z', official_source_id: 'src-1' },
]);

mem.__seed('official_sources', [
  { id: 'src-1', code: 'DJP_UU_HPP', status: 'active', last_verified_at: '2026-09-01T00:00:00Z' }
]);

mem.__seed('bank_accounts', [
  {
    id: 'acc-danamon-01',
    business_id: BIZ_ID,
    bank_name: 'BANK DANAMON',
    account_number: '003537947016',
    account_holder: 'PT HELM CARE INDONESIA',
    currency: 'IDR',
    created_at: '2026-08-01T00:00:00.000Z',
  }
]);

mem.__seed('counterparties', [
  {
    id: 'cp-arys-mikro',
    business_id: BIZ_ID,
    name: "Ary's mikro",
    legal_name: "Ary's mikro",
    status: 'active',
    created_at: '2026-08-01T00:00:00.000Z',
  }
]);

mem.__seed('transactions', [
  {
    id: 88001,
    business_id: BIZ_ID,
    amount: 4500000,
    direction: 'outflow',
    description: "Sewa Tempat Helm Care - Ary's mikro Danamon",
    date: '2026-08-25',
    status: 'settled',
    account_id: 'acc-danamon-01',
    created_at: '2026-08-25T10:00:00.000Z',
  }
]);

// Boot Server
require(path.join(ROOT, 'server/index.js'));

// Direct upload helper route for the test environment
const app = require('express');
// Add storage PUT endpoint
const testStorageServer = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, 'http://127.0.0.1:5613');
  if (req.method === 'PUT') {
    let storagePath = parsedUrl.searchParams.get('path');
    if (!storagePath) {
      const m = parsedUrl.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/[^/]+\/(.+)$/);
      if (m) storagePath = decodeURIComponent(m[1]);
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (storagePath) MEMORY_STORAGE.set(storagePath, buffer);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, size: buffer.length }));
    });
    return;
  }
  if (parsedUrl.pathname === '/test-storage-download' && req.method === 'GET') {
    const storagePath = parsedUrl.searchParams.get('path');
    const buffer = MEMORY_STORAGE.get(storagePath);
    if (!buffer) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(buffer);
    return;
  }
});

testStorageServer.listen(5613, '127.0.0.1', () => {
  console.log('[TEST STORAGE] Listening on http://127.0.0.1:5613');
});

// Generate auth token for test
const authToken = jwt.sign({ userId: USER_ID }, JWT_SECRET, { expiresIn: '7d' });

console.log('\n========================================================================');
console.log('  CFO AI LIVE ACCEPTANCE ENVIRONMENT READY');
console.log('========================================================================');
console.log(`Backend API URL       : http://127.0.0.1:${PORT}/api`);
console.log(`Frontend Web URL      : http://127.0.0.1:${PORT}`);
console.log(`Test Business Name    : PT Helm Care Indonesia (Synthetic Test)`);
console.log(`Test Business ID      : ${BIZ_ID}`);
console.log(`Test User ID          : ${USER_ID}`);
console.log(`Auth Bearer Token     : ${authToken}`);
console.log(`Database / Storage    : 100% In-Memory (Zero Production Mutation Guarantee)`);
console.log(`OCR Phase 0 Version   : Commit bd1188f`);
console.log('========================================================================\n');

module.exports = {
  PORT, BIZ_ID, USER_ID, authToken, MEMORY_STORAGE
};
