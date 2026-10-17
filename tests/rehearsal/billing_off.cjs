'use strict';
// Phase I (flag OFF): the same clean install with COMMERCIAL_BILLING_ENABLED=false = billing paused (V2_DYNAMIC_PLAN_MATRIX.md §6).
const { assert, call, collector, db, key, state, signIn } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/billing_off.json');
(async () => {
  const c = await db();
  const st = state();
  const beta = await signIn('owner.beta@rehearsal.test', st.beta_password);
  const admin = await signIn('admin.root@rehearsal.test', st.admin_password);
  await check('flag OFF: customer and admin billing routes are not exposed (404); payments not available', async () => {
    assert.equal((await call('GET', '/billing', { token: beta.token, biz: st.companies.B1 })).status, 404);
    assert.equal((await call('POST', '/billing/trial', { token: beta.token, biz: st.companies.B1, body: { request_key: key(), plan_version_id: st.published.starter, expected_version: 1 } })).status, 404);
    assert.equal((await call('GET', '/admin/billing/catalog', { token: admin.token })).status, 404);
  });
  await check('flag OFF = billing paused: an expired commercial company keeps working, is never cut to legacy Free limits, and nothing is metered', async () => {
    const before = Number((await c.query('SELECT count(*) n FROM billing_quota_reservations WHERE business_id=$1', [st.companies.B1])).rows[0].n);
    const r = await call('POST', '/wallets', { token: beta.token, biz: st.companies.B1, body: { request_key: key(), name: 'Flag off ' + key().slice(0, 4), currency: 'IDR' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = Number((await c.query('SELECT count(*) n FROM billing_quota_reservations WHERE business_id=$1', [st.companies.B1])).rows[0].n);
    assert.equal(after, before, 'quota reservation created while billing is paused');
    return { status: r.status, reservations: after };
  });
  await check('billing paused: plan features still apply (payroll not in Starter → 402); costly external features refused (AI CFO → 503 billing_paused)', async () => {
    const p = await call('POST', '/payroll/employees', { token: beta.token, biz: st.companies.B1, body: { name: 'Paused employee', monthly_salary: 1000 } });
    assert.equal(p.status, 402, JSON.stringify(p.body)); assert.equal(p.body.error, 'billing_feature_denied');
    const alpha = await signIn('owner.alpha@rehearsal.test', st.alpha_password);
    const ai = await call('POST', '/ai-cfo/ask', { token: alpha.token, biz: st.companies.A1, headers: { 'Idempotency-Key': key() }, body: { question: 'cash?' } });
    assert.equal(ai.status, 503, JSON.stringify(ai.body)); assert.equal(ai.body.error, 'billing_paused');
    return { payroll: p.body.error, ai: ai.body.error };
  });
  await check('flag OFF: a company created now is not a commercial company (no trial, no billing account)', async () => {
    const r = await call('POST', '/businesses', { token: beta.token, body: { name: 'Beta flag-off company', request_key: key(), base_currency: 'IDR', country: 'Indonesia', timezone: 'Asia/Jakarta' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const b = (await c.query('SELECT billing_policy FROM businesses WHERE id=$1', [r.body.business.id])).rows[0];
    const acct = Number((await c.query('SELECT count(*) n FROM billing_accounts WHERE business_id=$1', [r.body.business.id])).rows[0].n);
    assert.notEqual(b.billing_policy, 'commercial_v2'); assert.equal(acct, 0);
    const w = await call('POST', '/wallets', { token: beta.token, biz: r.body.business.id, body: { request_key: key(), name: 'Off cash', currency: 'IDR', opening_balance: 1000 } });
    assert.equal(w.status, 200);
    return { billing_policy: b.billing_policy };
  });
  await check('flag OFF: tenant isolation unchanged', async () => {
    for (const p of ['/transactions?period=all', '/wallets', '/debts', '/pulse']) assert.ok([403, 404].includes((await call('GET', p, { token: beta.token, biz: st.companies.A2 })).status), p);
  });
  await c.end();
  process.exit(save() ? 0 : 1);
})().catch((e) => { console.error('BILLING OFF CRASHED', e); process.exit(1); });
