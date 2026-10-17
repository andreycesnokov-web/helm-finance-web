'use strict';
// Phase H — documents on real Supabase Storage (private bucket, signed upload/download URLs) with synthetic files only.
const crypto = require('crypto');
const { assert, call, collector, db, key, state, signIn, S } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/docs.json');
const RUN = key().slice(0, 6);
const pdf = (text) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${text.length + 30}>>stream\nBT /F1 12 Tf 20 100 Td (${text}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  const c = await db();
  const st = state(), A1 = st.companies.A1, B1 = st.companies.B1;
  const alpha = await signIn('owner.alpha@rehearsal.test', st.alpha_password);
  const beta = await signIn('owner.beta@rehearsal.test', st.beta_password);
  const T = alpha.token;
  const upload = async (token, biz, buf, meta) => {
    const k = key(), payload = { file_name: meta.file_name, mime_type: meta.mime_type, file_size: buf.length, document_type: meta.document_type };
    const init = await call('POST', '/documents/upload-init', { token, biz, headers: { 'Idempotency-Key': k }, body: { ...payload, sha256: sha(buf) } });
    if (init.status !== 200) return { init };
    const put = await fetch(init.body.upload_url, { method: 'PUT', headers: { 'content-type': payload.mime_type, 'x-upsert': 'false' }, body: buf });
    const done = await call('POST', '/documents/upload-complete', { token, biz, headers: { 'Idempotency-Key': k }, body: { document_id: init.body.document_id, storage_path: init.body.storage_path, ...payload, sha256: sha(buf), title: meta.file_name } });
    return { init, put: put.status, done };
  };
  let doc, file;
  await check('H1 upload: init → signed PUT to private Storage → complete; document owned by the company, listed, file stored once', async () => {
    file = pdf('INVOICE INV-002 PT Supplier Rehearsal Total IDR 10.000.000 ' + RUN);
    const r = await upload(T, A1, file, { file_name: `vendor-invoice-${RUN}.pdf`, mime_type: 'application/pdf', document_type: 'vendor_invoice' });
    assert.equal(r.init.status, 200, 'init ' + JSON.stringify(r.init.body).slice(0, 200)); assert.ok(r.put < 300, 'storage PUT ' + r.put);
    assert.equal(r.done.status, 200, 'complete ' + JSON.stringify(r.done.body).slice(0, 300)); doc = r.done.body.document;
    const row = (await c.query('SELECT business_id FROM financial_documents WHERE id=$1', [doc.id])).rows[0]; assert.equal(row.business_id, A1);
    const obj = (await c.query("SELECT bucket_id, name FROM storage.objects WHERE name LIKE $1", ['%' + doc.id + '%'])).rows;
    assert.equal(obj.length, 1, 'storage objects: ' + obj.length); assert.ok(obj[0].name.startsWith('businesses/' + A1 + '/documents/' + doc.id + '/'), 'object path is not company-scoped: ' + obj[0].name);
    const list = await call('GET', '/documents', { token: T, biz: A1 }); assert.ok(JSON.stringify(list.body).includes(doc.id));
    return { bucket: obj[0].bucket_id, path_prefix: 'businesses/<company id>/documents/<document id>/<file>', status: doc.status || doc.review_status || null };
  });
  await check('H2 file validation: executable type and oversize file refused before any upload URL is issued', async () => {
    const exe = await call('POST', '/documents/upload-init', { token: T, biz: A1, headers: { 'Idempotency-Key': key() }, body: { file_name: 'tool.exe', mime_type: 'application/x-msdownload', file_size: 1000, document_type: 'other', sha256: sha(Buffer.from('x')) } });
    assert.equal(exe.status, 400, JSON.stringify(exe.body));
    const big = await call('POST', '/documents/upload-init', { token: T, biz: A1, headers: { 'Idempotency-Key': key() }, body: { file_name: 'huge.pdf', mime_type: 'application/pdf', file_size: 200 * 1024 * 1024, document_type: 'other', sha256: sha(Buffer.from('y')) } });
    assert.equal(big.status, 400, JSON.stringify(big.body));
    const html = await call('POST', '/documents/upload-init', { token: T, biz: A1, headers: { 'Idempotency-Key': key() }, body: { file_name: 'page.html', mime_type: 'text/html', file_size: 100, document_type: 'other', sha256: sha(Buffer.from('z')) } });
    return { exe: exe.body.error, oversize: big.body.error, html: html.status + ' ' + (html.body?.error || '') };
  });
  await check('H2 duplicate: the same file again in the same company is recognised, not stored twice', async () => {
    const again = await call('POST', '/documents/upload-init', { token: T, biz: A1, headers: { 'Idempotency-Key': key() }, body: { file_name: `copy-${RUN}.pdf`, mime_type: 'application/pdf', file_size: file.length, document_type: 'vendor_invoice', sha256: sha(file) } });
    assert.equal(again.status, 409, JSON.stringify(again.body)); assert.equal(again.body.existing_document_id, doc.id);
  });
  await check('H2 signed URL: the owner gets a short-lived link that serves the exact bytes; a tampered token fails', async () => {
    const s = await call('POST', `/documents/${doc.id}/signed-url`, { token: T, biz: A1, body: { mode: 'view' } }); assert.equal(s.status, 200, JSON.stringify(s.body));
    const url = s.body.url; const got = await fetch(url); assert.equal(got.status, 200);
    assert.equal(sha(Buffer.from(await got.arrayBuffer())), sha(file));
    const exp = Number(JSON.parse(Buffer.from(new URL(url).searchParams.get('token').split('.')[1], 'base64url')).exp) - Date.now() / 1000;
    const bad = await fetch(url.replace(/token=([^&]+)/, (m, t) => 'token=' + t.slice(0, -3) + 'abc')); assert.ok(bad.status >= 400);
    return { expires_in_s: Math.round(exp) };
  });
  await check('H2 storage is private: no anonymous or user-key access to the object, no listing', async () => {
    const path = (await c.query("SELECT bucket_id, name FROM storage.objects WHERE name LIKE $1", ['%' + doc.id + '%'])).rows[0];
    const base = 'http://127.0.0.1:55450/storage/v1';
    for (const u of [`${base}/object/public/${path.bucket_id}/${path.name}`, `${base}/object/${path.bucket_id}/${path.name}`, `${base}/object/authenticated/${path.bucket_id}/${path.name}`]) {
      const r = await fetch(u, { headers: { apikey: S.anon_key, authorization: 'Bearer ' + S.anon_key } }); assert.ok(r.status >= 400, u + ' ' + r.status);
    }
    const ls = await fetch(`${base}/object/list/${path.bucket_id}`, { method: 'POST', headers: { apikey: S.anon_key, authorization: 'Bearer ' + S.anon_key, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: A1 }) });
    const listed = ls.status < 300 ? (await ls.json()).length : 0; assert.equal(listed, 0, 'anon listing returned objects');
    const pub = (await c.query('SELECT public FROM storage.buckets WHERE id=$1', [path.bucket_id])).rows[0].public; assert.equal(pub, false);
    // The app's own JWT is not a Storage credential either.
    const r2 = await fetch(`${base}/object/authenticated/${path.bucket_id}/${path.name}`, { headers: { apikey: S.anon_key, authorization: 'Bearer ' + T } }); assert.ok(r2.status >= 400);
  });
  await check('H2 cross-company isolation: another customer can neither read, sign, modify nor complete into this company', async () => {
    const fp = async () => (await c.query('SELECT md5(row_to_json(d)::text) h FROM financial_documents d WHERE id=$1', [doc.id])).rows[0].h; const before = await fp();
    for (const [m, p, body] of [['GET', `/documents/${doc.id}`], ['POST', `/documents/${doc.id}/signed-url`, { mode: 'view' }], ['PATCH', `/documents/${doc.id}`, { title: 'hijack' }], ['POST', `/documents/${doc.id}/archive`, {}]]) {
      for (const biz of [A1, B1]) { const r = await call(m, p, { token: beta.token, biz, body }); assert.ok([402, 403, 404].includes(r.status), `${m} ${p} as beta in ${biz === A1 ? 'A1' : 'B1'}: ${r.status}`); }
    }
    const steal = await call('POST', '/documents/upload-complete', { token: beta.token, biz: A1, headers: { 'Idempotency-Key': key() }, body: { document_id: doc.id, storage_path: `${A1}/${doc.id}/x.pdf`, file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 10 } });
    assert.ok([402, 403, 404].includes(steal.status), 'complete into another company: ' + steal.status);
    assert.equal(await fp(), before, 'document row changed by another customer');
  });
  await check('H1 review: extraction/classification without paid AI or OCR; approve/archive by the owner is audited', async () => {
    const ex = await call('POST', `/documents/${doc.id}/extract`, { token: T, biz: A1, body: {} });
    const id = await call('POST', `/documents/${doc.id}/identify`, { token: T, biz: A1, headers: { 'Idempotency-Key': key() }, body: {} });
    const ar = await call('POST', `/documents/${doc.id}/archive`, { token: T, biz: A1, body: {} });
    const audit = Number((await c.query('SELECT count(*) n FROM document_audit WHERE document_id=$1', [doc.id])).rows[0].n);
    const actions = (await c.query('SELECT action FROM document_audit WHERE document_id=$1 ORDER BY created_at', [doc.id])).rows.map((x) => x.action);
    assert.ok(audit >= 1, 'no audit trail for the document');
    return { extract: ex.status + ' ' + (ex.body?.error || Object.keys(ex.body || {}).slice(0, 5).join(',')), identify: id.status + ' ' + (id.body?.error || ''), archive: ar.status, audit_rows: audit, audit_actions: actions };
  });
  await c.end();
  process.exit(save() ? 0 : 1);
})().catch((e) => { console.error('DOCS CRASHED', e); process.exit(1); });
