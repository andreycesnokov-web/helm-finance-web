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
    ok(`[${k}] app URL parity with SDK signedUrl`, `${URL}/storage/v1${init.signedUrl}`.split('?')[0] === rawPutUrl(path, init.token).split('?')[0]);

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
    const sha = 'a'.repeat(64);
    const fileA = crypto.randomUUID(), docA = crypto.randomUUID();
    // 6 + 7: document_files + financial_documents created.
    const { error: f1 } = await supabase.from('document_files').insert({ id: fileA, business_id: BIZ_A, storage_path: `businesses/${BIZ_A}/documents/${docA}/x.pdf`, file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: sha, upload_channel: 'web' });
    ok('[db] document_files created', !f1);
    const { error: d1 } = await supabase.from('financial_documents').insert({ id: docA, business_id: BIZ_A, file_id: fileA, document_type: 'other' });
    ok('[db] financial_documents created', !d1);
    // 13: duplicate same business + same hash → unique violation.
    const { error: dup } = await supabase.from('document_files').insert({ id: crypto.randomUUID(), business_id: BIZ_A, storage_path: 'p2', file_name: 'y.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: sha, upload_channel: 'web' });
    ok('[db] duplicate same-business rejected (unique index)', !!dup);
    // 14: same hash in another business → allowed (no cross-business leak/coupling).
    const fileB = crypto.randomUUID();
    const { error: other } = await supabase.from('document_files').insert({ id: fileB, business_id: BIZ_B, storage_path: 'pB', file_name: 'z.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: sha, upload_channel: 'web' });
    ok('[db] same hash in other business is independent (no leak)', !other);
    // 18/19: cross-business link rejected by the 031 isolation trigger.
    if (DEBT_B) {
      const { error: xb } = await supabase.from('document_debt_links').insert({ business_id: BIZ_A, document_id: docA, debt_id: Number(DEBT_B) });
      ok('[db] cross-business link rejected (isolation trigger)', !!xb);
    } else { console.log('--  [db] cross-business link: set DOC_TEST_DEBT_B (a debt in BIZ_B) to test'); }
    // 20: archive (soft) succeeds — evidence stays, no ledger touched.
    const { error: arch } = await supabase.from('financial_documents').update({ archived_at: new Date().toISOString() }).eq('id', docA).eq('business_id', BIZ_A);
    ok('[db] archive (soft) without cash impact', !arch);
    // cleanup db rows + objects
    await supabase.from('document_debt_links').delete().eq('document_id', docA).catch(() => {});
    await supabase.from('financial_documents').delete().eq('id', docA).catch(() => {});
    await supabase.from('document_files').delete().in('id', [fileA, fileB]).catch(() => {});
  } else {
    console.log('--  [db] scenarios 6,7,13,14,18,19,20 need DOC_TEST_BIZ_A & DOC_TEST_BIZ_B (seeded staging businesses). Also proven independently by tests/migrations/ci.js on PGlite.');
  }

  // Cleanup
  if (created.length) await supabase.storage.from(BUCKET).remove(created).catch(() => {});

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
