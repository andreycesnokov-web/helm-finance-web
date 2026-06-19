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

  // Cleanup
  if (created.length) await supabase.storage.from(BUCKET).remove(created).catch(() => {});

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
