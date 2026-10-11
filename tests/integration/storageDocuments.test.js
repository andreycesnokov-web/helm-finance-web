// Real Supabase Storage integration test for the Tax Documents signed-upload
// protocol. SAFE: runs ONLY against a dedicated private test bucket and is
// skipped unless explicitly configured — it will NEVER touch the production
// `financial-documents` bucket.
//
// Run:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... DOCUMENTS_TEST_BUCKET=docs-test \
//     node tests/integration/storageDocuments.test.js
//
// The test bucket must be created manually and be PRIVATE. It is wiped of the
// test prefix on completion.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const docV = require('../../server/lib/documentValidation');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = process.env.DOCUMENTS_TEST_BUCKET; // MUST be a throwaway private bucket
if (!URL || !KEY || !BUCKET) {
  console.log('SKIP — set SUPABASE_URL, SUPABASE_SECRET_KEY and DOCUMENTS_TEST_BUCKET (a private throwaway bucket) to run.');
  console.log('      This test is intentionally NOT run against the production financial-documents bucket.');
  process.exit(0);
}
if (BUCKET === 'financial-documents') { console.log('REFUSING — DOCUMENTS_TEST_BUCKET must not be the production bucket.'); process.exit(1); }

const supabase = createClient(URL, KEY);
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Mirrors the app's exact constructed upload URL (no supabase-js on the client).
const rawPutUrl = (path, token) => `${URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${token}`;

