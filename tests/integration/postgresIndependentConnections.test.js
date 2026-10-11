// Real PostgreSQL Integration Test: Two Independent TCP Connections
// Verifies transaction atomicity, SELECT FOR UPDATE row-level locking, and idempotency across concurrent connections.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgrespassword@localhost:5432/testdb';

describe('Real PostgreSQL Concurrency & Atomicity on 2 Independent Connections', () => {
  let client1;
  let client2;
  const BIZ_A = crypto.randomUUID();
  const BIZ_B = crypto.randomUUID();
  const USER_A = 1001;
  const USER_B = 1002;
  let walletA;
  let walletB;
  let walletDestA;
  let debtIdA;

  before(async () => {
    client1 = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    client2 = new Client({ connectionString, connectionTimeoutMillis: 5000 });

    try {
      await client1.connect();
      await client2.connect();
    } catch (connErr) {
      console.error('PostgreSQL connection failed:', connErr.message);
      throw connErr;
    }

    // 1. Initialize schema via client1
    await client1.query(`
      CREATE TABLE IF NOT EXISTS public.businesses (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public.wallets (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL,
        name text NOT NULL,
        currency text NOT NULL DEFAULT 'IDR',
        is_active boolean NOT NULL DEFAULT true,
        scope text NOT NULL DEFAULT 'business'
      );

      CREATE TABLE IF NOT EXISTS public.debts (
        id bigserial PRIMARY KEY,
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

      CREATE TABLE IF NOT EXISTS public.transactions (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL,
        created_by_user_id bigint,
        user_id bigint,
        type text NOT NULL,
        category text,
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
    `);

    // Insert businesses
    await client1.query(`
      INSERT INTO public.businesses (id, name) VALUES
        ($1, 'Business A'),
        ($2, 'Business B')
      ON CONFLICT (id) DO NOTHING;
    `, [BIZ_A, BIZ_B]);

    // 2. Load migrations 066 and 067
    const m66 = fs.readFileSync(path.join(__dirname, '../../migrations/066_debt_payment_idempotency_and_atomic_rpc.sql'), 'utf8');
    await client1.query(m66);

    const m67 = fs.readFileSync(path.join(__dirname, '../../migrations/067_business_wallet_transfers_atomic_task30.sql'), 'utf8');
    await client1.query(m67);

    // 3. Seed test data
    walletA = crypto.randomUUID();
    walletDestA = crypto.randomUUID();
    walletB = crypto.randomUUID();

    await client1.query(`
      INSERT INTO public.wallets (id, business_id, name, currency) VALUES
        ($1, $2, 'BCA Primary', 'IDR'),
        ($3, $2, 'Mandiri Reserve', 'IDR'),
        ($4, $5, 'Foreign Wallet B', 'IDR')
    `, [walletA, BIZ_A, walletDestA, walletB, BIZ_B]);

    const dRes = await client1.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency, status)
      VALUES ($1, 'payable', 'Independent Conn Vendor', 10000000, 10000000, 'IDR', 'open')
      RETURNING id
    `, [BIZ_A]);
    debtIdA = dRes.rows[0].id;
  });

  after(async () => {
    if (client1) await client1.end().catch(() => {});
    if (client2) await client2.end().catch(() => {});
  });

  it('Check 1: Concurrent replay of same payment on 2 independent connections results in 1 transaction and 1 replay response', async () => {
    const key = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(`check1-${key}`).digest('hex');

    const callRpc = (client) => client.query(
      `SELECT public.rpc_record_debt_payment(
        $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::numeric,
        'IDR'::text, $5::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
        $6::text, $7::text, 'BCA'::text, now()
      ) as res`,
      [BIZ_A, USER_A, debtIdA, walletA, 2000000, key, hash]
    );

    // Execute concurrently across client1 and client2
    const [res1, res2] = await Promise.all([callRpc(client1), callRpc(client2)]);

    const r1 = res1.rows[0].res;
    const r2 = res2.rows[0].res;

    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.ok, true);

    const replayCount = (r1.is_replay ? 1 : 0) + (r2.is_replay ? 1 : 0);
    assert.strictEqual(replayCount, 1, 'Exactly one connection executed the payment, the other received replay');

    // Verify only ONE transaction record exists for this payment
    const txRows = await client1.query(
      `SELECT count(*)::int as count FROM public.transactions WHERE business_id = $1 AND description = 'Payment: Independent Conn Vendor'`,
      [BIZ_A]
    );
    assert.strictEqual(txRows.rows[0].count, 1, 'Exactly one transaction record created');

    const debtRow = await client1.query(`SELECT paid_amount FROM public.debts WHERE id = $1`, [debtIdA]);
    assert.strictEqual(Number(debtRow.rows[0].paid_amount), 2000000);
  });

  it('Check 2: Different payments on 2 independent connections serialize via FOR UPDATE and prevent overpayment', async () => {
    // Current debt paid_amount is 2M, remaining is 8M.
    // Connection 1 attempts 5M payment with keyA
    // Connection 2 attempts 5M payment with keyB
    // Total attempted: 10M > remaining 8M.
    // One must succeed, the second must be rejected with payment_exceeds_remaining!
    const keyA = crypto.randomUUID();
    const keyB = crypto.randomUUID();

    const callRpc = (client, amt, key) => client.query(
      `SELECT public.rpc_record_debt_payment(
        $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::numeric,
        'IDR'::text, $5::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
        $6::text, $7::text, 'BCA'::text, now()
      ) as res`,
      [BIZ_A, USER_A, debtIdA, walletA, amt, key, `hash-${key}`]
    );

    const results = await Promise.allSettled([
      callRpc(client1, 5000000, keyA),
      callRpc(client2, 5000000, keyB),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one 5M payment succeeded');
    assert.strictEqual(rejected.length, 1, 'The competing payment was rejected due to row lock and overpayment check');
    assert.match(rejected[0].reason.message, /payment_exceeds_remaining/);

    const debtRow = await client1.query(`SELECT paid_amount, status FROM public.debts WHERE id = $1`, [debtIdA]);
    assert.strictEqual(Number(debtRow.rows[0].paid_amount), 7000000, 'Debt paid_amount reflects exactly one payment (2M + 5M = 7M)');
    assert.strictEqual(debtRow.rows[0].status, 'partial');
  });

  it('Check 3: Concurrent replay of transfer on 2 independent connections creates exactly one debit/credit pair', async () => {
    const transferId = crypto.randomUUID();

    const callTransferRpc = (client) => client.query(
      `SELECT public.rpc_execute_wallet_transfer(
        $1::uuid, $2::bigint, $3::uuid, $4::uuid, $5::numeric,
        'IDR'::text, $5::numeric, 1::numeric, $5::numeric, 'IDR'::text,
        $5::numeric, 1::numeric, 'system'::text, 'Transfer Test'::text,
        '2026-10-05'::date, $6::uuid, 'business'::text
      ) as res`,
      [BIZ_A, USER_A, walletA, walletDestA, 1500000, transferId]
    );

    const [res1, res2] = await Promise.all([callTransferRpc(client1), callTransferRpc(client2)]);
    const r1 = res1.rows[0].res;
    const r2 = res2.rows[0].res;

    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.ok, true);

    const replayCount = (r1.is_replay ? 1 : 0) + (r2.is_replay ? 1 : 0);
    assert.strictEqual(replayCount, 1, 'One transfer was fresh, second was recognized as replay');

    // Confirm in DB that exactly 2 records (one debit, one credit) exist for this transfer_id
    const txRows = await client1.query(
      `SELECT id, type, amount_original FROM public.transactions WHERE transfer_id = $1`,
      [transferId]
    );
    assert.strictEqual(txRows.rows.length, 2, 'Exactly 2 records created (1 pair)');
    const types = txRows.rows.map(r => r.type).sort();
    assert.deepStrictEqual(types, ['expense', 'income']);
  });

  it('Check 4: Failure inside RPC rolls back transaction completely leaving zero partial records', async () => {
    const key = crypto.randomUUID();
    const countBefore = await client1.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_A]);

    // Call payment RPC with amount exceeding remaining (20M > remaining 3M) which triggers RAISE EXCEPTION
    await assert.rejects(
      async () => {
        await client1.query(
          `SELECT public.rpc_record_debt_payment(
            $1::uuid, $2::bigint, $3::bigint, $4::uuid, 20000000::numeric,
            'IDR'::text, 20000000::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
            $5::text, 'invalid_hash'::text, 'BCA'::text, now()
          )`,
          [BIZ_A, USER_A, debtIdA, walletA, key]
        );
      },
      /payment_exceeds_remaining/
    );

    const countAfter = await client1.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_A]);
    assert.strictEqual(countAfter.rows[0].c, countBefore.rows[0].c, 'No partial records created after rollback');

    const debtRow = await client1.query(`SELECT paid_amount FROM public.debts WHERE id = $1`, [debtIdA]);
    assert.strictEqual(Number(debtRow.rows[0].paid_amount), 7000000, 'Debt paid_amount unchanged');
  });

  it('Check 5: Same idempotency key with different payload triggers conflict without new records', async () => {
    const key = crypto.randomUUID();
    const hash1 = 'hash-check5-payload-1';
    const hash2 = 'hash-check5-payload-2';

    // 1st request with hash1 succeeds (1M payment, remaining 3M -> 2M)
    const res1 = await client1.query(
      `SELECT public.rpc_record_debt_payment(
        $1::uuid, $2::bigint, $3::bigint, $4::uuid, 1000000::numeric,
        'IDR'::text, 1000000::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
        $5::text, $6::text, 'BCA'::text, now()
      ) as res`,
      [BIZ_A, USER_A, debtIdA, walletA, key, hash1]
    );
    assert.strictEqual(res1.rows[0].res.ok, true);

    const txCountBefore = await client1.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_A]);

    // 2nd request on client2 with same key but different hash2 MUST fail with idempotency_key_mismatch
    await assert.rejects(
      async () => {
        await client2.query(
          `SELECT public.rpc_record_debt_payment(
            $1::uuid, $2::bigint, $3::bigint, $4::uuid, 2000000::numeric,
            'IDR'::text, 2000000::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
            $5::text, $6::text, 'BCA'::text, now()
          )`,
          [BIZ_A, USER_A, debtIdA, walletA, key, hash2]
        );
      },
      /idempotency_key_mismatch/
    );

    const txCountAfter = await client1.query(`SELECT count(*)::int as c FROM public.transactions WHERE business_id = $1`, [BIZ_A]);
    assert.strictEqual(txCountAfter.rows[0].c, txCountBefore.rows[0].c, 'No new transactions created on mismatch');
  });

  it('Check 6: Operation with objects of another company fails with isolation error and zero mutations', async () => {
    const countBefore = await client1.query(`SELECT count(*)::int as c FROM public.transactions`);

    // Business B user attempts to pay Business A debt using Business B wallet
    await assert.rejects(
      async () => {
        await client2.query(
          `SELECT public.rpc_record_debt_payment(
            $1::uuid, $2::bigint, $3::bigint, $4::uuid, 500000::numeric,
            'IDR'::text, 500000::numeric, 1::numeric, 'system'::text, '2026-10-05'::date,
            $5::text, 'hash'::text, 'BCA'::text, now()
          )`,
          [BIZ_B, USER_B, debtIdA, walletB, crypto.randomUUID()]
        );
      },
      /debt_not_found/
    );

    // Business A attempts transfer to or from Business B wallet
    await assert.rejects(
      async () => {
        await client1.query(
          `SELECT public.rpc_execute_wallet_transfer(
            $1::uuid, $2::bigint, $3::uuid, $4::uuid, 500000::numeric,
            'IDR'::text, 500000::numeric, 1::numeric, 500000::numeric, 'IDR'::text,
            500000::numeric, 1::numeric, 'system'::text, 'Cross Biz Attack'::text,
            '2026-10-05'::date, $5::uuid, 'business'::text
          )`,
          [BIZ_A, USER_A, walletA, walletB, crypto.randomUUID()]
        );
      },
      /cross_business_transfer_forbidden|wallet_not_found/
    );

    const countAfter = await client1.query(`SELECT count(*)::int as c FROM public.transactions`);
    assert.strictEqual(countAfter.rows[0].c, countBefore.rows[0].c, 'Zero mutations across businesses');
  });
});
