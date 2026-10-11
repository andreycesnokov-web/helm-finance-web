// POST /api/documents/:id/extract — scoping, zero-write and the manual-review fallback.
// Boots the REAL server/index.js over the in-memory supabase shim.
//
// Run: node tests/integration/documentExtraction.test.js
const path = require('path');
const Module = require('module');
const zlib = require('node:zlib');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'doc-extract-test-secret', TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5607', NODE_ENV: 'test',
});

// A real PDF carrying real embedded text, so extractPdfText has something to find.
function makePdf(text) {
  const content = `BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g, ' ')}) Tj ET`;
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length ' +
    stream.length + '/Filter/FlateDecode>>stream\n', 'latin1');
  const tail = Buffer.from('\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
  return Buffer.concat([head, stream, tail]);
}

const FAKTUR_LINE = 'Faktur Pajak Kode dan Nomor Seri Faktur Pajak: 040.026-00.313616020 '
  + 'Pengusaha Kena Pajak Nama : PT Circleka Indonesia Utama '
  + 'Pembeli Barang Kena Pajak Nama : PT Helm Care Indonesia '
  + 'Dasar Pengenaan Pajak 129.600.000 Jumlah PPN 14.256.000 Netto 143.856.000 '
  + 'No. Invoice X2610001139';

const FILES = {
  'businesses/A/faktur.pdf': makePdf(FAKTUR_LINE),
  'businesses/A/scan.pdf': Buffer.from('%PDF-1.4\n% a scan with no text layer\n%%EOF\n', 'latin1'),
  'businesses/B/other.pdf': makePdf('Faktur Pajak Netto 1.000'),
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') {
    // Storage is not modelled by the shim; back it with the fixtures above.
    const client = mem.createClient();
    client.storage = {
      from: () => ({
        download: async (p) => (FILES[p]
          ? { data: { arrayBuffer: async () => FILES[p] }, error: null }
          : { data: null, error: { message: 'not found' } }),
        createSignedUploadUrl: async () => ({ data: null, error: null }),
      }),
    };
    return { ...mem, createClient: () => client };
  }
  return origLoad.apply(this, arguments);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const P = '44444444-4444-4444-4444-444444444444';
const USER = 930101;

mem.__seed('businesses', [
  { id: A, name: 'A', type: 'company', owner_user_id: USER, created_at: '2026-01-01' },
  { id: B, name: 'B', type: 'company', owner_user_id: 999, created_at: '2026-01-02' },
  { id: P, name: 'Personal', type: 'personal', owner_user_id: USER, created_at: '2026-01-03' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: USER, business_id: A, role: 'owner', status: 'active' },
  { id: 3, user_id: USER, business_id: P, role: 'owner', status: 'active' },
]);
mem.__seed('business_addons', [
  { id: 'ad-A', business_id: A, addon: 'ai_accountant', status: 'active' },
  { id: 'ad-B', business_id: B, addon: 'ai_accountant', status: 'active' },
]);
mem.__seed('document_files', [
  { id: 'f-faktur', business_id: A, storage_path: 'businesses/A/faktur.pdf', file_name: 'faktur.pdf', mime_type: 'application/pdf' },
  { id: 'f-scan', business_id: A, storage_path: 'businesses/A/scan.pdf', file_name: 'scan.pdf', mime_type: 'application/pdf' },
  { id: 'f-b', business_id: B, storage_path: 'businesses/B/other.pdf', file_name: 'other.pdf', mime_type: 'application/pdf' },
]);
mem.__seed('financial_documents', [
  { id: 'doc-faktur', business_id: A, file_id: 'f-faktur', document_type: 'tax_invoice', currency: 'IDR' },
  { id: 'doc-scan', business_id: A, file_id: 'f-scan', document_type: 'vendor_invoice', currency: 'IDR' },
  { id: 'doc-arch', business_id: A, file_id: 'f-faktur', document_type: 'vendor_invoice', archived_at: '2026-08-01T00:00:00Z' },
  { id: 'doc-b', business_id: B, file_id: 'f-b', document_type: 'tax_invoice', currency: 'IDR' },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
async function call(method, p, { user = USER, biz, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  console.log('\nExtraction');
  await t('reads the Circleka figures out of a real PDF text layer', async () => {
    const r = await call('POST', '/documents/doc-faktur/extract', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
    const f = r.body.extraction.fields;
    assert.strictEqual(f.commercial_base_amount, 129600000);
    assert.strictEqual(f.commercial_tax_amount, 14256000);
    assert.strictEqual(f.gross_amount, 143856000);
    assert.strictEqual(f.document_number, 'X2610001139');
    assert.strictEqual(f.tax_invoice_serial, '04002600313616020');
    assert.strictEqual(r.body.extraction.document_type, 'faktur_pajak');
  });

  await t('5. extraction is ZERO-WRITE — the document row is untouched', async () => {
    const before = JSON.stringify((mem.__db.financial_documents || []).find((d) => d.id === 'doc-faktur'));
    const r = await call('POST', '/documents/doc-faktur/extract', { biz: A });
    assert.strictEqual(r.body.saved, false);
    const after = JSON.stringify((mem.__db.financial_documents || []).find((d) => d.id === 'doc-faktur'));
    assert.strictEqual(after, before, 'extraction must not modify the document');
  });

  await t('4. a PDF with no text layer returns needs_manual_review, inventing nothing', async () => {
    const r = await call('POST', '/documents/doc-scan/extract', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.extraction.status, 'needs_manual_review');
    assert.strictEqual(r.body.text_source.available, false);
    assert.strictEqual(r.body.extraction.fields.gross_amount, null);
    assert.ok(r.body.extraction.warnings.some((w) => /scanned image/i.test(w)));
  });

  console.log('\nApply flow');
  await t('6. saving requires a separate explicit financial-fields call', async () => {
    const ex = await call('POST', '/documents/doc-faktur/extract', { biz: A });
    const f = ex.body.extraction.fields;
    let row = (mem.__db.financial_documents || []).find((d) => d.id === 'doc-faktur');
    assert.strictEqual(row.gross_amount, undefined, 'still unsaved after extraction');

    const applied = await call('PATCH', '/documents/doc-faktur/financial-fields', { biz: A, body: {
      commercial_base_amount: f.commercial_base_amount,
      commercial_tax_amount: f.commercial_tax_amount,
      gross_amount: f.gross_amount,
      document_number: f.document_number, currency: 'IDR',
    } });
    assert.strictEqual(applied.status, 200, `status ${applied.status}`);
    row = (mem.__db.financial_documents || []).find((d) => d.id === 'doc-faktur');
    assert.strictEqual(Number(row.gross_amount), 143856000);
    assert.strictEqual(Number(row.commercial_base_amount), 129600000);
  });

  console.log('\nGuards');
  await t('7. a document in another business is refused', async () => {
    const r = await call('POST', '/documents/doc-b/extract', { biz: A });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'document_not_found_in_this_business');
  });

  await t('8. a personal workspace is refused', async () => {
    const r = await call('POST', '/documents/doc-faktur/extract', { biz: P });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'business_workspace_required');
  });

  await t('9. an archived document is refused', async () => {
    const r = await call('POST', '/documents/doc-arch/extract', { biz: A });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'document_archived');
  });

  await t('unauthenticated is refused', async () => {
    const r = await call('POST', '/documents/doc-faktur/extract', { user: null });
    assert.strictEqual(r.status, 401, `status ${r.status}`);
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
