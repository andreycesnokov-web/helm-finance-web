'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { createIntegratedDatabase } = require('./_integratedSchemaDb');
let db, c, d, observer;
const uid = () => crypto.randomUUID();
const settled = p => p.then(value => ({ value }), error => ({ error }));
before(async () => {
  db = await createIntegratedDatabase('cfo_integrated');
  [c, d, observer] = await Promise.all([1, 2, 3].map(async () => {
    const x = new Client({ connectionString: db.connectionString }); await x.connect();
    await x.query("SET statement_timeout='8s'; SET lock_timeout='6s'"); return x;
  }));
  await c.query('INSERT INTO users(id) VALUES(73001),(73002)');
  // Earlier balance fixtures may create a plain service_role in this disposable cluster.
  // Match Supabase's service role explicitly; do not weaken RLS or the RPC.
  await c.query('ALTER ROLE service_role BYPASSRLS');
  await c.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role');
});
after(async () => {
  for (const x of [c, d, observer]) if (x) { await x.query('ROLLBACK').catch(() => {}); await x.end(); }
  if (db) await db.drop();
});
async function tx(f, type, amount, x = c, overrides = {}) {
  const v = { business: f.a, wallet: f.w, currency: 'IDR', date: '2026-05-10', provenance: null, scope: 'business', ...overrides };
  const r = await x.query(`INSERT INTO transactions(business_id,user_id,type,amount_original,currency_original,
    amount_idr,wallet_id,scope,transaction_date,source,bank_import_row_id)
    VALUES($1,73001,$2,$3,$4,$3,$5,$6,$7,'manual',$8) RETURNING *`,
  [v.business, type, amount, v.currency, v.wallet, v.scope, v.date, v.provenance]);
  return r.rows[0];
}
async function fixture(opening = 100) {
  const f = { a: uid(), b: uid(), w: uid(), v: uid() };
  await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'A',73001,'business'),($2,'B',73002,'business')", [f.a, f.b]);
  await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope,type) VALUES($1,$2,73001,'A cash','IDR','business','bank'),($3,$4,73002,'B cash','IDR','business','bank')", [f.w, f.a, f.v, f.b]);
  if (opening) await tx(f, opening < 0 ? 'correction' : 'income', opening);
  return f;
}
async function statement(f, lines = [{ amount: 70, direction: 'out' }], tag = uid()) {
  const batch = uid(), rows = [];
  await c.query(`INSERT INTO bank_import_batches(id,business_id,wallet_id,uploaded_by_user_id,currency,statement_start,statement_end,
    opening_balance,closing_balance,status,row_count) VALUES($1,$2,$3,73001,'IDR','2026-05-01','2026-05-31',100,$4,'review_required',$5)`,
  [batch, f.a, f.w, 100 + lines.reduce((s, l) => s + (l.direction === 'in' ? 1 : -1) * l.amount, 0), lines.length]);
  for (const [i, line] of lines.entries()) {
    const r = { id: uid(), date: '2026-05-10', ...line };
    await c.query(`INSERT INTO bank_import_rows(id,batch_id,business_id,row_index,tx_date,description,amount,direction,dedup_hash,review_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'suggested')`, [r.id, batch, f.a, i, r.date, tag + i, r.amount, r.direction, tag + i]);
    rows.push(r);
  }
  return { batch, rows };
}
const plan = s => s.rows.map(r => ({ row_id: r.id, action: 'create', type: r.direction === 'in' ? 'income' : 'expense', scope: 'business',
  expected_amount: r.amount, expected_date: r.date, currency: 'IDR', amount_idr: Math.round(r.amount), booked_rate: 1, rate_source: 'identity' }));
