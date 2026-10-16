'use strict';
// V2 migration procedure safety on real PostgreSQL (Platform/admin operations): reproduces the runbook defect
// (re-running Stage A silently downgraded money-moving RPCs) and proves scripts/migrate-v2.mjs never does it.
// Behaviour, not only definitions: payments and transfers are executed before and after the runner.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { CHAIN, D4 } = require('./_d4Harness');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BILLING = ['supabase/migrations/20261015033808_cfo_commercial_trial.sql', 'supabase/migrations/20261017090000_billing_management_center.sql', 'supabase/migrations/20261017120000_billing_enforcement.sql'];
const OWNER = 96001;
const dbs = [];
after(async () => { for (const d of dbs) await d.drop().catch(() => {}); });
const runner = async () => import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts', 'migrate-v2.mjs')).href);
const quiet = () => {};

async function fullTarget(prefix) {
  const db = await createProdSchemaDatabase(prefix, [...CHAIN, D4]); if (!db) return null; dbs.push(db);
  const c = new Client({ connectionString: db.connectionString }); await c.connect();
  await c.query(read('migrations/072_platform_admins.sql')); await c.query(read('migrations/073_platform_admins_security.sql'));
  await c.query('SET search_path = "$user", public');
  for (const f of BILLING) await c.query(read(f));
  return { db, c };
}
// Business, two wallets with 100 each, an approved payable of 100.
async function seed(c) {
  const B = crypto.randomUUID(), W = crypto.randomUUID(), V = crypto.randomUUID();
  await c.query('INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING', [OWNER]);
  await c.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Runner Co',$2,'business')", [B, OWNER]);
  await c.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')", [B, OWNER]);
  await c.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$3,$4,'Cash A','IDR','business'),($2,$3,$4,'Cash B','IDR','business')", [W, V, B, OWNER]);
  for (const w of [W, V]) await c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,source,scope,transaction_date) VALUES($1,$2,'income',100,100,'IDR',$3,'manual','business','2026-10-04')", [B, OWNER, w]);
  const debt = (await c.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope,approval_status) VALUES($1,$2,'payable','Runner supplier',100,100,'IDR','business','approved') RETURNING id", [B, OWNER])).rows[0].id;
  return { B, W, V, debt };
}
const rpc = async (c, name, args) => { const e = Object.entries(args); return (await c.query(`SELECT public.${name}(${e.map(([k], i) => `${k}=>$${i + 1}`).join(',')}) r`, e.map(([, v]) => v))).rows[0].r };
const pay = (s, key, amount = 10) => ({ p_business_id: s.B, p_user_id: OWNER, p_debt_id: s.debt, p_wallet_id: s.W, p_amount: amount, p_currency: 'IDR', p_amount_idr: amount,
  p_booked_rate: 1, p_rate_source: 'identity', p_payment_date: '2026-10-05', p_idempotency_key: key, p_request_hash: key || 'no-key' });
const transfer = (s, id) => ({ p_business_id: s.B, p_user_id: OWNER, p_from_wallet_id: s.W, p_to_wallet_id: s.V, p_source_amount: 5, p_source_currency: 'IDR', p_source_amount_idr: 5,
  p_source_booked_rate: 1, p_target_amount: 5, p_target_currency: 'IDR', p_target_amount_idr: 5, p_target_booked_rate: 1, p_rate_source: 'identity',
  p_description: 'Runner transfer', p_transaction_date: '2026-10-05', p_transfer_id: id, p_scope: 'business' });
const balance = async (c, w) => Number((await c.query('SELECT fn_wallet_ledger_balance($1) b', [w])).rows[0].b);
const fnHashes = async (c) => Object.fromEntries((await c.query("SELECT p.oid::regprocedure::text n, md5(pg_get_functiondef(p.oid)) h FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'")).rows.map(r => [r.n, r.h]));
const guardedHaveKeyCheck = async (c) => (await c.query("SELECT bool_and(pg_get_functiondef(oid) LIKE '%idempotency_key_required%') ok FROM pg_proc WHERE proname IN ('rpc_record_debt_payment_guarded','rpc_execute_wallet_transfer_guarded')")).rows[0].ok;

test('reproduced: the old runbook (re-run Stage A) disables idempotency on payments and transfers', async (t) => {
  const env = await fullTarget('mr_old'); if (!env) return t.skip('no PostgreSQL');
  const { c } = env; const s = await seed(c);
  assert.equal(await guardedHaveKeyCheck(c), true);
  await assert.rejects(rpc(c, 'rpc_record_debt_payment_guarded', pay(s, null)), /idempotency_key_required/);
  for (const f of CHAIN) { try { await c.query(read('migrations/' + f)) } catch { await c.query('ROLLBACK').catch(() => {}) } }   // old: psql -f, errors ignored
  assert.equal(await guardedHaveKeyCheck(c), false, 'the key check is gone');
  const accepted = await rpc(c, 'rpc_record_debt_payment_guarded', pay(s, null)).then(() => true, () => false);
  assert.equal(accepted, true, 'a payment without an idempotency key is now accepted');
  await c.end();
});

