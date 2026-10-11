// HTTP end-to-end test against the REAL Express runtime (not Storage SDK / RPC
// directly). Drives auth, business resolver, entitlement and role middleware.
// SAFE: local only. Skips unless BASE_URL + local Supabase env are provided.
//
//   BASE_URL=http://localhost:3001 JWT_SECRET=... SUPABASE_URL=... \
//   SUPABASE_SECRET_KEY=... DOCUMENTS_TEST_BUCKET=financial-documents-test \
//   DOC_TEST_BIZ_A=... DOC_TEST_BIZ_B=... DOC_TEST_DEBT_A=... DOC_TEST_DEBT_B=... \
//   node tests/integration/httpE2E.test.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL, SECRET = process.env.JWT_SECRET;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const A = process.env.DOC_TEST_BIZ_A, B = process.env.DOC_TEST_BIZ_B;
const DEBT_A = process.env.DOC_TEST_DEBT_A, DEBT_B = process.env.DOC_TEST_DEBT_B;
if (!BASE || !SECRET || !URL || !KEY || !A || !B || !DEBT_A || !DEBT_B) {
  console.log('SKIP — needs BASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY, DOC_TEST_BIZ_A/B, DOC_TEST_DEBT_A/B (local only).');
  process.exit(0);
}
const supabase = createClient(URL, KEY);

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const tok = (userId) => jwt.sign({ userId }, SECRET, { expiresIn: '1h' });
const U = { ownerA: 900001, managerA: 900002, employeeA: 900003, auditorA: 900004, ownerB: 900005, accountantA: 900006, admin: 999000 };