async function confirm(f, s, x = c, p = plan(s)) {
  return (await x.query('SELECT rpc_confirm_bank_import($1,$2,73001,73001,$3::jsonb,\'review\') result', [f.a, s.batch, JSON.stringify(p)])).rows[0].result;
}
const balance = async (f, x = c) => Number((await x.query('SELECT fn_wallet_ledger_balance($1) b', [f.w])).rows[0].b);
const reject = (p, code) => assert.rejects(p, e => e.message.startsWith(code + ':'));
async function snapshot(f) {
  return (await c.query(`SELECT jsonb_build_object(
    'tx',(SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM transactions t WHERE business_id=$1),
    'rows',(SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM bank_import_rows t WHERE business_id=$1),
    'batches',(SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM bank_import_batches t WHERE business_id=$1),
    'feedback',(SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM classification_feedback t WHERE business_id=$1),
    'reconciliation',(SELECT coalesce(jsonb_agg(t ORDER BY id),'[]') FROM bank_reconciliations t WHERE business_id=$1)) state`, [f.a])).rows[0].state;
}
async function blocked(first, second) {
  for (let i = 0; i < 500; i++) {
    if ((await observer.query('SELECT $1=ANY(pg_blocking_pids($2)) b', [first.processID, second.processID])).rows[0].b) return;
    await new Promise(r => setTimeout(r, 2));
  }
  throw Error('No observed lock barrier');
}
async function race(first, second) {
  await c.query('BEGIN');
  try {
    await first(c);
    const pending = settled(second(d)); await blocked(c, d);
    await c.query('COMMIT'); return await pending;
  } finally { await c.query('ROLLBACK'); }
}

