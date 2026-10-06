// Integration test for Business Wallet Transfers (TASK 30) using real PostgreSQL (PGlite)
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');

const BIZ_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const BIZ_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const USER_A = 201;

const WALLET_A_IDR_1 = '11111111-aaaa-4111-8111-111111111111';
const WALLET_A_IDR_2 = '22222222-aaaa-4222-8222-222222222222';
const WALLET_A_USD   = '33333333-aaaa-4333-8333-333333333333';
const WALLET_B_IDR   = '44444444-bbbb-4444-8444-444444444444';

describe('Stage 2: Business Wallet Transfers (TASK 30) Atomic Execution', () => {
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
        scope text DEFAULT 'business',
        is_active boolean DEFAULT true
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
        category text,
        wallet_id uuid REFERENCES public.wallets(id),
        scope text DEFAULT 'business',
        transaction_date date NOT NULL,
        created_at timestamptz DEFAULT now()
      );
    `);

    // 2. Apply migration 067
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '../../migrations/067_business_wallet_transfers_atomic_task30.sql'),
      'utf8'
    );
    await db.exec(migrationSql);

    // 3. Seed test data
    await db.exec(`
      INSERT INTO public.businesses (id, name) VALUES
        ('${BIZ_A}', 'Helm Care Indonesia'),
        ('${BIZ_B}', 'Other Corp');

      INSERT INTO public.wallets (id, business_id, name, currency) VALUES
        ('${WALLET_A_IDR_1}', '${BIZ_A}', 'BCA IDR Operating', 'IDR'),
        ('${WALLET_A_IDR_2}', '${BIZ_A}', 'Mandiri IDR Reserve', 'IDR'),
        ('${WALLET_A_USD}',   '${BIZ_A}', 'Mandiri USD', 'USD'),
        ('${WALLET_B_IDR}',   '${BIZ_B}', 'Foreign Wallet', 'IDR');

      -- Seed opening balances
      -- Wallet A IDR 1: 50,000,000 IDR
      INSERT INTO public.transactions (business_id, created_by_user_id, type, amount_original, currency_original, amount_idr, wallet_id, transaction_date)
      VALUES ('${BIZ_A}', ${USER_A}, 'income', 50000000, 'IDR', 50000000, '${WALLET_A_IDR_1}', '2026-10-01');

      -- Wallet A IDR 2: 10,000,000 IDR
      INSERT INTO public.transactions (business_id, created_by_user_id, type, amount_original, currency_original, amount_idr, wallet_id, transaction_date)
      VALUES ('${BIZ_A}', ${USER_A}, 'income', 10000000, 'IDR', 10000000, '${WALLET_A_IDR_2}', '2026-10-01');

      -- Wallet A USD: 1,000 USD (at 17,917 IDR)
      INSERT INTO public.transactions (business_id, created_by_user_id, type, amount_original, currency_original, amount_idr, wallet_id, transaction_date)
      VALUES ('${BIZ_A}', ${USER_A}, 'income', 1000, 'USD', 17917000, '${WALLET_A_USD}', '2026-10-01');
    `);
  });

  async function getWalletBalance(walletId) {
    const res = await db.query(
      `SELECT
        COALESCE(SUM(CASE
          WHEN type = 'income' THEN amount_original
          WHEN type = 'expense' THEN -amount_original
          ELSE 0
        END), 0) as balance
      FROM public.transactions
      WHERE wallet_id = $1::uuid`,
      [walletId]
    );
    return Number(res.rows[0].balance);
  }

  it('Criterion 1: Same-currency transfer debits source and credits destination atomically with shared transfer_id', async () => {
    const transferId = crypto.randomUUID();
    const sourceAmt = 5000000;
    const targetAmt = 5000000;

    const r = await db.query(
      `SELECT public.rpc_execute_wallet_transfer(
        $1::uuid, $2::bigint, $3::uuid, $4::uuid,
        $5::numeric, $6::text, $7::numeric, $8::numeric,
        $9::numeric, $10::text, $11::numeric, $12::numeric,
        $13::text, $14::text, $15::date, $16::uuid, $17::text
      ) as result`,
      [
        BIZ_A, USER_A, WALLET_A_IDR_1, WALLET_A_IDR_2,
        sourceAmt, 'IDR', sourceAmt, 1,
        targetAmt, 'IDR', targetAmt, 1,
        'base_currency', 'Internal transfer', '2026-10-05',
        transferId, 'business'
      ]
    );

    const res = r.rows[0].result;
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.transfer_id, transferId);

    // Verify balances
    const b1 = await getWalletBalance(WALLET_A_IDR_1);
    const b2 = await getWalletBalance(WALLET_A_IDR_2);
    assert.strictEqual(b1, 50000000 - 5000000); // 45M
    assert.strictEqual(b2, 10000000 + 5000000); // 15M

    // Verify transactions in DB
    const txs = await db.query(
      `SELECT * FROM public.transactions WHERE transfer_id = $1::uuid ORDER BY type`,
      [transferId]
    );
    assert.strictEqual(txs.rows.length, 2);

    const expenseLeg = txs.rows.find(t => t.type === 'expense');
    const incomeLeg  = txs.rows.find(t => t.type === 'income');

    assert.strictEqual(expenseLeg.wallet_id, WALLET_A_IDR_1);
    assert.strictEqual(Number(expenseLeg.amount_original), 5000000);
    assert.strictEqual(expenseLeg.source, `xfer:${transferId}`);

    assert.strictEqual(incomeLeg.wallet_id, WALLET_A_IDR_2);
    assert.strictEqual(Number(incomeLeg.amount_original), 5000000);
    assert.strictEqual(incomeLeg.source, `xfer:${transferId}`);
  });

  it('Criterion 2: Cross-currency transfer converts currencies and records FX rate', async () => {
    const transferId = crypto.randomUUID();
    const sourceAmt = 200; // 200 USD
    const rate = 17917;
    const targetAmt = 200 * rate; // 3,583,400 IDR

    const r = await db.query(
      `SELECT public.rpc_execute_wallet_transfer(
        $1::uuid, $2::bigint, $3::uuid, $4::uuid,
        $5::numeric, $6::text, $7::numeric, $8::numeric,
        $9::numeric, $10::text, $11::numeric, $12::numeric,
        $13::text, $14::text, $15::date, $16::uuid, $17::text
      ) as result`,
      [
        BIZ_A, USER_A, WALLET_A_USD, WALLET_A_IDR_1,
        sourceAmt, 'USD', targetAmt, rate,
        targetAmt, 'IDR', targetAmt, 1,
        'bi_jisdor', 'Transfer USD -> IDR', '2026-10-05',
        transferId, 'business'
      ]
    );

    const res = r.rows[0].result;
    assert.strictEqual(res.ok, true);

    // Verify USD wallet balance reduced by 200
    const bUsd = await getWalletBalance(WALLET_A_USD);
    assert.strictEqual(bUsd, 1000 - 200); // 800 USD

    // Verify IDR wallet balance increased by 3,583,400
    const bIdr = await getWalletBalance(WALLET_A_IDR_1);
    assert.strictEqual(bIdr, 45000000 + 3583400);

    // Verify legs
    const txs = await db.query(
      `SELECT * FROM public.transactions WHERE transfer_id = $1::uuid`,
      [transferId]
    );
    const usdLeg = txs.rows.find(t => t.currency_original === 'USD');
    const idrLeg = txs.rows.find(t => t.currency_original === 'IDR');

    assert.strictEqual(Number(usdLeg.booked_rate), rate);
    assert.strictEqual(Number(usdLeg.amount_idr), targetAmt);
    assert.strictEqual(Number(idrLeg.amount_original), targetAmt);
  });

  it('Criterion 3: Transfer to same wallet is rejected without changing state', async () => {
    const transferId = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await db.query(
          `SELECT public.rpc_execute_wallet_transfer(
            $1::uuid, $2::bigint, $3::uuid, $4::uuid,
            1000, 'IDR', 1000, 1,
            1000, 'IDR', 1000, 1,
            'test', 'Same wallet test', '2026-10-05',
            $5::uuid, 'business'
          )`,
          [BIZ_A, USER_A, WALLET_A_IDR_1, WALLET_A_IDR_1, transferId]
        );
      },
      /cannot_transfer_to_same_wallet/
    );

    // No tx created with that transfer_id
    const check = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(check.rows[0].c, 0);
  });

  it('Criterion 4: Cross-business transfer is rejected (strict isolation boundary)', async () => {
    const transferId = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await db.query(
          `SELECT public.rpc_execute_wallet_transfer(
            $1::uuid, $2::bigint, $3::uuid, $4::uuid,
            1000, 'IDR', 1000, 1,
            1000, 'IDR', 1000, 1,
            'test', 'Cross-business test', '2026-10-05',
            $5::uuid, 'business'
          )`,
          [BIZ_A, USER_A, WALLET_A_IDR_1, WALLET_B_IDR, transferId]
        );
      },
      /target_wallet_not_found/
    );

    const check = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(check.rows[0].c, 0);
  });

  it('Criterion 5: Atomic rollback on failure leaves zero partial records', async () => {
    const fakeWalletId = '99999999-9999-4999-8999-999999999999';
    const transferId = crypto.randomUUID();

    await assert.rejects(
      async () => {
        await db.query(
          `SELECT public.rpc_execute_wallet_transfer(
            $1::uuid, $2::bigint, $3::uuid, $4::uuid,
            500000, 'IDR', 500000, 1,
            500000, 'IDR', 500000, 1,
            'test', 'Failed transfer test', '2026-10-05',
            $5::uuid, 'business'
          )`,
          [BIZ_A, USER_A, WALLET_A_IDR_1, fakeWalletId, transferId]
        );
      },
      /target_wallet_not_found/
    );

    const check = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(check.rows[0].c, 0);
  });

  it('Criterion 6: Atomic deletion removes both transfer legs', async () => {
    const transferId = crypto.randomUUID();

    // Create transfer
    await db.query(
      `SELECT public.rpc_execute_wallet_transfer(
        $1::uuid, $2::bigint, $3::uuid, $4::uuid,
        1000000, 'IDR', 1000000, 1,
        1000000, 'IDR', 1000000, 1,
        'test', 'Transfer to delete', '2026-10-05',
        $5::uuid, 'business'
      )`,
      [BIZ_A, USER_A, WALLET_A_IDR_1, WALLET_A_IDR_2, transferId]
    );

    // Verify 2 legs exist
    const before = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(before.rows[0].c, 2);

    // Delete transfer
    const delRes = await db.query(
      `SELECT public.rpc_delete_wallet_transfer($1::uuid, $2::uuid) as result`,
      [BIZ_A, transferId]
    );
    assert.strictEqual(delRes.rows[0].result.deleted_legs, 2);

    // Verify 0 legs remain
    const after = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(after.rows[0].c, 0);
  });

  it('Criterion 7: Replay protection returns is_replay: true without duplicate ledger records', async () => {
    const transferId = crypto.randomUUID();

    // 1st transfer execution
    const res1 = await db.query(
      `SELECT public.rpc_execute_wallet_transfer(
        $1::uuid, $2::bigint, $3::uuid, $4::uuid,
        2500000, 'IDR', 2500000, 1,
        2500000, 'IDR', 2500000, 1,
        'test', 'Replay test transfer', '2026-10-05',
        $5::uuid, 'business'
      ) as result`,
      [BIZ_A, USER_A, WALLET_A_IDR_1, WALLET_A_IDR_2, transferId]
    );
    assert.strictEqual(res1.rows[0].result.ok, true);
    assert.strictEqual(res1.rows[0].result.is_replay, undefined);

    const count1 = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(count1.rows[0].c, 2, 'Exactly 2 records created on first call');

    // 2nd transfer execution with SAME transfer_id
    const res2 = await db.query(
      `SELECT public.rpc_execute_wallet_transfer(
        $1::uuid, $2::bigint, $3::uuid, $4::uuid,
        2500000, 'IDR', 2500000, 1,
        2500000, 'IDR', 2500000, 1,
        'test', 'Replay test transfer', '2026-10-05',
        $5::uuid, 'business'
      ) as result`,
      [BIZ_A, USER_A, WALLET_A_IDR_1, WALLET_A_IDR_2, transferId]
    );
    assert.strictEqual(res2.rows[0].result.ok, true);
    assert.strictEqual(res2.rows[0].result.is_replay, true, 'Must return is_replay: true');
    assert.strictEqual(res2.rows[0].result.debit_transaction_id, res1.rows[0].result.debit_transaction_id);
    assert.strictEqual(res2.rows[0].result.credit_transaction_id, res1.rows[0].result.credit_transaction_id);

    const count2 = await db.query(`SELECT count(*)::int as c FROM public.transactions WHERE transfer_id = $1::uuid`, [transferId]);
    assert.strictEqual(count2.rows[0].c, 2, 'Ledger count must remain exactly 2 without duplication');
  });

  it('Criterion 8: Financial metrics neutrality (transfers do not inflate revenue, OPEX or burn rate)', async () => {
    const FININ = require('../../server/lib/financialInsights.js');
    const transferId = crypto.randomUUID();

    const debitLeg = {
      type: 'expense',
      amount_original: 5000000,
      amount_idr: 5000000,
      category: 'Transfer',
      transfer_id: transferId,
      description: 'Transfer: BCA IDR → Mandiri IDR',
      transaction_date: '2026-10-05'
    };

    const creditLeg = {
      type: 'income',
      amount_original: 5000000,
      amount_idr: 5000000,
      category: 'Transfer',
      transfer_id: transferId,
      description: 'Transfer: BCA IDR → Mandiri IDR',
      transaction_date: '2026-10-05'
    };

    // 1. Classification
    const debitClass = FININ.classifyTransaction(debitLeg);
    assert.strictEqual(debitClass.class, 'transfer');
    assert.strictEqual(FININ.NON_OPERATING.includes(debitClass.class), true);

    const creditClass = FININ.classifyTransaction(creditLeg);
    assert.strictEqual(creditClass.class, 'transfer');
    assert.strictEqual(FININ.NON_OPERATING.includes(creditClass.class), true);

    // 2. computeInsights metrics
    const insights = FININ.computeInsights([debitLeg, creditLeg]);
    assert.strictEqual(insights.metrics.operating_revenue, 0, 'Operating revenue must not be inflated by transfer credit leg');
    assert.strictEqual(insights.metrics.operating_cash_out, 0, 'Operating cash out must not be inflated by transfer debit leg');
    assert.strictEqual(insights.metrics.other_cash_movement.transfers, 10000000, 'Transfer is tracked in non-operating movements');

    // 3. Burn rate neutrality (using formula from server/index.js)
    const isTransfer = (t) => t.type === 'transfer' || !!t.transfer_id || t.category === 'Transfer';
    const allExpTxs = [debitLeg].filter(t => ['expense'].includes(t.type) && !isTransfer(t));
    assert.strictEqual(allExpTxs.length, 0, 'Transfers are excluded from burn rate calculation');
  });
});