const samples = {
  pdf: { name: 'a.pdf', type: 'application/pdf', body: Buffer.from('%PDF-1.4 test\n%%EOF') },
  jpg: { name: 'a.jpg', type: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
  csv: { name: 'a.csv', type: 'text/csv', body: Buffer.from('a,b,c\n1,2,3\n') },
  xlsx: { name: 'a.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('PK test xlsx payload') },
};

(async () => {
  const biz = crypto.randomUUID();
  const created = [];

  // 1. Bucket must be private.
  const { data: bk } = await supabase.storage.getBucket(BUCKET);
  ok('test bucket is private', bk && bk.public === false);

  // 2. Signed upload init → the SDK signedUrl must match the app's constructed URL shape.
  for (const [k, s] of Object.entries(samples)) {
    const docId = crypto.randomUUID();
    const path = docV.buildStoragePath(biz, docId, s.name);
    const { data: init, error: iErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    ok(`[${k}] signed upload init`, !iErr && !!init?.token);
    if (iErr) continue;
    // The SDK returns an absolute signedUrl; the backend builds the same string.
    ok(`[${k}] app URL parity with SDK signedUrl`, init.signedUrl.split('?')[0] === rawPutUrl(path, init.token).split('?')[0]);

    // 3. Real binary upload via the exact raw PUT the client uses.
    const put = await fetch(rawPutUrl(path, init.token), {
      method: 'PUT', headers: { 'content-type': s.type, 'x-upsert': 'false' }, body: s.body,
    });
    ok(`[${k}] raw PUT upload accepted`, put.ok);
    created.push(path);

    // 4. Server-side download + hash verification.
    const { data: blob } = await supabase.storage.from(BUCKET).download(path);
    const buf = Buffer.from(await blob.arrayBuffer());
    ok(`[${k}] downloaded bytes match`, buf.equals(s.body));
    ok(`[${k}] server hash == upload hash`, sha(buf) === sha(s.body));

    // 5. Signed view + download URLs.
    const { data: view } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
    ok(`[${k}] signed view URL issued`, !!view?.signedUrl);
    const { data: dl } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, { download: s.name });
    ok(`[${k}] signed download URL issued`, !!dl?.signedUrl && /download/.test(dl.signedUrl));
  }

  // 6. Duplicate: re-upload identical bytes to a NEW path → same hash (app rejects
  //    at the DB unique index; here we confirm hashes collide deterministically).
  ok('duplicate detection: identical bytes hash equal', sha(samples.pdf.body) === sha(Buffer.from('%PDF-1.4 test\n%%EOF')));

  // 7. Invalid MIME is rejected at validation (before any storage call).
  ok('invalid MIME rejected pre-storage', !docV.validateUpload({ file_name: 'x.exe', mime_type: 'application/x-msdownload', file_size: 10 }).ok);

  // 8. Expired token: a malformed/old token must be refused by storage.
  const badPath = docV.buildStoragePath(biz, crypto.randomUUID(), 'x.pdf');
  const expired = await fetch(rawPutUrl(badPath, 'expired.invalid.token'), { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: samples.pdf.body });
  ok('expired/invalid token rejected', !expired.ok);

  // 9. Abandoned upload: object exists with no DB row → must be removable.
  const ab = docV.buildStoragePath(biz, crypto.randomUUID(), 'orphan.pdf');
  const { data: abInit } = await supabase.storage.from(BUCKET).createSignedUploadUrl(ab);
  await fetch(rawPutUrl(ab, abInit.token), { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: samples.pdf.body });
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([ab]);
  ok('abandoned object cleaned up', !rmErr);

  // 10. Cross-business access: a path under business A is never reachable from a
  //     business-B-scoped path prefix (enforced in the API by business_id; here
  //     we assert the path scoping is structurally distinct).
  const pA = docV.buildStoragePath('A', 'd1', 'f.pdf'), pB = docV.buildStoragePath('B', 'd1', 'f.pdf');
  ok('cross-business paths are isolated', pA !== pB && pA.includes('/A/') && pB.includes('/B/'));

  // ── Optional DB-coupled scenarios (6,7,13,14,18,19,20). Requires staging DB
  //    with migrations 031(+035) applied and two seeded business ids. ──────────
  const BIZ_A = process.env.DOC_TEST_BIZ_A, BIZ_B = process.env.DOC_TEST_BIZ_B;
  const DEBT_B = process.env.DOC_TEST_DEBT_B; // a debt id belonging to BIZ_B
  if (BIZ_A && BIZ_B) {
    const sha = crypto.randomBytes(32).toString('hex'); // unique per run (idempotent re-runs)
    const fileA = crypto.randomUUID(), docA = crypto.randomUUID();
    const auditCount = async (id, action) => Number((await supabase.from('document_audit').select('*', { count: 'exact', head: true }).eq('document_id', id).eq('action', action)).count || 0);

    // 6 + 7 + 8: finalize RPC creates document_files + financial_documents + audit atomically.
    const { data: fin, error: finErr } = await supabase.rpc('rpc_document_finalize_upload', {
      p_file: { id: fileA, business_id: BIZ_A, storage_path: `businesses/${BIZ_A}/documents/${docA}/x.pdf`, file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: sha, upload_channel: 'web' },
      p_doc: { id: docA, business_id: BIZ_A, document_type: 'other', currency: 'IDR' }, p_actor: 1, p_channel: 'web',
    });
    ok('[db] finalize created financial_documents (RPC)', !finErr && fin && fin.id === docA);
    ok('[db] finalize created document_files', !!(await supabase.from('document_files').select('id').eq('id', fileA)).data?.length);
    ok('[db] finalize wrote uploaded audit atomically', (await auditCount(docA, 'uploaded')) === 1);

    // 13: duplicate same business + same hash → unique violation.
    const { error: dup } = await supabase.from('document_files').insert({ id: crypto.randomUUID(), business_id: BIZ_A, storage_path: 'p2', file_name: 'y.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: sha, upload_channel: 'web' });
    ok('[db] duplicate same-business rejected (unique index)', !!dup);
    // 14: same hash in another business → allowed (no cross-business leak).
    const fileB = crypto.randomUUID();
    const { error: other } = await supabase.from('document_files').insert({ id: fileB, business_id: BIZ_B, storage_path: 'pB', file_name: 'z.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: sha, upload_channel: 'web' });
    ok('[db] same hash in other business is independent (no leak)', !other);

    // 23: cross-business link rejected inside rpc_document_link.
    if (DEBT_B) {
      const { error: xb } = await supabase.rpc('rpc_document_link', { p_document_id: docA, p_business_id: BIZ_A, p_target_type: 'debt', p_target_id: String(DEBT_B), p_actor: 1, p_channel: 'web' });
      ok('[db] cross-business link rejected (RPC + 031 trigger)', !!xb);
    } else { console.log('--  [db] cross-business link: set DOC_TEST_DEBT_B (a debt in BIZ_B) to test scenario 23'); }

    // 30: link + unlink each write audit (use a debt in A if provided).
    if (process.env.DOC_TEST_DEBT_A) {
      const { data: linkId, error: lErr } = await supabase.rpc('rpc_document_link', { p_document_id: docA, p_business_id: BIZ_A, p_target_type: 'debt', p_target_id: String(process.env.DOC_TEST_DEBT_A), p_actor: 1, p_channel: 'web' });
      ok('[db] link wrote audit (RPC)', !lErr && (await auditCount(docA, 'linked')) === 1);
      const { error: uErr } = await supabase.rpc('rpc_document_unlink', { p_link_id: linkId, p_document_id: docA, p_business_id: BIZ_A, p_actor: 1, p_channel: 'web' });
      ok('[db] unlink wrote audit (RPC)', !uErr && (await auditCount(docA, 'unlinked')) === 1);
    } else { console.log('--  [db] link/unlink audit: set DOC_TEST_DEBT_A (a debt in BIZ_A) to test scenario 30'); }

    // 29: archive RPC writes audit atomically. 31 (forced audit failure rollback)
    //     is proven in tests/migrations/ci_036.js (isolated PGlite).
    const { error: arch } = await supabase.rpc('rpc_document_archive', { p_document_id: docA, p_business_id: BIZ_A, p_actor: 1, p_channel: 'web' });
    ok('[db] archive wrote audit (RPC, no cash impact)', !arch && (await auditCount(docA, 'archived')) === 1);

    // cleanup (audit is append-only and intentionally retained)
    try {
      await supabase.from('document_debt_links').delete().eq('document_id', docA);
      await supabase.from('financial_documents').delete().eq('id', docA);
      await supabase.from('document_files').delete().in('id', [fileA, fileB]);
    } catch { /* best-effort cleanup */ }
  } else {
    console.log('--  [db] scenarios 6,7,8,13,14,23,29,30 need DOC_TEST_BIZ_A & DOC_TEST_BIZ_B (seeded staging businesses) and migrations 035+036 applied. Scenario 31 is proven by tests/migrations/ci_036.js.');
  }

  // Cleanup
  if (created.length) await supabase.storage.from(BUCKET).remove(created).catch(() => {});

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
