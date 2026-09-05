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
  'b/a/scan2.pdf': Buffer.from('%PDF-1.4\n% another scan, no text\n%%EOF\n', 'latin1'),
  // A kwitansi that DOES carry embedded text: it must be read by the parser and must
  // never reach the vision reader, which is what proves OCR is a fallback and not a
  // first resort.
  'b/a/kwt.pdf': makePdf('KWITANSI PT Sumber Alfaria Trijaya Tbk '
    + 'Sudah terima dari : HELM CARE INDONESIA Berupa : TRANSFER '
    + 'Jumlah : Rp 11.322.000 Tanggal : 04-08-2026'),
  // Only OUR company appears — the production self-match case.
  'b/a/self.pdf': makePdf('Invoice No. Invoice SELF-1 Kepada : PT HELM CARE INDONESIA '
    + 'NPWP : 09.876.543.2-101.000 Netto 2.000.000'),
  // Two dates that must not be confused with each other.
  'b/a/dates.pdf': makePdf('Invoice No. Invoice DATE-1 Dari : PT Sumber Makmur Sentosa '
    + 'Kepada : PT Helm Care Indonesia Tanggal : 15 Agustus 2026 '
    + 'Jatuh Tempo : 14 September 2026 Netto 3.000.000'),
  'b/b/other.pdf': makePdf('Invoice Netto 1.000'),
};

// The vision reader talks to the Anthropic SDK. Intercepting the module keeps the whole
// OCR path under test with no network and no key — and proves the flag really gates it,
// because a call arriving while OCR is off would show up in OCR_CALLS.
let OCR_MODE = 'ok';
let V3_MODE = 'ok';
const OCR_CALLS = [];

// The structure a native visual read returns: two whole parties, three distinct dates,
// three distinct amounts. Nothing here is prose to be re-parsed.
const ev = (t, section) => [{ page: 1, printed_text: t, section }];
// A real model answers differently per document, so the stub must too — otherwise the
// tests only prove the plumbing. It reads the weak file-name hint in the request, which
// is the one thing that differs between our fixtures.
const V3_RESULT = (args) => {
  const text = args?.messages?.[0]?.content?.[1]?.text || '';
  const isKwitansi = /kwitansi|scan\.pdf/i.test(text);
  const base = V3_INVOICE();
  if (!isKwitansi) return base;
  return {
    ...base,
    document_type: { value: 'receipt', confidence: 0.96, evidence: ev('KWITANSI', 'title') },
    dates: {
      document_date: { value: '2026-08-04', printed_text: '04-08-2026', confidence: 0.95, evidence: ev('Tanggal: 04-08-2026') },
      due_date: { value: null, printed_text: null, confidence: 0, evidence: [] },
      payment_date: { value: '2026-08-04', printed_text: '04-08-2026', confidence: 0.95, evidence: ev('Tanggal: 04-08-2026') },
    },
    amounts: {
      currency: 'IDR',
      dpp: { value: null, calculated: false, confidence: 0, evidence: [] },
      ppn: { value: null, calculated: false, confidence: 0, evidence: [] },
      total: { value: 11322000, calculated: false, confidence: 0.97, evidence: ev('Jumlah: Rp 11.322.000') },
    },
  };
};