async function api(method, path, { token, biz, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: json };
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Real signed upload through the HTTP API + binary PUT.
async function httpUpload(userId, biz, file, meta = {}, link = null, { tamperPath = false } = {}) {
  const token = tok(userId);
  const hash = sha256(file.body);
  const init = await api('POST', '/api/documents/upload-init', { token, biz, body: { file_name: file.name, mime_type: file.type, file_size: file.body.length, document_type: meta.document_type || 'other', sha256: hash } });
  if (init.status !== 200) return { init };
  const put = await fetch(init.body.upload_url, { method: 'PUT', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: file.body });
  const complete = await api('POST', '/api/documents/upload-complete', { token, biz, body: {
    document_id: init.body.document_id, storage_path: tamperPath ? 'businesses/evil/x/y.pdf' : init.body.storage_path,
    file_name: file.name, mime_type: file.type, file_size: file.body.length, document_type: meta.document_type || 'other',
    sha256: hash, title: meta.title, link: link || undefined,
  } });
  return { init, put: put.status, complete, document_id: init.body.document_id };
}
const auditCount = async (docId, action) => Number((await supabase.from('document_audit').select('*', { count: 'exact', head: true }).eq('document_id', docId).eq('action', action)).count || 0);
const pdf = (tag) => ({ name: `${tag}.pdf`, type: 'application/pdf', body: Buffer.from(`%PDF-1.4 ${tag} ${Math.random()}\n%%EOF`) });

(async () => {
  // ── Financial snapshot BEFORE ──────────────────────────────────────────────
  const snap = async () => ({
    tx: Number((await supabase.from('transactions').select('*', { count: 'exact', head: true })).count || 0),
    debtSum: (await supabase.from('debts').select('amount,paid_amount')).data?.reduce((a, d) => ({ amount: a.amount + Number(d.amount || 0), paid: a.paid + Number(d.paid_amount || 0) }), { amount: 0, paid: 0 }),
    settlements: Number((await supabase.from('debt_settlement_allocations').select('*', { count: 'exact', head: true })).count || 0),
  });
  const before = await snap();

  // ── 4. Auth & permissions ──────────────────────────────────────────────────
  ok('1) no token → 401', (await api('GET', '/api/documents')).status === 401);

  // 3. Owner full lifecycle
  const up = await httpUpload(U.ownerA, A, pdf('owner'), { title: 'Owner Doc' });
  ok('3) owner upload-init 200', up.init.status === 200);
  ok('3) owner real binary PUT accepted', up.put === 200);
  ok('3) owner upload-complete 200 (doc created)', up.complete.status === 200 && !!up.complete.body.document);
  const docOwner = up.document_id;
  ok('3) owner GET list includes doc', (await api('GET', '/api/documents', { token: tok(U.ownerA), biz: A })).body.documents.some(d => d.id === docOwner));
  ok('3) owner GET detail 200', (await api('GET', '/api/documents/' + docOwner, { token: tok(U.ownerA), biz: A })).status === 200);
  ok('3) owner signed-url view 200', (await api('POST', '/api/documents/' + docOwner + '/signed-url', { token: tok(U.ownerA), biz: A, body: { mode: 'view' } })).status === 200);
  ok('3) owner PATCH metadata 200', (await api('PATCH', '/api/documents/' + docOwner, { token: tok(U.ownerA), biz: A, body: { title: 'Renamed' } })).status === 200);
  const linkRes = await api('POST', '/api/documents/' + docOwner + '/links', { token: tok(U.ownerA), biz: A, body: { target_type: 'debt', target_id: DEBT_A } });
  ok('3) owner link 200', linkRes.status === 200 && !!linkRes.body.link_id);
  ok('3) owner unlink 200', (await api('DELETE', `/api/documents/${docOwner}/links/${linkRes.body.link_id}`, { token: tok(U.ownerA), biz: A })).status === 200);
  ok('3) owner archive 200', (await api('POST', '/api/documents/' + docOwner + '/archive', { token: tok(U.ownerA), biz: A, body: {} })).status === 200);

  // 4. Accountant
  const accUp = await httpUpload(U.accountantA, A, pdf('acct'));
  ok('4) accountant upload 200', accUp.complete?.status === 200);
  ok('4) accountant link 200', (await api('POST', '/api/documents/' + accUp.document_id + '/links', { token: tok(U.accountantA), biz: A, body: { target_type: 'debt', target_id: DEBT_A } })).status === 200);

  // 5. Manager sees own uploaded
  const mgrUp = await httpUpload(U.managerA, A, pdf('mgr'));
  ok('5) manager sees OWN uploaded doc', (await api('GET', '/api/documents', { token: tok(U.managerA), biz: A })).body.documents.some(d => d.id === mgrUp.document_id));

  // 6. Manager sees doc linked to their own debt (DEBT_A created_by manager).
  const ownerDocForMgr = await httpUpload(U.ownerA, A, pdf('formgr'));
  await api('POST', '/api/documents/' + ownerDocForMgr.document_id + '/links', { token: tok(U.ownerA), biz: A, body: { target_type: 'debt', target_id: DEBT_A } });
  ok('6) manager sees doc linked to own submitted debt', (await api('GET', '/api/documents', { token: tok(U.managerA), biz: A })).body.documents.some(d => d.id === ownerDocForMgr.document_id));

  // 7. Manager cannot browse unrelated (owner doc not linked to manager's debt).
  const ownerUnrelated = await httpUpload(U.ownerA, A, pdf('unrel'));
  const mgrList = (await api('GET', '/api/documents', { token: tok(U.managerA), biz: A })).body.documents;
  ok('7) manager list EXCLUDES unrelated doc', !mgrList.some(d => d.id === ownerUnrelated.document_id));
  ok('7) manager GET unrelated detail → 403', (await api('GET', '/api/documents/' + ownerUnrelated.document_id, { token: tok(U.managerA), biz: A })).status === 403);

  // 8. Employee restricted
  const empUp = await httpUpload(U.employeeA, A, pdf('emp'));
  ok('8) employee sees own', (await api('GET', '/api/documents', { token: tok(U.employeeA), biz: A })).body.documents.some(d => d.id === empUp.document_id));
  ok('8) employee GET unrelated → 403', (await api('GET', '/api/documents/' + ownerUnrelated.document_id, { token: tok(U.employeeA), biz: A })).status === 403);

  // 9. Auditor read-only
  ok('9) auditor GET list 200', (await api('GET', '/api/documents', { token: tok(U.auditorA), biz: A })).status === 200);
  ok('9) auditor signed-url 200', (await api('POST', '/api/documents/' + accUp.document_id + '/signed-url', { token: tok(U.auditorA), biz: A, body: { mode: 'view' } })).status === 200);
  ok('9) auditor upload-init → 403', (await api('POST', '/api/documents/upload-init', { token: tok(U.auditorA), biz: A, body: { file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 10 } })).status === 403);
  ok('9) auditor PATCH → 403', (await api('PATCH', '/api/documents/' + accUp.document_id, { token: tok(U.auditorA), biz: A, body: { title: 'x' } })).status === 403);
  ok('9) auditor archive → 403', (await api('POST', '/api/documents/' + accUp.document_id + '/archive', { token: tok(U.auditorA), biz: A, body: {} })).status === 403);
  ok('9) auditor link → 403', (await api('POST', '/api/documents/' + accUp.document_id + '/links', { token: tok(U.auditorA), biz: A, body: { target_type: 'debt', target_id: DEBT_A } })).status === 403);

  // 10/11. Health by role
  const adminHealth = await api('GET', '/api/documents/health', { token: tok(U.admin), biz: A });
  ok('10) platform admin gets DETAILED health', adminHealth.body.bucket_exists !== undefined && adminHealth.body.rpc_functions !== undefined);
  const userHealth = await api('GET', '/api/documents/health', { token: tok(U.managerA), biz: A });
  ok('11) ordinary user gets ONLY {available,degraded}', Object.keys(userHealth.body).sort().join(',') === 'available,degraded');

  // ── 5. Business isolation (B doc created via API as ownerB) ─────────────────
  const bDoc = await httpUpload(U.ownerB, B, pdf('bdoc'));
  ok('5) A cannot VIEW B document → 404', (await api('GET', '/api/documents/' + bDoc.document_id, { token: tok(U.ownerA), biz: A })).status === 404);
  ok('5) A cannot get signed URL for B doc → 404', (await api('POST', '/api/documents/' + bDoc.document_id + '/signed-url', { token: tok(U.ownerA), biz: A, body: { mode: 'view' } })).status === 404);
  ok('5) A cannot link doc to B debt → 403 cross-business', (await api('POST', '/api/documents/' + accUp.document_id + '/links', { token: tok(U.ownerA), biz: A, body: { target_type: 'debt', target_id: DEBT_B } })).status === 403);
  // x-business-id cannot bypass membership: ownerB requests biz A → resolver falls back to B; cannot see A doc.
  ok('5) x-business-id spoof cannot reach A doc', (await api('GET', '/api/documents/' + ownerUnrelated.document_id, { token: tok(U.ownerB), biz: A })).status === 404);
  // client storage_path ignored / mismatch rejected.
  const tamper = await httpUpload(U.ownerA, A, pdf('tamper'), {}, null, { tamperPath: true });
  ok('5) client storage_path tamper → 400 mismatch', tamper.complete.status === 400 && /storage_path_mismatch/.test(JSON.stringify(tamper.complete.body)));
  // duplicate not disclosed across business: same bytes in A then B.
  const dupFile = pdf('dup'); const dA = await httpUpload(U.ownerA, A, dupFile); const dA2 = await httpUpload(U.ownerA, A, dupFile); const dB = await httpUpload(U.ownerB, B, dupFile);
  // Two-stage dedup: caught at init (stage 1) OR complete (stage 2).
  const dupStatus = dA2.complete?.status ?? dA2.init.status;
  const dupBody = dA2.complete?.body ?? dA2.init.body;
  ok('5) duplicate in SAME business → 409', dupStatus === 409 && dupBody.duplicate === true);
  ok('5) same file in OTHER business → 200 (no leak)', dB.complete.status === 200);

  // ── 6. Atomic audit (through HTTP) ─────────────────────────────────────────
  const auditDoc = (await httpUpload(U.ownerA, A, pdf('audit'))).document_id;
  ok('6) upload-complete created uploaded audit', (await auditCount(auditDoc, 'uploaded')) === 1);
  await api('PATCH', '/api/documents/' + auditDoc, { token: tok(U.ownerA), biz: A, body: { title: 'AuditEdit' } });
  ok('6) metadata PATCH created audit', (await auditCount(auditDoc, 'metadata_changed')) === 1);
  const al = await api('POST', '/api/documents/' + auditDoc + '/links', { token: tok(U.ownerA), biz: A, body: { target_type: 'debt', target_id: DEBT_A } });
  ok('6) link created audit', (await auditCount(auditDoc, 'linked')) === 1);
  await api('DELETE', `/api/documents/${auditDoc}/links/${al.body.link_id}`, { token: tok(U.ownerA), biz: A });
  ok('6) unlink created audit', (await auditCount(auditDoc, 'unlinked')) === 1);
  await api('POST', '/api/documents/' + auditDoc + '/archive', { token: tok(U.ownerA), biz: A, body: {} });
  ok('6) archive created audit', (await auditCount(auditDoc, 'archived')) === 1);

  // RPC error surfaces through HTTP as a non-2xx with NO partial change
  // (archived doc cannot be re-mutated). The forced-audit-failure rollback is
  // exercised separately by breaking document_audit via SQL (see runner) and by
  // ci_036 at the DB level.
  const rbDoc = (await httpUpload(U.ownerA, A, pdf('rollback'))).document_id;
  await api('POST', '/api/documents/' + rbDoc + '/archive', { token: tok(U.ownerA), biz: A, body: {} });
  const reEdit = await api('PATCH', '/api/documents/' + rbDoc, { token: tok(U.ownerA), biz: A, body: { title: 'ShouldFail' } });
  ok('6) RPC error surfaced through HTTP as 409 (archived re-mutation)', reEdit.status === 409);
  const still = (await supabase.from('financial_documents').select('document_number').eq('id', rbDoc).single()).data;
  ok('6) failed mutation did NOT change stored value', still.document_number !== 'ShouldFail');

  // ── 7. Financial regression (after all document ops) ───────────────────────
  const after = await snap();
  ok('7) transaction count unchanged', before.tx === after.tx);
  ok('7) debt amount total unchanged', before.debtSum.amount === after.debtSum.amount);
  ok('7) debt paid total unchanged', before.debtSum.paid === after.debtSum.paid);
  ok('7) settlement allocations unchanged (0)', before.settlements === after.settlements && after.settlements === 0);
  console.log(`\nFINANCIAL  before=${JSON.stringify(before)}  after=${JSON.stringify(after)}`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed, 0 skipped`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
