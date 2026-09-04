// POST /api/documents/:id/intake — the pipeline over real HTTP.
// Boots the REAL server/index.js over the in-memory supabase shim, with storage
// backed by real PDFs carrying real Flate-compressed text.
//
// Run: node tests/integration/documentIntake.v2.test.js
const path = require('path');
const Module = require('module');
const zlib = require('node:zlib');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'intake-v2-test-secret', TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5611', NODE_ENV: 'test',
});

function makePdf(text) {
  const content = `BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g, ' ')}) Tj ET`;
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ${stream.length}/Filter/FlateDecode>>stream\n`, 'latin1'),
    stream,
    Buffer.from('\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1'),
  ]);
}

const US = 'Helm Care Indonesia';
const FILES = {
  'b/a/supplier.pdf': makePdf('Invoice No. Invoice INV-2026-0042 Dari : PT Sumber Makmur Sentosa '
    + 'NPWP : 01.222.333.4-555.666 Kepada : PT Helm Care Indonesia Netto 25.000.000'),
  'b/a/customer.pdf': makePdf('Invoice No. Invoice OUT-2026-0007 Dari : PT Helm Care Indonesia '
    + 'Kepada : PT Ritel Nusantara Jaya Netto 8.500.000'),
  'b/a/scan.pdf': Buffer.from('%PDF-1.4\n% no text layer at all\n%%EOF\n', 'latin1'),
  'b/b/other.pdf': makePdf('Invoice Netto 1.000'),
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') {
    const client = mem.createClient();
    client.storage = { from: () => ({
      download: async (p) => (FILES[p]
        ? { data: { arrayBuffer: async () => FILES[p] }, error: null }
        : { data: null, error: { message: 'not found' } }),
      createSignedUploadUrl: async () => ({ data: null, error: null }),
    }) };
    return { ...mem, createClient: () => client };
  }
  return origLoad.apply(this, arguments);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const P = '44444444-4444-4444-4444-444444444444';
const USER = 950101;

mem.__seed('businesses', [
  { id: A, name: US, type: 'company', owner_user_id: USER, created_at: '2026-01-01' },
  { id: B, name: 'Helm Care Pay', type: 'company', owner_user_id: 999, created_at: '2026-01-02' },
  { id: P, name: 'Personal', type: 'personal', owner_user_id: USER, created_at: '2026-01-03' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: USER, business_id: A, role: 'owner', status: 'active' },
  { id: 3, user_id: USER, business_id: P, role: 'owner', status: 'active' },
]);
mem.__seed('business_addons', [{ id: 'ad', business_id: A, addon: 'ai_accountant', status: 'active' }]);
mem.__seed('document_files', [
  { id: 'f-sup', business_id: A, storage_path: 'b/a/supplier.pdf', file_name: 'supplier.pdf', mime_type: 'application/pdf' },
  { id: 'f-cus', business_id: A, storage_path: 'b/a/customer.pdf', file_name: 'customer.pdf', mime_type: 'application/pdf' },
  { id: 'f-scan', business_id: A, storage_path: 'b/a/scan.pdf', file_name: 'scan.pdf', mime_type: 'application/pdf' },
  { id: 'f-b', business_id: B, storage_path: 'b/b/other.pdf', file_name: 'other.pdf', mime_type: 'application/pdf' },
]);
mem.__seed('financial_documents', [
  { id: 'd-sup', business_id: A, file_id: 'f-sup', document_type: 'other', currency: 'IDR' },
  { id: 'd-cus', business_id: A, file_id: 'f-cus', document_type: 'other', currency: 'IDR' },
  { id: 'd-scan', business_id: A, file_id: 'f-scan', document_type: 'other', currency: 'IDR' },
  { id: 'd-arch', business_id: A, file_id: 'f-sup', document_type: 'other', archived_at: '2026-08-01T00:00:00Z' },
  { id: 'd-b', business_id: B, file_id: 'f-b', document_type: 'other', currency: 'IDR' },
]);
mem.__seed('counterparties', [
  { id: 'cp-1', business_id: A, name: 'PT Sumber Makmur Sentosa', type: 'vendor',
    npwp: '01.222.333.4-555.666', status: 'active', is_active: true },
]);
// No verified rule exists, mirroring production after migration 023.
mem.__seed('tax_rules', [
  { rule_code: 'ID_PPH42_RENT', status: 'under_review', rate: 0.1, last_verified_at: null, official_source_id: null },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
async function call(method, p, { user = USER, biz } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + p, { method, headers });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}
const docRow = (id) => (mem.__db.financial_documents || []).find((d) => d.id === id);

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  console.log('\nPipeline');
  await t('a supplier invoice resolves to a payable with a matched counterparty', async () => {
    const r = await call('POST', '/documents/d-sup/intake', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.document.type, 'invoice');
    assert.strictEqual(r.body.document.direction, 'payable');
    assert.strictEqual(r.body.financial_record.suggested_record_type, 'payable');
    assert.strictEqual(r.body.financial_record.amount, 25000000);
    assert.strictEqual(r.body.counterparty.status, 'matched');
    assert.strictEqual(r.body.counterparty.matched_counterparty_id, 'cp-1');
    assert.strictEqual(r.body.status, 'ready_to_confirm');
    assert.strictEqual(r.body.financial_record.can_create_draft, true);
  });

  await t('a customer invoice resolves to a receivable', async () => {
    const r = await call('POST', '/documents/d-cus/intake', { biz: A });
    assert.strictEqual(r.body.document.direction, 'receivable');
    assert.strictEqual(r.body.financial_record.suggested_record_type, 'receivable');
    assert.strictEqual(r.body.financial_record.amount, 8500000);
    // unknown counterparty → a suggestion, never a create
    assert.strictEqual(r.body.counterparty.status, 'not_found');
    assert.strictEqual(r.body.status, 'needs_counterparty');
    assert.ok(r.body.next_actions.some((a) => a.key === 'create_counterparty' && a.enabled));
  });

  await t('a scan with no text layer is unsupported and invents nothing', async () => {
    const r = await call('POST', '/documents/d-scan/intake', { biz: A });
    assert.strictEqual(r.body.status, 'unsupported');
    assert.strictEqual(r.body.financial_record.amount, null);
    assert.strictEqual(r.body.financial_record.can_create_draft, false);
  });

  await t('an under-review tax rule never becomes a suggestion', async () => {
    const r = await call('POST', '/documents/d-sup/intake', { biz: A });
    assert.strictEqual(r.body.tax.accountant_review_required, true);
    assert.notStrictEqual(r.body.tax.withholding_status, 'suggested');
  });

  console.log('\nWrites and idempotency');
  await t('the run writes only review metadata into ai_intake_v2', async () => {
    const row = docRow('d-sup');
    const v2 = (row.extracted_json || {}).ai_intake_v2;
    assert.ok(v2, 'the summary must be stored');
    assert.strictEqual(v2.version, 'intake-v1');
    assert.strictEqual(v2.suggested_record_type, 'payable');
    // and nothing financial was created
    assert.strictEqual((mem.__db.debts || []).length, 0, 'no debt may be created');
    assert.strictEqual((mem.__db.transactions || []).length, 0, 'no transaction may be created');
    assert.strictEqual((mem.__db.counterparties || []).length, 1, 'no counterparty may be created');
  });

  await t('22. re-running is stable and does not rewrite an unchanged summary', async () => {
    const first = await call('POST', '/documents/d-sup/intake', { biz: A });
    const before = JSON.stringify(docRow('d-sup').extracted_json.ai_intake_v2);
    const second = await call('POST', '/documents/d-sup/intake', { biz: A });
    assert.strictEqual(second.body.stored, false, 'an unchanged summary must not be written again');
    const after = JSON.stringify(docRow('d-sup').extracted_json.ai_intake_v2);
    assert.strictEqual(after, before);
    assert.strictEqual(first.body.status, second.body.status);
    assert.deepStrictEqual(first.body.financial_record, second.body.financial_record);
  });

  await t('persist=false makes it a pure read', async () => {
    const row = docRow('d-cus');
    const before = JSON.stringify(row.extracted_json || null);
    const r = await call('POST', '/documents/d-cus/intake?persist=false', { biz: A });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.stored, false);
    assert.strictEqual(JSON.stringify(docRow('d-cus').extracted_json || null), before);
  });

  await t('the document_type is NOT silently overwritten', async () => {
    // The stored type stays whatever a human set; intake only suggests.
    assert.strictEqual(docRow('d-sup').document_type, 'other');
  });

  console.log('\nGuards');
  await t('20. a document in another business is refused', async () => {
    const r = await call('POST', '/documents/d-b/intake', { biz: A });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'document_not_found_in_this_business');
  });

  await t('21. a personal workspace is refused', async () => {
    const r = await call('POST', '/documents/d-sup/intake', { biz: P });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'business_workspace_required');
  });

  await t('an archived document is refused', async () => {
    const r = await call('POST', '/documents/d-arch/intake', { biz: A });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'document_archived');
  });

  await t('unauthenticated is refused', async () => {
    const r = await call('POST', '/documents/d-sup/intake', { user: null });
    assert.strictEqual(r.status, 401, `status ${r.status}`);
  });

  await t('nothing leaked into business B', async () => {
    const bDoc = docRow('d-b');
    assert.ok(!(bDoc.extracted_json || {}).ai_intake_v2, 'B document must not be processed');
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