const V3_INVOICE = () => ({
  schema_version: 'financial_document_extraction_v3',
  document_type: { value: 'faktur_pajak', confidence: 0.97, evidence: ev('Faktur Pajak', 'title') },
  document_number: { value: 'X2610001139', confidence: 0.95, evidence: [] },
  language: ['id'],
  parties: [
    { party_id: 'party_1', role: 'supplier',
      legal_name: { value: 'PT SUMBER ALFARIA TRIJAYA TBK', confidence: 0.98, evidence: ev('PT SUMBER ALFARIA TRIJAYA TBK', 'issuer_header') },
      npwp: { value: '01.336.238.9-054.000', normalized_value: '013362389054000', confidence: 0.96, evidence: ev('NPWP: 01.336.238.9-054.000', 'issuer_header') },
      address: { value: null, confidence: 0, evidence: [] }, bank_accounts: [] },
    { party_id: 'party_2', role: 'buyer',
      legal_name: { value: 'PT Helm Care Indonesia', confidence: 0.98, evidence: ev('PT Helm Care Indonesia', 'buyer_header') },
      npwp: { value: null, normalized_value: null, confidence: 0, evidence: [] },
      address: { value: null, confidence: 0, evidence: [] }, bank_accounts: [] },
  ],
  current_business_party_id: 'party_2',
  counterparty_candidate_party_id: 'party_1',
  relationship_confidence: 0.97,
  dates: {
    document_date: { value: '2026-08-04', printed_text: '04 Agustus 2026', confidence: 0.96, evidence: ev('Tanggal: 04 Agustus 2026') },
    due_date: { value: '2026-09-03', printed_text: '03 September 2026', confidence: 0.9, evidence: ev('Jatuh Tempo') },
    payment_date: { value: null, printed_text: null, confidence: 0, evidence: [] },
  },
  amounts: {
    currency: 'IDR',
    dpp: { value: 10200000, calculated: false, confidence: 0.96, evidence: ev('Dasar Pengenaan Pajak 10.200.000') },
    ppn: { value: 1122000, calculated: false, confidence: 0.96, evidence: ev('Jumlah PPN 1.122.000') },
    total: { value: 11322000, calculated: false, confidence: 0.97, evidence: ev('Netto 11.322.000') },
  },
  warnings: [], pages_analyzed: [1], page_count: 1, analysis_complete: true,
});
const KWITANSI_JSON = JSON.stringify({
  text: 'KWITANSI PT Sumber Alfaria Trijaya Tbk Sudah terima dari : HELM CARE INDONESIA '
    + 'Berupa : TRANSFER Untuk pembayaran : Sewa lokasi Jumlah : Rp 11.322.000 Tanggal : 04-08-2026',
  document_type: 'receipt', confidence: 'high',
  fields: { document_number: 'KWT/TC-2607/0342', issuer_name: 'PT Sumber Alfaria Trijaya Tbk',
    buyer_name: null, counterparty_name: 'HELM CARE INDONESIA', date: '2026-08-04',
    currency: 'IDR', amount: 11322000, gross_amount: 11322000,
    commercial_base_amount: null, commercial_tax_amount: null, payment_method: 'TRANSFER',
    period_start: null, period_end: null, reference_number: null, npwp: null },
  warnings: [],
});

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') {
    return class FakeAnthropic {
      constructor() {
        this.messages = { create: async (args) => {
          OCR_CALLS.push(args);
          if (OCR_MODE === 'throw') throw new Error('provider unavailable');
          // A v3 request forces a tool; anything else is the legacy prose reader.
          if (args.tool_choice?.type === 'tool') {
            if (V3_MODE === 'reject') return { content: [{ type: 'text', text: 'no tool for you' }] };
            return {
              content: [{ type: 'tool_use', name: 'record_financial_document', input: V3_RESULT(args) }],
              usage: { input_tokens: 3000, output_tokens: 700 },
            };
          }
          return { content: [{ type: 'text', text: KWITANSI_JSON }] };
        } };
      }
    };
  }
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
  { id: 'f-scan2', business_id: A, storage_path: 'b/a/scan2.pdf', file_name: 'scan2.pdf', mime_type: 'application/pdf' },
  { id: 'f-kwt', business_id: A, storage_path: 'b/a/kwt.pdf', file_name: 'kwitansi.pdf', mime_type: 'application/pdf' },
  { id: 'f-self', business_id: A, storage_path: 'b/a/self.pdf', file_name: 'self.pdf', mime_type: 'application/pdf' },
  { id: 'f-dates', business_id: A, storage_path: 'b/a/dates.pdf', file_name: 'dates.pdf', mime_type: 'application/pdf' },
  { id: 'f-b', business_id: B, storage_path: 'b/b/other.pdf', file_name: 'other.pdf', mime_type: 'application/pdf' },
]);
mem.__seed('financial_documents', [
  { id: 'd-sup', business_id: A, file_id: 'f-sup', document_type: 'other', currency: 'IDR' },
  { id: 'd-cus', business_id: A, file_id: 'f-cus', document_type: 'other', currency: 'IDR' },
  { id: 'd-scan', business_id: A, file_id: 'f-scan', document_type: 'other', currency: 'IDR',
    extracted_json: { upload_intent: { source: 'invoice_upload', label: 'Invoice',
      suggested_document_type: 'invoice', suggested_direction: null,
      created_at: '2026-09-04T10:00:00.000Z', actor_user_id: 950101 } } },
  { id: 'd-scan2', business_id: A, file_id: 'f-scan2', document_type: 'other', currency: 'IDR' },
  { id: 'd-kwt', business_id: A, file_id: 'f-kwt', document_type: 'other', currency: 'IDR',
    extracted_json: { upload_intent: { source: 'invoice_upload', label: 'Invoice',
      suggested_document_type: 'invoice', suggested_direction: null,
      created_at: '2026-09-04T10:00:00.000Z' } } },
  { id: 'd-self', business_id: A, file_id: 'f-self', document_type: 'other', currency: 'IDR' },
  { id: 'd-dates', business_id: A, file_id: 'f-dates', document_type: 'other', currency: 'IDR' },
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

  // ── the Document Center has to be able to READ the summary ────────────────
  console.log('\nExposure through /api/documents');
  await t('the intake summary reaches the client through GET /api/documents', async () => {
    const r = await call('GET', '/documents', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    const row = (r.body.documents || []).find((d) => d.id === 'd-sup');
    assert.ok(row, 'the document must be listed');
    const v2 = row.extracted_json?.ai_intake_v2;
    assert.ok(v2, 'ai_intake_v2 must no longer be stripped on read');
    assert.strictEqual(v2.document_type, 'invoice');
    assert.strictEqual(v2.direction, 'payable');
    assert.strictEqual(v2.suggested_record_type, 'payable');
    assert.strictEqual(v2.amount, 25000000);
    assert.ok(Array.isArray(v2.next_action_keys) && v2.next_action_keys.length > 0);
  });

  await t('the stored document_type column is still "other" on that same row', async () => {
    // The card must be able to show BOTH: the column a human owns, and the suggestion.
    const r = await call('GET', '/documents', { biz: A });
    const row = (r.body.documents || []).find((d) => d.id === 'd-sup');
    assert.strictEqual(row.document_type, 'other');
  });

  await t('the summary is a whitelist — extraction internals stay server-side', async () => {
    // Plant private fields on the stored summary and confirm the serialiser drops them.
    const row = docRow('d-sup');
    row.extracted_json.ai_intake_v2.raw_text = 'PT Sumber Makmur Sentosa … Netto 25.000.000';
    row.extracted_json.ai_intake_v2.storage_path = 'b/a/supplier.pdf';
    const r = await call('GET', '/documents', { biz: A });
    const v2 = (r.body.documents || []).find((d) => d.id === 'd-sup').extracted_json.ai_intake_v2;
    assert.ok(!('raw_text' in v2), 'document text must never be exposed');
    assert.ok(!('storage_path' in v2), 'storage paths must never be exposed');
    assert.strictEqual(JSON.stringify(r.body).includes('b/a/supplier.pdf'), false,
      'no storage path anywhere in the payload');
  });

  await t('an unreadable scan is exposed as unsupported, not as an empty invoice', async () => {
    const r = await call('GET', '/documents', { biz: A });
    const v2 = (r.body.documents || []).find((d) => d.id === 'd-scan').extracted_json.ai_intake_v2;
    assert.strictEqual(v2.status, 'unsupported');
    assert.strictEqual(v2.amount, null);
    assert.strictEqual(v2.suggested_record_type, 'none');
  });

  await t('a personal workspace cannot read the summary either', async () => {
    const r = await call('GET', '/documents', { biz: P });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'business_workspace_required');
  });

  // ── upload intent and the OCR fallback ────────────────────────────────────
  console.log('\nUpload intent');
  await t('3. the intent is returned to the client, whitelisted', async () => {
    const r = await call('GET', '/documents', { biz: A });
    const row = (r.body.documents || []).find((d) => d.id === 'd-kwt');
    const up = row.extracted_json?.upload_intent;
    assert.ok(up, 'the upload intent must reach the UI');
    assert.strictEqual(up.source, 'invoice_upload');
    assert.strictEqual(up.label, 'Invoice');
    assert.deepStrictEqual(Object.keys(up).sort(),
      ['created_at', 'label', 'source', 'suggested_direction', 'suggested_document_type']);
    assert.ok(!('actor_user_id' in up));
  });

  await t('3. an embedded-text PDF IS still analysed visually', async () => {
    // The old rule was "if embedded text exists, skip Vision". That is exactly what left
    // classification to regexes, so it is gone: a text layer says which characters are
    // present, not what the document means.
    process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
    const before = OCR_CALLS.length;
    const r = await call('POST', '/documents/d-kwt/intake', { biz: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.source, 'native_pdf_vision', `source was ${r.body.source}`);
    assert.ok(OCR_CALLS.length > before, 'a text-bearing PDF must still reach the model');
    const sent = OCR_CALLS[OCR_CALLS.length - 1];
    assert.strictEqual(sent.messages[0].content[0].type, 'document', 'the ORIGINAL pdf was sent');
    assert.strictEqual(sent.tool_choice?.type, 'tool', 'the schema was forced');
    // …and the intent still does not touch the column.
    assert.strictEqual(docRow('d-kwt').document_type, 'other');
    delete process.env.DOCUMENT_OCR_VISION_ENABLED;
  });

  await t('the kwitansi conflict is raised on the embedded-text path too', async () => {
    const r = await call('POST', '/documents/d-kwt/intake', { biz: A });
    assert.strictEqual(r.body.intent_conflict, true);
    assert.ok(r.body.blockers.some((b) => /Uploaded as Invoice/.test(b)), JSON.stringify(r.body.blockers));
  });

  console.log('\n6/5. the OCR fallback');
  await t('6. with OCR disabled a scan stays unsupported and says why', async () => {
    delete process.env.DOCUMENT_OCR_VISION_ENABLED;
    const r = await call('POST', '/documents/d-scan/intake', { biz: A });
    assert.strictEqual(r.body.status, 'unsupported');
    assert.strictEqual(r.body.source, 'filename_only');
    assert.strictEqual(r.body.financial_record.amount, null);
    assert.ok(/OCR\/Vision is not enabled/i.test(r.body.blockers[0]), r.body.blockers[0]);
  });

  await t('5. with OCR enabled the same scan is read and classified', async () => {
    process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
    const r = await call('POST', '/documents/d-scan/intake', { biz: A });
    assert.strictEqual(r.body.source, 'native_pdf_vision', `source was ${r.body.source}`);
    assert.strictEqual(r.body.document.type, 'receipt');
    assert.strictEqual(r.body.financial_record.amount, 11322000);
    assert.notStrictEqual(r.body.status, 'unsupported');
  });

  await t('7/8. a KWITANSI is a receipt — supporting evidence, never a payable', async () => {
    const r = await call('POST', '/documents/d-scan/intake', { biz: A });
    assert.strictEqual(r.body.document.type, 'receipt');
    assert.strictEqual(r.body.financial_record.suggested_record_type, 'supporting_document');
    assert.notStrictEqual(r.body.financial_record.suggested_record_type, 'payable');
  });

  await t('9. uploaded as an invoice but read as a receipt raises a conflict', async () => {
    const r = await call('POST', '/documents/d-scan/intake', { biz: A });
    assert.strictEqual(r.body.intent_conflict, true);
    assert.ok(r.body.blockers.some((b) => /Uploaded as Invoice/.test(b)), JSON.stringify(r.body.blockers));
    assert.ok(r.body.next_actions.some((a) => a.key === 'review_fields'));
  });

  await t('11/12/13. reading it created nothing', async () => {
    assert.strictEqual((mem.__db.debts || []).length, 0, 'no payable or receivable');
    assert.strictEqual((mem.__db.transactions || []).length, 0, 'no transaction');
    assert.strictEqual((mem.__db.counterparties || []).length, 1, 'no counterparty');
  });

  await t('18. the OCR transcript never reaches the public API', async () => {
    const r = await call('GET', '/documents', { biz: A });
    const s = JSON.stringify(r.body);
    assert.ok(!/Sudah terima dari/i.test(s), 'document text must not be exposed');
    assert.ok(!/ocr_text/.test(s));
    const v2 = (r.body.documents || []).find((d) => d.id === 'd-scan').extracted_json.ai_intake_v2;
    assert.strictEqual(v2.source, 'native_pdf_vision', 'how it was read is fine to expose');
    assert.ok(!('text' in v2) && !('raw_text_excerpt' in v2));
  });

  await t('10. an OCR failure is fail-open — the document is still there', async () => {
    OCR_MODE = 'throw';
    const r = await call('POST', '/documents/d-scan2/intake', { biz: A });
    assert.strictEqual(r.status, 200, 'a reader failure must not fail the request');
    assert.strictEqual(r.body.status, 'unsupported');
    assert.ok(/could not/i.test(r.body.blockers[0]), r.body.blockers[0]);
    assert.ok(docRow('d-scan2'), 'the document row is untouched');
    OCR_MODE = 'ok';
  });

  // ── one reader for every endpoint ─────────────────────────────────────────
  // The counterparty endpoint used to keep its own embedded-text-only copy of the
  // reading steps, so a scanned document intake could read fine came back from it as
  // "No counterparty name could be read".
  console.log('\n1/2/3. one reader, three endpoints');
  await t('1/2. counterparty-suggestion uses the OCR fallback when there is no text', async () => {
    process.env.DOCUMENT_OCR_VISION_ENABLED = 'true';
    const r = await call('POST', '/documents/d-scan/counterparty-suggestion', { biz: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.source, 'native_pdf_vision', `source was ${r.body.source}`);
    const name = r.body.suggested_counterparty?.legal_name || '';
    assert.ok(/Alfaria/i.test(name), `no name was read: ${JSON.stringify(r.body.suggested_counterparty)}`);
  });

  await t('3/4. it is still zero-write — nothing is created by asking', async () => {
    const before = (mem.__db.counterparties || []).length;
    const r = await call('POST', '/documents/d-scan/counterparty-suggestion', { biz: A });
    assert.strictEqual(r.body.saved, false);
    assert.strictEqual((mem.__db.counterparties || []).length, before, 'no counterparty may be created');
    assert.strictEqual((mem.__db.debts || []).length, 0);
  });

  await t('the extract endpoint reads the same scanned document too', async () => {
    const r = await call('POST', '/documents/d-scan/extract', { biz: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.source, 'native_pdf_vision');
    assert.strictEqual(r.body.saved, false, 'extraction never writes');
    assert.strictEqual(r.body.extraction.document_type, 'receipt');
  });

  await t('with OCR off, the same endpoint is honest instead of silent', async () => {
    delete process.env.DOCUMENT_OCR_VISION_ENABLED;
    const r = await call('POST', '/documents/d-scan/counterparty-suggestion', { biz: A });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.source, 'filename_only');
    assert.strictEqual(r.body.text_source.available, false);
  });

  // ── parties, dates and the self-match rule, over HTTP ─────────────────────
  console.log('\n17-23. parties, dates, self-match');
  await t('17/18. name and NPWP stay with their own party', async () => {
    const r = await call('POST', '/documents/d-sup/counterparty-suggestion', { biz: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cp = r.body.suggested_counterparty;
    assert.ok(/Sumber Makmur/i.test(cp?.legal_name || ''), JSON.stringify(cp));
    // The supplier's own NPWP, never the buyer's.
    assert.ok(!cp.npwp || /01\.222\.333/.test(cp.npwp), `npwp was ${cp.npwp}`);
  });

  await t('19/20. the business is never offered as its own counterparty', async () => {
    const r = await call('POST', '/documents/d-self/counterparty-suggestion', { biz: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.status, 'self_match');
    assert.strictEqual(r.body.can_create, false, 'no create may be offered');
    assert.strictEqual(r.body.suggested_counterparty, null);
    assert.ok(/your own company/i.test(r.body.reason), r.body.reason);
  });

  await t('23. nothing is created by any of that', async () => {
    assert.strictEqual((mem.__db.counterparties || []).length, 1);
    assert.strictEqual((mem.__db.debts || []).length, 0);
    assert.strictEqual((mem.__db.transactions || []).length, 0);
  });

  await t('11/12. the extract endpoint separates the dates', async () => {
    const r = await call('POST', '/documents/d-dates/extract', { biz: A });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.dates.document_date.value, '2026-08-15');
    assert.strictEqual(r.body.dates.due_date.value, '2026-09-14');
    assert.notStrictEqual(r.body.dates.document_date.value, r.body.dates.due_date.value);
  });

  await t('16. a document with no date gets none — not today\'s', async () => {
    const r = await call('POST', '/documents/d-cus/extract', { biz: A });
    const today = new Date().toISOString().slice(0, 10);
    assert.notStrictEqual(r.body.dates.document_date.value, today);
  });

  await t('15/16. the shared reader keeps its scoping', async () => {
    const other = await call('POST', '/documents/d-b/counterparty-suggestion', { biz: A });
    assert.strictEqual(other.status, 404, 'a document of another business is refused');
    const personal = await call('POST', '/documents/d-sup/counterparty-suggestion', { biz: P });
    assert.strictEqual(personal.status, 403);
    assert.strictEqual(personal.body.error, 'business_workspace_required');
  });

  delete process.env.DOCUMENT_OCR_VISION_ENABLED;

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
