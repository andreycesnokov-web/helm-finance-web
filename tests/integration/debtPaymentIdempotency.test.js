// Integration test for Debt Payment Idempotency and Atomic Execution using real PostgreSQL (PGlite)
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 101;
const USER_B = 102;
const WALLET_A_IDR = '33333333-3333-4333-8333-333333333333';
const WALLET_A_USD = '44444444-4444-4444-8444-444444444444';
const WALLET_B_IDR = '55555555-5555-4555-8555-555555555555';

describe('Stage 1: Debt Payment Idempotency and Atomic Execution (PostgreSQL)', () => {
  let db;

  before(async () => {
    db = new PGlite();

    // 1. Create base schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.businesses (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public.wallets (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id),
        name text NOT NULL,
        currency text NOT NULL DEFAULT 'IDR',
        scope text DEFAULT 'business'
      );

      CREATE TABLE IF NOT EXISTS public.transactions (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id),
        created_by_user_id bigint,
        type text NOT NULL,
        amount_original numeric NOT NULL,
        currency_original text NOT NULL,
        amount_idr numeric,
        booked_rate numeric,
        rate_source text,
        description text,
        source text,
        wallet_id uuid REFERENCES public.wallets(id),
        scope text DEFAULT 'business',
        transaction_date date NOT NULL,
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.debts (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id),
        type text NOT NULL,
        counterparty text NOT NULL,
        amount numeric NOT NULL,
        original_amount numeric NOT NULL,
        paid_amount numeric DEFAULT 0,
        currency text NOT NULL DEFAULT 'IDR',
        status text NOT NULL DEFAULT 'open',
        is_settled boolean DEFAULT false,
        settled_at timestamptz,
        last_payment_at timestamptz,
        linked_transaction_id bigint,
        scope text DEFAULT 'business'
      );
    `);

    // 2. Apply migration 066
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '../../migrations/066_debt_payment_idempotency_and_atomic_rpc.sql'),
      'utf8'
    );
    await db.exec(migrationSql);

    // 3. Seed businesses and wallets
    await db.exec(`
      INSERT INTO public.businesses (id, name) VALUES
        ('${BIZ_A}', 'Business A'),
        ('${BIZ_B}', 'Business B');

      INSERT INTO public.wallets (id, business_id, name, currency) VALUES
        ('${WALLET_A_IDR}', '${BIZ_A}', 'BCA IDR A', 'IDR'),
        ('${WALLET_A_USD}', '${BIZ_A}', 'BCA USD A', 'USD'),
        ('${WALLET_B_IDR}', '${BIZ_B}', 'BCA IDR B', 'IDR');
    `);
  });

  // Helper to call RPC
  async function callRpc({
    bizId = BIZ_A,
    userId = USER_A,
    debtId,
    walletId = WALLET_A_IDR,
    amount,
    currency = 'IDR',
    amountIdr = null,
    bookedRate = 1,
    rateSource = 'test',
    paymentDate = '2026-10-05',
    key,
    requestHash = null,
  }) {
    const hash = requestHash || crypto.createHash('sha256').update(JSON.stringify({
      debt_id: debtId,
      amount,
      wallet_id: walletId,
      currency,
      date: paymentDate,
    })).digest('hex');

    const res = await db.query(
      `SELECT public.rpc_record_debt_payment(
        $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::numeric,
        $6::text, $7::numeric, $8::numeric, $9::text, $10::date,
        $11::text, $12::text
      ) as result`,
      [
        bizId, userId, debtId, walletId, amount,
        currency, amountIdr || amount, bookedRate, rateSource, paymentDate,
        key || null, hash
      ]
    );
    return res.rows[0].result;
  }

  it('Criterion 1: Replay with same key creates exactly ONE transaction and returns cached result', async () => {
    // Seed 10M debt
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'Vendor Alpha', 10000000, 10000000, 'IDR')
      RETURNING id;
    `);
    const debtId = dRes.rows[0].id;

    const key = 'idemp_key_001';
    const r1 = await callRpc({ debtId, amount: 4000000, key });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.is_replay, false);
    assert.strictEqual(r1.data.paid_amount, 4000000);
    assert.strictEqual(r1.data.remaining, 6000000);

    // Replay with identical key and params
    const r2 = await callRpc({ debtId, amount: 4000000, key });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.is_replay, true);
    assert.strictEqual(r2.data.paid_amount, 4000000);
    assert.strictEqual(r2.data.remaining, 6000000);

    // Verify transactions count in database is exactly 1
    const txCount = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE description LIKE '%Vendor Alpha%'`);
    assert.strictEqual(txCount.rows[0].c, 1, 'Only one transaction should exist');

    // Verify debt state
    const debtCheck = await db.query(`SELECT paid_amount, status FROM public.debts WHERE id = ${debtId}`);
    assert.strictEqual(Number(debtCheck.rows[0].paid_amount), 4000000);
    assert.strictEqual(debtCheck.rows[0].status, 'partial');
  });

  it('Criterion 2: Two intentional payments with different keys succeed up to remaining amount', async () => {
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'Vendor Beta', 10000000, 10000000, 'IDR')
      RETURNING id;
    `);
    const debtId = dRes.rows[0].id;

    // First intentional payment: 4M
    const r1 = await callRpc({ debtId, amount: 4000000, key: 'key_intent_1' });
    assert.strictEqual(r1.data.paid_amount, 4000000);
    assert.strictEqual(r1.data.remaining, 6000000);

    // Second intentional payment: 4M
    const r2 = await callRpc({ debtId, amount: 4000000, key: 'key_intent_2' });
    assert.strictEqual(r2.data.paid_amount, 8000000);
    assert.strictEqual(r2.data.remaining, 2000000);

    // Transactions count = 2
    const txCount = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE description LIKE '%Vendor Beta%'`);
    assert.strictEqual(txCount.rows[0].c, 2);

    const debtCheck = await db.query(`SELECT paid_amount, status, is_settled FROM public.debts WHERE id = ${debtId}`);
    assert.strictEqual(Number(debtCheck.rows[0].paid_amount), 8000000);
    assert.strictEqual(debtCheck.rows[0].status, 'partial');
    assert.strictEqual(debtCheck.rows[0].is_settled, false);
  });

  it('Criterion 3: Concurrent/sequential overpayment (6M + 6M on 10M debt) rejects second request without auto-reduction', async () => {
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'Vendor Gamma', 10000000, 10000000, 'IDR')
      RETURNING id;
    `);
    const debtId = dRes.rows[0].id;

    // First payment: 6M
    const r1 = await callRpc({ debtId, amount: 6000000, key: 'key_gamma_1' });
    assert.strictEqual(r1.data.paid_amount, 6000000);
    assert.strictEqual(r1.data.remaining, 4000000);

    // Second payment: 6M (exceeds remaining 4M)
    await assert.rejects(
      async () => {
        await callRpc({ debtId, amount: 6000000, key: 'key_gamma_2' });
      },
      /payment_exceeds_remaining/
    );

    // Verify debt remaining is still 4M, paid is 6M (not mutated, not reduced)
    const debtCheck = await db.query(`SELECT paid_amount, status FROM public.debts WHERE id = ${debtId}`);
    assert.strictEqual(Number(debtCheck.rows[0].paid_amount), 6000000);
    assert.strictEqual(debtCheck.rows[0].status, 'partial');

    // Only 1 transaction recorded
    const txCount = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE description LIKE '%Vendor Gamma%'`);
    assert.strictEqual(txCount.rows[0].c, 1);
  });

  it('Criterion 4: Same key with changed payload is rejected with idempotency_key_mismatch', async () => {
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'Vendor Delta', 10000000, 10000000, 'IDR')
      RETURNING id;
    `);
    const debtId = dRes.rows[0].id;

    const key = 'reused_key_delta';
    // First: 4M
    await callRpc({ debtId, amount: 4000000, key });

    // Reusing same key with 5M amount -> must be rejected
    await assert.rejects(
      async () => {
        await callRpc({
          debtId,
          amount: 5000000,
          key,
          requestHash: 'different_hash_value_123',
        });
      },
      /idempotency_key_mismatch/
    );
  });

  it('Criterion 5: Atomic rollback on error leaves zero partial records', async () => {
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'Vendor Epsilon', 10000000, 10000000, 'IDR')
      RETURNING id;
    `);
    const debtId = dRes.rows[0].id;

    const txsBefore = await db.query(`SELECT count(*)::int as c FROM public.transactions`);
    const idempBefore = await db.query(`SELECT count(*)::int as c FROM public.debt_payment_idempotency`);

    // Attempt payment with invalid wallet (triggering error)
    await assert.rejects(
      async () => {
        await callRpc({
          debtId,
          amount: 4000000,
          walletId: '99999999-9999-4999-8999-999999999999', // non-existent
          key: 'fail_key_001',
        });
      },
      /wallet_not_found/
    );

    const txsAfter = await db.query(`SELECT count(*)::int as c FROM public.transactions`);
    const idempAfter = await db.query(`SELECT count(*)::int as c FROM public.debt_payment_idempotency`);

    assert.strictEqual(txsAfter.rows[0].c, txsBefore.rows[0].c, 'No transaction should be created on error');
    assert.strictEqual(idempAfter.rows[0].c, idempBefore.rows[0].c, 'No idempotency row should be created on error');

    const debtCheck = await db.query(`SELECT paid_amount FROM public.debts WHERE id = ${debtId}`);
    assert.strictEqual(Number(debtCheck.rows[0].paid_amount), 0, 'Debt paid_amount must remain 0');
  });

  it('Criterion 6: Cross-business isolation - cannot pay foreign debt or use foreign wallet', async () => {
    // Debt belongs to Business B
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_B}', 'payable', 'Foreign Vendor', 5000000, 5000000, 'IDR')
      RETURNING id;
    `);
    const foreignDebtId = dRes.rows[0].id;

    // User acting for Business A tries to pay Business B's debt
    await assert.rejects(
      async () => {
        await callRpc({
          bizId: BIZ_A,
          debtId: foreignDebtId,
          amount: 2000000,
          key: 'attack_key_1',
        });
      },
      /debt_not_found/
    );

    // Business A tries to pay its own debt using Business B's wallet
    const ownDebtRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'Own Vendor', 5000000, 5000000, 'IDR')
      RETURNING id;
    `);
    const ownDebtId = ownDebtRes.rows[0].id;

    await assert.rejects(
      async () => {
        await callRpc({
          bizId: BIZ_A,
          debtId: ownDebtId,
          walletId: WALLET_B_IDR, // foreign wallet
          amount: 2000000,
          key: 'attack_key_2',
        });
      },
      /wallet_not_found/
    );
  });

  it('Criterion 7: Currency mismatch checks are preserved and enforced', async () => {
    // Debt is USD
    const dRes = await db.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency)
      VALUES ('${BIZ_A}', 'payable', 'USD Vendor', 1000, 1000, 'USD')
      RETURNING id;
    `);
    const usdDebtId = dRes.rows[0].id;

    // Trying to pay USD debt with IDR wallet
    await assert.rejects(
      async () => {
        await callRpc({
          debtId: usdDebtId,
          walletId: WALLET_A_IDR,
          amount: 500,
          currency: 'USD',
          key: 'curr_mismatch_1',
        });
      },
      /wallet_currency_mismatch/
    );

    // Successful payment using USD wallet
    const r = await callRpc({
      debtId: usdDebtId,
      walletId: WALLET_A_USD,
      amount: 500,
      currency: 'USD',
      amountIdr: 500 * 17917,
      bookedRate: 17917,
      rateSource: 'bi_jisdor',
      key: 'usd_pay_success',
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.paid_amount, 500);
    assert.strictEqual(r.data.remaining, 500);
  });
});