test('runner on a fully migrated database: applies nothing, changes no function or balance, idempotency intact', async (t) => {
  const env = await fullTarget('mr_full'); if (!env) return t.skip('no PostgreSQL');
  const { db, c } = env; const s = await seed(c);
  const { migrate } = await runner();
  const h0 = await fnHashes(c), b0 = [await balance(c, s.W), await balance(c, s.V)];
  const plan = await migrate({ connectionString: db.connectionString, mode: 'plan', log: quiet });
  assert.deepEqual([...new Set(plan.entries.map(e => e.state))], ['APPLIED_UNRECORDED']);
  const r1 = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.equal(r1.ok, true, JSON.stringify(r1.postflight.filter(p => !p.ok)));
  assert.deepEqual(r1.applied, []); assert.equal(r1.adopted.length, 20);
  assert.deepEqual(await fnHashes(c), h0, 'no function definition changed');
  assert.deepEqual([await balance(c, s.W), await balance(c, s.V)], b0, 'no balance changed');
  const r2 = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.deepEqual([...new Set(r2.entries.map(e => e.state))], ['APPLIED']); assert.deepEqual(r2.applied, []);
  // Behaviour after the runner: keyed payment and transfer repeats do not duplicate; unkeyed ones are refused.
  await assert.rejects(rpc(c, 'rpc_record_debt_payment_guarded', pay(s, null)), /idempotency_key_required/);
  const k = crypto.randomUUID();
  await rpc(c, 'rpc_record_debt_payment_guarded', pay(s, k));
  const again = await rpc(c, 'rpc_record_debt_payment_guarded', pay(s, k));
  assert.equal(again.is_replay, true);
  assert.equal(await balance(c, s.W), b0[0] - 10, 'one payment, not two');
  assert.equal(Number((await c.query('SELECT paid_amount FROM debts WHERE id=$1', [s.debt])).rows[0].paid_amount), 10);
  await assert.rejects(rpc(c, 'rpc_execute_wallet_transfer_guarded', transfer(s, null)), /idempotency_key_required/);
  const tid = crypto.randomUUID();
  await rpc(c, 'rpc_execute_wallet_transfer_guarded', transfer(s, tid));
  assert.equal((await rpc(c, 'rpc_execute_wallet_transfer_guarded', transfer(s, tid))).is_replay, true);
  assert.deepEqual([await balance(c, s.W), await balance(c, s.V)], [b0[0] - 15, b0[1] + 5], 'one transfer pair');
  await c.end();
});

test('unknown (partial) state stops the run: nothing after it is applied without an explicit decision', async (t) => {
  const db = await createProdSchemaDatabase('mr_unknown', CHAIN.slice(0, 5)); if (!db) return t.skip('no PostgreSQL'); dbs.push(db);
  const c = new Client({ connectionString: db.connectionString }); await c.connect();
  // 20261011001823 now half-present: its table and patched RPCs exist, its writer-gate triggers do not.
  for (const { rel } of (await c.query("SELECT tgrelid::regclass::text rel FROM pg_trigger WHERE tgname='financial_writer_gate'")).rows)
    await c.query(`DROP TRIGGER financial_writer_gate ON ${rel}`);
  const { migrate } = await runner();
  const r = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.equal(r.ok, false);
  assert.deepEqual(r.stoppedAt, { file: 'migrations/20261011001823_financial_writer_protocol.sql', reason: 'UNKNOWN' });
  assert.deepEqual(r.applied, []);
  assert.equal((await c.query("SELECT to_regclass('public.business_creation_requests') r")).rows[0].r, null, 'later migrations did not run');
  assert.equal((await c.query("SELECT to_regclass('public.platform_admins') r")).rows[0].r, null);
  await c.end();
});

test('fresh database (production snapshot): applies the whole manifest in order, postflight passes, second run is a no-op', async (t) => {
  const db = await createProdSchemaDatabase('mr_fresh', []); if (!db) return t.skip('no PostgreSQL'); dbs.push(db);
  const { migrate, MANIFEST } = await runner();
  const r = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.equal(r.ok, true, JSON.stringify({ stop: r.stoppedAt, post: r.postflight.filter(p => !p.ok) }));
  assert.deepEqual(r.applied, MANIFEST.map(m => m.file));
  const again = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.deepEqual(again.applied, []); assert.equal(again.ok, true);
});

test('a changed file and a failing file both stop the run; the failed file leaves nothing behind', async (t) => {
  const db = await createProdSchemaDatabase('mr_stop', CHAIN.slice(0, 12)); if (!db) return t.skip('no PostgreSQL'); dbs.push(db);
  const c = new Client({ connectionString: db.connectionString }); await c.connect();
  // A conflicting object that is not a probe: 20261013114500 will fail inside its own transaction.
  await c.query("CREATE FUNCTION public.fn_bill_creation_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");
  const { migrate } = await runner();
  const r = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.equal(r.stoppedAt.file, 'migrations/20261013114500_atomic_bill_creation.sql'); assert.equal(r.stoppedAt.reason, 'ERROR');
  assert.equal((await c.query("SELECT to_regclass('public.bill_creation_requests') r")).rows[0].r, null, 'rolled back, no partial file');
  assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc WHERE proname='fn_operation_documents_version'")).rows[0].n, 0, 'nothing after it ran');
  // Changed file: the ledger checksum no longer matches.
  await c.query("UPDATE public.cfo_migration_ledger SET sha256='tampered' WHERE file='migrations/069_bank_import_atomic_confirm.sql'");
  const r2 = await migrate({ connectionString: db.connectionString, mode: 'apply', log: quiet });
  assert.deepEqual(r2.stoppedAt, { file: 'migrations/069_bank_import_atomic_confirm.sql', reason: 'CHANGED' });
  await c.end();
});