test('historical bank expense may establish -70; subsequent manual expense is refused', async () => {
  const f = await fixture(0), s = await statement(f);
  assert.equal((await confirm(f, s)).imported, 1); assert.equal(await balance(f), -70);
  const state = await snapshot(f); await reject(tx(f, 'expense', 1), 'wallet_balance_negative');
  assert.deepEqual(await snapshot(f), state);
  await tx(f, 'income', 80); assert.equal(await balance(f), 10);
});
test('manual expense at zero cannot use an ordinary body flag to get historical exemption', async () => {
  const f = await fixture(0); await reject(tx(f, 'expense', 70), 'insufficient_balance');
  assert.equal(await balance(f), 0);
});
for (const variant of ['fake', 'foreign', 'amount', 'date', 'currency', 'wallet', 'direction', 'scope']) {
  test(`provenance rejects ${variant} bank evidence without ledger changes`, async () => {
    const f = await fixture(0), s = await statement(f);
    const over = { provenance: s.rows[0].id }; let amount = 70, type = 'expense';
    if (variant === 'fake') over.provenance = uid();
    if (variant === 'foreign') over.business = f.b;
    if (variant === 'amount') amount = 71;
    if (variant === 'date') over.date = '2026-05-11';
    if (variant === 'currency') over.currency = 'USD';
    if (variant === 'wallet') over.wallet = f.v;
    if (variant === 'direction') type = 'income';
    if (variant === 'scope') over.scope = 'personal';
    const state = await snapshot(f); await reject(tx(f, type, amount, c, over), 'invalid_import_provenance');
    assert.deepEqual(await snapshot(f), state);
  });
}
test('a matching evidence ID alone cannot commit a forged standalone INSERT', async () => {
  const f = await fixture(0), s = await statement(f), state = await snapshot(f);
  await reject(tx(f, 'expense', 70, c, { provenance: s.rows[0].id }), 'invalid_import_provenance');
  assert.deepEqual(await snapshot(f), state);
});
test('GUC flag does not authorize a provenance bypass', async () => {
  const f = await fixture(0), s = await statement(f); await c.query('BEGIN');
  await c.query("SET LOCAL app.bank_import='true'");
  await tx(f, 'expense', 70, c, { provenance: s.rows[0].id });
  await reject(c.query('COMMIT'), 'invalid_import_provenance'); await c.query('ROLLBACK');
  assert.equal(await balance(f), 0);
});
test('confirmed provenance cannot be reused, reassigned or detached', async () => {
  const f = await fixture(0), s = await statement(f); await confirm(f, s);
  await reject(tx(f, 'expense', 70, c, { provenance: s.rows[0].id }), 'invalid_import_provenance');
  const t = (await c.query('SELECT * FROM transactions WHERE bank_import_row_id=$1', [s.rows[0].id])).rows[0];
  await reject(c.query('UPDATE transactions SET bank_import_row_id=NULL WHERE id=$1', [t.id]), 'invalid_import_provenance');
  await reject(c.query('UPDATE transactions SET amount_original=71 WHERE id=$1', [t.id]), 'invalid_import_provenance');
  const manual = await tx(f, 'income', 100);
  await reject(c.query('UPDATE transactions SET bank_import_row_id=$1 WHERE id=$2', [s.rows[0].id, manual.id]), 'invalid_import_provenance');
});
test('bank-row and batch metadata cannot invalidate an existing reciprocal provenance link', async () => {
  const f = await fixture(0), s = await statement(f); await confirm(f, s); const state = await snapshot(f);
  await reject(c.query("UPDATE bank_import_rows SET direction='in' WHERE id=$1", [s.rows[0].id]), 'invalid_import_provenance');
  await reject(c.query("UPDATE bank_import_batches SET currency='USD' WHERE id=$1", [s.batch]), 'invalid_import_provenance');
  assert.deepEqual(await snapshot(f), state);
});
test('create/link/exclude are atomic and link does not double book cash', async () => {
  const f = await fixture(100), target = await tx(f, 'expense', 10);
  const s = await statement(f, [{ amount: 10, direction: 'out' }, { amount: 20, direction: 'out' }, { amount: 30, direction: 'out' }]);
  const p = plan(s); p[0] = { ...p[0], action: 'link', matched_transaction_id: target.id }; p[2].action = 'exclude';
  const result = await confirm(f, s, c, p);
  assert.equal(result.imported, 1); assert.equal(result.linked, 1); assert.equal(result.excluded, 1);
  assert.equal(await balance(f), 70);
  const state = await snapshot(f); await reject(confirm(f, s, c, p), 'batch_closed'); assert.deepEqual(await snapshot(f), state);
});
test('partial confirms reconcile all linked rows, including earlier requests', async () => {
  const f = await fixture(0), s = await statement(f, [{ amount: 10, direction: 'out' }, { amount: 20, direction: 'out' }]);
  const p = plan(s); await confirm(f, s, c, [p[0]]);
  const result = await confirm(f, s, c, [p[1]]);
  assert.equal(Number(result.reconciliation.computed_closing), 70); assert.equal(Number(result.reconciliation.difference), 0);
});
test('later invalid row rolls back ledger, links, feedback, reconciliation and status', async () => {
  const f = await fixture(0), s = await statement(f, [{ amount: 10, direction: 'out' }, { amount: 20, direction: 'out' }]);
  const p = plan(s); p[1].expected_date = '2026-05-11'; const state = await snapshot(f);
  await reject(confirm(f, s, c, p), 'row_changed'); assert.deepEqual(await snapshot(f), state);
});
test('link rejects same amount with wrong currency/date and rolls back', async () => {
  const f = await fixture(100), t = await tx(f, 'expense', 70, c, { date: '2026-05-11' }), s = await statement(f);
  const p = plan(s); p[0] = { ...p[0], action: 'link', matched_transaction_id: t.id };
  const state = await snapshot(f); await reject(confirm(f, s, c, p), 'link_mismatch'); assert.deepEqual(await snapshot(f), state);
});
test('RPC wrong direction cannot consume a historical balance exemption', async () => {
  const f = await fixture(0), s = await statement(f), p = plan(s); p[0].type = 'income';
  await reject(confirm(f, s, c, p), 'invalid_row'); assert.equal(await balance(f), 0);
});
test('concurrent confirm same batch has one writer and no duplicated rows', async () => {
  const f = await fixture(0), s = await statement(f);
  const result = await race(x => confirm(f, s, x), x => confirm(f, s, x));
  assert.match(result.error?.message || '', /^batch_closed:/); assert.equal(await balance(f), -70);
});
test('concurrent sibling batches reject imported duplicate', async () => {
  const f = await fixture(0), s = await statement(f, undefined, 'identical'), other = await statement(f, undefined, 'identical');
  const result = await race(x => confirm(f, s, x), x => confirm(f, other, x));
  assert.match(result.error?.message || '', /^duplicate_of_imported_row:/); assert.equal(await balance(f), -70);
});
test('import then competing manual outflow cannot deepen negative balance', async () => {
  const f = await fixture(100), s = await statement(f);
  const result = await race(x => confirm(f, s, x), x => tx(f, 'expense', 70, x));
  assert.match(result.error?.message || '', /^insufficient_balance:/); assert.equal(await balance(f), 30);
});
test('manual outflow first does not incorrectly reject subsequent historical import', async () => {
  const f = await fixture(100), s = await statement(f);
  const result = await race(x => tx(f, 'expense', 70, x), x => confirm(f, s, x));
  assert.ok(!result.error, result.error?.message); assert.equal(await balance(f), -40);
});
test('import then concurrent PATCH cannot deepen negative balance', async () => {
  const f = await fixture(100), t = await tx(f, 'expense', 10), s = await statement(f);
  const result = await race(x => confirm(f, s, x), x => x.query('SELECT rpc_patch_business_transaction($1,73001,$2,0,$3::jsonb,true)', [f.a, t.id, JSON.stringify({ amount_original: 80, amount_idr: 80 })]));
  assert.match(result.error?.message || '', /^insufficient_balance:/); assert.equal(await balance(f), 20);
});
test('PATCH first followed by confirm uses updated ledger snapshot', async () => {
  const f = await fixture(100), t = await tx(f, 'expense', 10), s = await statement(f);
  const result = await race(x => x.query('SELECT rpc_patch_business_transaction($1,73001,$2,0,$3::jsonb,true)', [f.a, t.id, JSON.stringify({ amount_original: 80, amount_idr: 80 })]), x => confirm(f, s, x));
  assert.ok(!result.error, result.error?.message); assert.equal(await balance(f), -50);
});
test('concurrent manual outflows keep one winner on integrated schema', async () => {
  const f = await fixture(100);
  const result = await race(x => tx(f, 'expense', 70, x), x => tx(f, 'expense', 70, x));
  assert.match(result.error?.message || '', /^insufficient_balance:/); assert.equal(await balance(f), 30);
});
test('client roles cannot execute import RPC or provenance helper', async () => {
  for (const role of ['anon', 'authenticated']) {
    await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(c.query('SELECT fn_check_import_pair(1)'), e => e.code === '42501'); await c.query('ROLLBACK');
    await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(c.query('SELECT rpc_confirm_bank_import(NULL,NULL,73001,73001,\'[]\'::jsonb,\'review\')'), e => e.code === '42501'); await c.query('ROLLBACK');
  }
});
test('service_role invokes the integrated SECURITY INVOKER RPC successfully', async () => {
  const f = await fixture(0), s = await statement(f);
  await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role');
  await confirm(f, s); await c.query('COMMIT'); assert.equal(await balance(f), -70);
});

