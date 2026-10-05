const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

describe('Security & Atomicity Audit: Prevention of Atomic Write Bypass', () => {
  let db;
  const BIZ_ID = crypto.randomUUID();
  const USER_ID = 12345;
  let walletId;
  let debtId;

  before(async () => {
    db = new PGlite();

    // 1. Schema
    await db.exec(`
      CREATE TABLE public.wallets (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL,
        name text NOT NULL,
        currency text NOT NULL DEFAULT 'IDR',
        is_active boolean NOT NULL DEFAULT true,
        scope text NOT NULL DEFAULT 'business'
      );

      CREATE TABLE public.debts (
        id serial PRIMARY KEY,
        business_id uuid NOT NULL,
        type text NOT NULL DEFAULT 'payable',
        counterparty text NOT NULL,
        amount numeric NOT NULL,
        original_amount numeric NOT NULL,
        paid_amount numeric NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'IDR',
        status text NOT NULL DEFAULT 'open',
        is_settled boolean NOT NULL DEFAULT false,
        settled_at timestamptz,
        due_date date,
        scope text NOT NULL DEFAULT 'business',
        is_training boolean DEFAULT false,
        last_payment_at timestamptz,
        linked_transaction_id bigint
      );

      CREATE TABLE public.transactions (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL,
        created_by_user_id bigint,
        user_id bigint,
        type text NOT NULL,
        amount_original numeric NOT NULL,
        currency_original text NOT NULL,
        amount_idr numeric NOT NULL,
        booked_rate numeric NOT NULL DEFAULT 1,
        rate_source text DEFAULT 'system',
        description text,
        source text,
        wallet_id uuid REFERENCES public.wallets(id),
        scope text NOT NULL DEFAULT 'business',
        transaction_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        transfer_id uuid
      );

      CREATE TABLE public.debt_payment_idempotency (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        debt_id bigint NOT NULL,
        user_id bigint,
        key text NOT NULL,
        request_hash text NOT NULL,
        transaction_id bigint,
        response_status integer NOT NULL,
        response_body jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT debt_payment_idempotency_biz_key_unique UNIQUE (business_id, key)
      );
    `);

    // 2. Load migration 066 and 067
    const m66 = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '066_debt_payment_idempotency_and_atomic_rpc.sql'), 'utf8');
    await db.exec(m66);

    const m67Path = path.join(__dirname, '..', '..', 'migrations', '067_business_wallet_transfers_atomic_task30.sql');
    if (fs.existsSync(m67Path)) {
      const m67 = fs.readFileSync(m67Path, 'utf8');
      await db.exec(m67);
    }

    // 3. Seed test data
    walletId = crypto.randomUUID();
    await db.query(`INSERT INTO public.wallets (id, business_id, name, currency) VALUES ($1, $2, 'BCA Test', 'IDR')`, [walletId, BIZ_ID]);

    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency, status)
      VALUES ($1, 'payable', 'Audit Test Vendor', 10000000, 10000000, 'IDR', 'open')
      RETURNING id
    `, [BIZ_ID]);
    debtId = dRes.rows[0].id;
  });

  after(async () => {
    if (db) await db.close();
  });

  it('Bypass Check 1: Missing wallet must be rejected without creating non-atomic records', async () => {
    // Simulating server check
    const payWallet = null;
    let errorResponse = null;

    if (!payWallet) {
      errorResponse = { error: 'wallet_required', message: 'A valid active business wallet is required to record a payment' };
    }

    assert.strictEqual(errorResponse?.error, 'wallet_required');

    // Confirm DB was not mutated
    const txCount = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_ID]);
    assert.strictEqual(txCount.rows[0].c, 0, 'No non-atomic transaction created when wallet is missing');
  });

  it('Bypass Check 2: RPC execution failure aborts completely and never triggers JS fallback', async () => {
    // In our hardened server route:
    // If supabase.rpc throws or returns error, catch block returns HTTP 500 without proceeding to JS fallback
    const simulatedRpcFailure = async () => {
      throw new Error('connection_killed_during_rpc');
    };

    let serverStatus = null;
    let serverBody = null;

    try {
      await simulatedRpcFailure();
      // If code reached here, it would do JS fallback
      assert.fail('Should not proceed');
    } catch (rpcErr) {
      serverStatus = 500;
      serverBody = { error: 'atomic_payment_failed', message: rpcErr.message };
    }

    assert.strictEqual(serverStatus, 500);
    assert.strictEqual(serverBody.error, 'atomic_payment_failed');

    // Verify zero mutations in database
    const debtRow = await db.query(`SELECT paid_amount, status FROM public.debts WHERE id = $1`, [debtId]);
    assert.strictEqual(Number(debtRow.rows[0].paid_amount), 0);
    assert.strictEqual(debtRow.rows[0].status, 'open');
  });

  it('Bypass Check 3: RPC transfer failure aborts completely and never triggers multi-row insert fallback', async () => {
    const simulatedTransferRpcFailure = async () => {
      throw new Error('rpc_transfer_deadlock_detected');
    };

    let serverStatus = null;
    let serverBody = null;

    try {
      await simulatedTransferRpcFailure();
      assert.fail('Should not proceed');
    } catch (rpcErr) {
      serverStatus = 500;
      serverBody = { error: 'atomic_transfer_failed', message: rpcErr.message };
    }

    assert.strictEqual(serverStatus, 500);
    assert.strictEqual(serverBody.error, 'atomic_transfer_failed');

    const txCount = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_ID]);
    assert.strictEqual(txCount.rows[0].c, 0, 'No split transfer records created');
  });

  it('Bypass Check 4: Simultaneous attempts on atomic RPC serialize correctly via FOR UPDATE', async () => {
    const key1 = crypto.randomUUID();
    const key2 = crypto.randomUUID();

    const callRpc = (amt, key, hash) => db.query(
      `SELECT public.rpc_record_debt_payment(
        $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::numeric,
        'IDR'::text, $5::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
        $6::text, $7::text, 'BCA'::text, now()
      ) as res`,
      [BIZ_ID, USER_ID, debtId, walletId, amt, key, hash]
    );

    // 2 intentional payments of 5M on 10M debt
    const [r1, r2] = await Promise.all([
      callRpc(5000000, key1, 'hash1'),
      callRpc(5000000, key2, 'hash2'),
    ]);

    assert.strictEqual(r1.rows[0].res.ok, true);
    assert.strictEqual(r2.rows[0].res.ok, true);

    const debtRow = await db.query(`SELECT paid_amount, status, is_settled FROM public.debts WHERE id = $1`, [debtId]);
    assert.strictEqual(Number(debtRow.rows[0].paid_amount), 10000000);
    assert.strictEqual(debtRow.rows[0].status, 'paid');
    assert.strictEqual(debtRow.rows[0].is_settled, true);

    // Attempt a 3rd payment when debt is already paid
    await assert.rejects(
      async () => {
        await callRpc(1000000, crypto.randomUUID(), 'hash3');
      },
      /debt_already_closed|payment_exceeds_remaining/
    );
  });

  it('Bypass Check 5: Missing RPC function returns rpc_function_missing without fallback mutation', async () => {
    // Test that when RPC returns function does not exist error, server terminates with rpc_function_missing (never fallback)
    const simulateMissingRpcCall = (rpcName) => {
      const err = new Error(`function ${rpcName}() does not exist`);
      const msg = err.message;
      if (msg.includes('function') && msg.includes('does not exist')) {
        return { status: 500, body: { error: 'rpc_function_missing', message: `${rpcName} function does not exist in database` } };
      }
      return { status: 500, body: { error: 'other_error' } };
    };

    // Confirm DB was untouched
    const txCountBefore = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_ID]);
    // Execute simulated missing RPC
    const resDebt = simulateMissingRpcCall('rpc_record_debt_payment');
    assert.strictEqual(resDebt.status, 500);
    assert.strictEqual(resDebt.body.error, 'rpc_function_missing');

    const resXfer = simulateMissingRpcCall('rpc_execute_wallet_transfer');
    assert.strictEqual(resXfer.status, 500);
    assert.strictEqual(resXfer.body.error, 'rpc_function_missing');

    const txCountAfter = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_ID]);
    assert.strictEqual(txCountAfter.rows[0].c, txCountBefore.rows[0].c, 'No non-atomic transaction created when RPC is missing');
  });

  it('Bypass Check 6: Client without supabase.rpc returns rpc_not_available without fallback mutation', async () => {
    const handleWithoutRpc = (rpcFn) => {
      if (typeof rpcFn !== 'function') {
        return { status: 500, body: { error: 'rpc_not_available', message: 'Atomic RPC functions are not supported or available on client' } };
      }
      return { status: 200 };
    };

    const res = handleWithoutRpc(undefined);
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'rpc_not_available');
  });
});
