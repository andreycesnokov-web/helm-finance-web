'use strict';
// AC-0 through the real backend (24 Oct 2026): the edit route writes its audit row (with X-Request-Id), funding needs a
// request key and a retry returns the same record, the bill reconciliation is read-only and company-scoped, outsiders
// are refused. Synthetic data only; the target must be the disposable cluster (EXPECTED_PG_SYSTEM_ID).
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomUUID } = require('node:crypto'), { Client } = require('pg');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), base = process.env.BASE_URL, db = new Client({ connectionString: process.env.DATABASE_URL }), results = [];
const pass = (name, extra = {}) => { results.push({ case: name, status: 'PASS', ...extra }); fs.writeFileSync('/evidence/AC0_HTTP.json', JSON.stringify({ candidate: process.env.CFO_RC_SHA || 'unrecorded', results }, null, 2)); console.log('PASS ' + name); };
async function api(path, { method = 'GET', body, as = C.owner, headers = {} } = {}) {
  const r = await fetch(base + '/api' + path, { method, signal: AbortSignal.timeout(30000), headers: { authorization: 'Bearer ' + as.token, 'x-business-id': C.biz, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
}
// A real outsider: a freshly signed-in person with no membership in this company (C.other is its CFO).
async function outsider() {
  const email = 'ac0.outsider.' + Date.now() + '@example.invalid', j = (p, b) => fetch(base + '/api/auth/email/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const start = await j('start', { email }); const v = await j('verify', { email, code: start.dev_code }); assert.ok(v.token, 'outsider login'); return { token: v.token, user: v.user };
}
const ledger = async () => (await db.query("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) h FROM transactions t WHERE business_id=$1", [C.biz])).rows[0].h;
(async () => {
  await db.connect();
  const X = await outsider();
  assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, process.env.EXPECTED_PG_SYSTEM_ID);
  const today = new Date().toISOString().slice(0, 10);

  // I-5: edit with audit.
  const desc = 'AC0 HTTP edit ' + Date.now();
  assert.equal((await api('/transactions/batch', { method: 'POST', body: { request_key: randomUUID(), transactions: [{ type: 'expense', amount: '250000', currency: 'IDR', wallet_id: C.wallet, transaction_date: today, description: desc, category: 'Office supplies', scope: 'business' }] } })).status, 200);
  const id = (await db.query('SELECT id FROM transactions WHERE business_id=$1 AND description=$2', [C.biz, desc])).rows[0].id;
  const e = await api('/transactions/' + id, { method: 'PATCH', body: { amount: '275000', category: 'Software' }, headers: { 'x-request-id': 'ac0-http-edit-1' } });
  assert.equal(e.status, 200, JSON.stringify(e.data)); assert.equal(e.headers.get('x-request-id'), 'ac0-http-edit-1');
  const a = (await db.query("SELECT * FROM audit_events WHERE business_id=$1 AND entity_type='transaction' AND entity_id=$2", [C.biz, String(id)])).rows;
  assert.equal(a.length, 1); assert.equal(a[0].action, 'transaction_financial_update'); assert.equal(a[0].request_id, 'ac0-http-edit-1');
  assert.equal(a[0].actor_role, 'owner'); assert.equal(Number(a[0].before_json.fields.amount_original), 250000); assert.equal(Number(a[0].after_json.fields.amount_original), 275000);
  pass('PATCH /transactions/:id writes one audit row with before/after, role and the request id it echoes');
  const out = await api('/transactions/' + id, { method: 'PATCH', body: { category: 'Hack' }, as: X, headers: { 'x-business-id': C.biz } });
  assert.ok([403, 404].includes(out.status), 'outsider ' + out.status);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_events WHERE business_id=$1 AND entity_id=$2", [C.biz, String(id)])).rows[0].n, 1);
  pass('a member of another company cannot edit the operation; nothing audited');

  // I-6: funding with a request key.
  const rxDesc = 'AC0 HTTP loan received ' + Date.now();
  await api('/transactions/batch', { method: 'POST', body: { request_key: randomUUID(), transactions: [{ type: 'income', amount: '30000000', currency: 'IDR', wallet_id: C.wallet, transaction_date: today, description: rxDesc, scope: 'business' }] } });
  const rx = (await db.query('SELECT id FROM transactions WHERE business_id=$1 AND description=$2', [C.biz, rxDesc])).rows[0].id;
  const body = { source_kind: 'bank', instrument: 'loan', lender_name: 'AC0 HTTP bank', amount: 30000000, received_on: today, received_transaction_id: rx, schedule: [{ due_on: '2027-01-15', principal: 10000000, interest: 250000 }] };
  assert.equal((await api('/business-funding', { method: 'POST', body })).status, 400, 'no request key');
  const key = randomUUID(), f1 = await api('/business-funding', { method: 'POST', body: { ...body, request_key: key } });
  assert.equal(f1.status, 200, JSON.stringify(f1.data)); assert.equal(f1.data.replayed, false); assert.equal(f1.data.repayments.length, 1);
  const f2 = await api('/business-funding', { method: 'POST', body: { ...body, request_key: key } });
  assert.equal(f2.data.replayed, true); assert.equal(f2.data.record.id, f1.data.record.id);
  assert.equal((await api('/business-funding', { method: 'POST', body: { ...body, amount: 31000000, request_key: key } })).status, 409);
  assert.equal((await api('/business-funding', { method: 'POST', body: { ...body, request_key: randomUUID() } })).data.error, 'transaction_already_linked_to_funding');
  assert.equal((await db.query('SELECT count(*)::int n FROM business_funding_records WHERE business_id=$1 AND received_transaction_id=$2', [C.biz, rx])).rows[0].n, 1);
  pass('POST /business-funding: key required; retry returns the same record; other content 409; one payment backs one record');

  // I-12: reconciliation is read-only and company-scoped.
  const h = await ledger();
  const r = await api('/debts/reconciliation');
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.business_id, C.biz); assert.equal(r.data.writes, false); assert.ok(Array.isArray(r.data.exceptions));
  assert.equal(await ledger(), h);
  const ro = await api('/debts/reconciliation', { as: X, headers: { 'x-business-id': C.biz } });
  assert.ok([403, 404].includes(ro.status), 'outsider ' + ro.status);
  pass('GET /debts/reconciliation: read-only, scoped to the company, refused to outsiders', { bills_checked: r.data.bills_checked, exceptions: r.data.exceptions.length, by_reason: r.data.by_reason });
  await db.end();
})().catch(async (e) => { console.error(e.message); await db.end().catch(() => {}); process.exit(1); });