test('guarded debt payments are atomic and idempotent on the production schema', async () => {
  const f = await fixture(100);
  const debt = (await c.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope) VALUES($1,73001,'payable','Supplier',70,70,'IDR','business') RETURNING id", [f.a])).rows[0].id;
  const pay = x => x.query("SELECT rpc_record_debt_payment_guarded($1,73001,$2,$3,70,'IDR',70,1,'test','2026-05-10','same-payment','same-hash',NULL,now()) r", [f.a, debt, f.w]);
  const result = await race(pay, pay); assert.ok(!result.error, result.error?.message);
  assert.equal(await balance(f), 30);
  assert.equal(Number((await c.query('SELECT paid_amount FROM debts WHERE id=$1', [debt])).rows[0].paid_amount), 70);
});
test('guarded transfer conserves native cash and repeat does not create another pair', async () => {
  const f = await fixture(100), target = uid(), transfer = uid();
  await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope,type) VALUES($1,$2,73001,'Second','IDR','business','bank')", [target, f.a]);
  const move = () => c.query("SELECT rpc_execute_wallet_transfer_guarded($1,73001,$2,$3,70,'IDR',70,1,70,'IDR',70,1,'test',NULL,'2026-05-10',$4,'business') r", [f.a, f.w, target, transfer]);
  await move(); await move(); assert.equal(await balance(f), 30);
  assert.equal(Number((await c.query('SELECT fn_wallet_ledger_balance($1) b', [target])).rows[0].b), 70);
});
test('payroll RPC commits ledger/payment/items together and rejects an unfunded retry', async () => {
  const f = await fixture(100);
  const transaction = { type: 'payroll', amount_original: 70, amount_idr: 70, currency_original: 'IDR', wallet_id: f.w, transaction_date: '2026-05-10' };
  const payment = { employee_name: 'Synthetic employee', amount: 70, gross_amount: 70, deduction_amount: 0, net_amount: 70, currency: 'IDR', wallet_id: f.w, payment_type: 'salary', payment_date: '2026-05-10', status: 'paid' };
  const pay = () => c.query('SELECT rpc_record_business_payroll($1,73001,$2::jsonb,$3::jsonb,\'[]\'::jsonb) r', [f.a, JSON.stringify(transaction), JSON.stringify(payment)]);
  await pay(); await reject(pay(), 'insufficient_balance'); assert.equal(await balance(f), 30);
  assert.equal(Number((await c.query('SELECT count(*) n FROM payroll_payments WHERE business_id=$1', [f.a])).rows[0].n), 1);
});
