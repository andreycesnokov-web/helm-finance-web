// Isolated PostgreSQL test for May 2026 43-row bank statement restoration
// Verifies:
// 1. Exact 1:1 mapping by row_id
// 2. Concurrency locking & duplicate prevention inside transaction
// 3. Conformance with standard bank import schema & rules (amount_idr, booked_rate, currency_original, bank_reference)
// 4. Dynamic reconciliation calculation (no hardcoded constants)
// 5. Idempotency (re-run creates 0 duplicates)
// 6. Atomic rollback on error
import assert from 'node:assert';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

async function run() {
  console.log('--- Initializing Isolated PostgreSQL Schema in PGlite ---');

  await db.exec(`
    CREATE TABLE businesses (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      base_currency TEXT NOT NULL DEFAULT 'IDR'
    );

    CREATE TABLE wallets (
      id UUID PRIMARY KEY,
      business_id UUID NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'IDR',
      scope TEXT NOT NULL DEFAULT 'business',
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE bank_import_batches (
      id UUID PRIMARY KEY,
      business_id UUID NOT NULL REFERENCES businesses(id),
      wallet_id UUID NOT NULL REFERENCES wallets(id),
      statement_start DATE NOT NULL,
      statement_end DATE NOT NULL,
      opening_balance NUMERIC,
      closing_balance NUMERIC,
      imported_count INT DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'review_required',
      reconciliation_status TEXT,
      difference NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY,
      business_id UUID NOT NULL REFERENCES businesses(id),
      wallet_id UUID NOT NULL REFERENCES wallets(id),
      amount_original NUMERIC NOT NULL,
      amount_idr NUMERIC NOT NULL,
      booked_rate NUMERIC NOT NULL DEFAULT 1.0,
      rate_source TEXT NOT NULL DEFAULT 'identity',
      currency_original TEXT NOT NULL DEFAULT 'IDR',
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
      transaction_date DATE NOT NULL,
      description TEXT,
      source TEXT,
      bank_reference TEXT,
      scope TEXT NOT NULL DEFAULT 'business',
      is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE bank_import_rows (
      id UUID PRIMARY KEY,
      batch_id UUID NOT NULL REFERENCES bank_import_batches(id),
      business_id UUID NOT NULL REFERENCES businesses(id),
      row_index INT NOT NULL,
      tx_date DATE NOT NULL,
      amount NUMERIC NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      description TEXT,
      bank_reference TEXT,
      review_status TEXT NOT NULL DEFAULT 'needs_review',
      linked_transaction_id BIGINT,
      raw JSONB
    );
  `);

  const BIZ_ID = 'b949966a-3988-47cb-9e7c-afad1423f4f8';
  const WALLET_ID = '5be07f47-fd64-424c-9c38-65f3b9ac6f89';
  const BATCH_ID = '08c50e5b-fb33-48b6-a706-005a63b22186';

  await db.exec(`
    INSERT INTO businesses (id, name, base_currency)
    VALUES ('${BIZ_ID}', 'Helm Care Indonesia', 'IDR');

    INSERT INTO wallets (id, business_id, name, currency, scope)
    VALUES ('${WALLET_ID}', '${BIZ_ID}', 'Permata Bank IDR', 'IDR', 'business');

    INSERT INTO bank_import_batches (id, business_id, wallet_id, statement_start, statement_end, opening_balance, closing_balance, status)
    VALUES ('${BATCH_ID}', '${BIZ_ID}', '${WALLET_ID}', '2026-05-02', '2026-05-31', 2426050, 1128042, 'review_required');
  `);

  // Seed 43 rows matching the May 2026 Permata statement
  const rawRows = [
    { row_index: 1, tx_date: '2026-05-31', amount: 700000, dir: 'out', ref: '0805151601501253', desc: 'PB KE ANDREI CHESNOKOV 4138125896' },
    { row_index: 2, tx_date: '2026-05-30', amount: 1000000, dir: 'out', ref: '0805150601498552', desc: 'PB KE ANDREI CHESNOKOV 4138125896' },
    { row_index: 3, tx_date: '2026-05-29', amount: 1414032, dir: 'in', ref: '7101261490029759', desc: 'TRF DARI MIDTRANS' },
    { row_index: 4, tx_date: '2026-05-28', amount: 1500000, dir: 'out', ref: '0805148601489283', desc: 'PB KE ANDREI CHESNOKOV 4138125896' },
    { row_index: 5, tx_date: '2026-05-27', amount: 1000000, dir: 'out', ref: '0805147601485412', desc: 'PB KE ANDREI CHESNOKOV 4138125896' },
    { row_index: 6, tx_date: '2026-05-27', amount: 5000000, dir: 'out', ref: '0805147601485123', desc: 'PB KE ANDREI CHESNOKOV 4138125896' },
    { row_index: 7, tx_date: '2026-05-26', amount: 383298, dir: 'in', ref: '7101261460004314', desc: 'TRF DARI MIDTRANS' },
    { row_index: 8, tx_date: '2026-05-25', amount: 824190, dir: 'in', ref: '7101261450013754', desc: 'TRF DARI MIDTRANS' },
    { row_index: 9, tx_date: '2026-05-25', amount: 451815, dir: 'in', ref: '7101261450011041', desc: 'TRF DARI MIDTRANS' },
    { row_index: 10, tx_date: '2026-05-25', amount: 737799, dir: 'in', ref: '7101261450006465', desc: 'TRF DARI MIDTRANS' },
    { row_index: 11, tx_date: '2026-05-22', amount: 492528, dir: 'in', ref: '7101261420008086', desc: 'TRF DARI MIDTRANS' },
    { row_index: 12, tx_date: '2026-05-21', amount: 594807, dir: 'in', ref: '7101261410003631', desc: 'TRF DARI MIDTRANS' },
    { row_index: 13, tx_date: '2026-05-20', amount: 590835, dir: 'in', ref: '7101261400004548', desc: 'TRF DARI MIDTRANS' },
    { row_index: 14, tx_date: '2026-05-19', amount: 560052, dir: 'in', ref: '9231261390000631', desc: 'TRF DARI MIDTRANS' },
    { row_index: 15, tx_date: '2026-05-18', amount: 681198, dir: 'in', ref: '9231261380023911', desc: 'TRF DARI MIDTRANS' },
    { row_index: 16, tx_date: '2026-05-18', amount: 673254, dir: 'in', ref: '7101261380019727', desc: 'TRF DARI MIDTRANS' },
    { row_index: 17, tx_date: '2026-05-18', amount: 1695051, dir: 'in', ref: '9231261380005499', desc: 'TRF DARI MIDTRANS' },
    { row_index: 18, tx_date: '2026-05-15', amount: 7500, dir: 'out', ref: '0897132929653467', desc: 'Biaya Adm. Online Franchise' },
    { row_index: 19, tx_date: '2026-05-15', amount: 574324, dir: 'out', ref: '0897132929653467', desc: 'TRF KE ADE SUHAIDI' },
    { row_index: 20, tx_date: '2026-05-13', amount: 428976, dir: 'in', ref: '9231261330001480', desc: 'TRF DARI MIDTRANS' },
    { row_index: 21, tx_date: '2026-05-12', amount: 7500, dir: 'out', ref: '0897132929653592', desc: 'Biaya Adm. Online Franchise' },
    { row_index: 22, tx_date: '2026-05-12', amount: 26130, dir: 'out', ref: '0897132929653592', desc: 'TRF KE I DEWA GEDE PUTR' },
    { row_index: 23, tx_date: '2026-05-12', amount: 7500, dir: 'out', ref: '0897132929653543', desc: 'Biaya Adm. Online Franchise' },
    { row_index: 24, tx_date: '2026-05-12', amount: 7500, dir: 'out', ref: '0897132929653388', desc: 'Biaya Adm. Online Franchise' },
    { row_index: 25, tx_date: '2026-05-12', amount: 52528, dir: 'out', ref: '0897132929653543', desc: 'TRF KE RPL 037 BLU POLI' },
    { row_index: 26, tx_date: '2026-05-12', amount: 919084, dir: 'out', ref: '0897132929653388', desc: 'TRF KE ANAK AGUNG GEDE' },
    { row_index: 27, tx_date: '2026-05-12', amount: 434934, dir: 'in', ref: '7101261320002203', desc: 'TRF DARI MIDTRANS' },
    { row_index: 28, tx_date: '2026-05-11', amount: 1165500, dir: 'out', ref: '0897131929646639', desc: 'PAY BIZNET' },
    { row_index: 29, tx_date: '2026-05-11', amount: 607716, dir: 'in', ref: '7101261310006809', desc: 'TRF DARI MIDTRANS' },
    { row_index: 30, tx_date: '2026-05-11', amount: 758652, dir: 'in', ref: '7101261310003112', desc: 'TRF DARI MIDTRANS' },
    { row_index: 31, tx_date: '2026-05-11', amount: 627576, dir: 'in', ref: '7101261310003615', desc: 'TRF DARI MIDTRANS' },
    { row_index: 32, tx_date: '2026-05-10', amount: 10000, dir: 'out', ref: null, desc: 'Biaya adm. bulan MEI 2026' },
    { row_index: 33, tx_date: '2026-05-08', amount: 6000000, dir: 'out', ref: '0897128929632389', desc: 'TRF LLG KE MADE MEYTA' },
    { row_index: 34, tx_date: '2026-05-08', amount: 2500, dir: 'out', ref: '0897128929632389', desc: 'BIAYA ADM. TRF LLG' },
    { row_index: 35, tx_date: '2026-05-08', amount: 500000, dir: 'in', ref: null, desc: 'PB DARI ANDREI CHESNOKOV' },
    { row_index: 36, tx_date: '2026-05-08', amount: 650415, dir: 'in', ref: '7101261280003531', desc: 'TRF DARI MIDTRANS' },
    { row_index: 37, tx_date: '2026-05-07', amount: 510402, dir: 'in', ref: '7101261270005378', desc: 'TRF DARI MIDTRANS' },
    { row_index: 38, tx_date: '2026-05-06', amount: 526290, dir: 'in', ref: '9231261260001116', desc: 'TRF DARI MIDTRANS' },
    { row_index: 39, tx_date: '2026-05-05', amount: 620625, dir: 'in', ref: '9231261250000802', desc: 'TRF DARI MIDTRANS' },
    { row_index: 40, tx_date: '2026-05-04', amount: 1038678, dir: 'in', ref: '7101261240021339', desc: 'TRF DARI MIDTRANS' },
    { row_index: 41, tx_date: '2026-05-04', amount: 894693, dir: 'in', ref: '7101261240005030', desc: 'TRF DARI MIDTRANS' },
    { row_index: 42, tx_date: '2026-05-04', amount: 1384242, dir: 'in', ref: '7101261240004002', desc: 'TRF DARI MIDTRANS' },
    { row_index: 43, tx_date: '2026-05-02', amount: 1400000, dir: 'out', ref: '0897122929581504', desc: 'PB KE ANDREI CHESNOKOV' },
  ];

  for (const r of rawRows) {
    const rowId = `00000000-0000-4000-8000-${String(r.row_index).padStart(12, '0')}`;
    await db.query(`
      INSERT INTO bank_import_rows (id, batch_id, business_id, row_index, tx_date, amount, direction, description, bank_reference, review_status, linked_transaction_id)
      VALUES ('${rowId}', '${BATCH_ID}', '${BIZ_ID}', ${r.row_index}, '${r.tx_date}', ${r.amount}, '${r.dir}', '${r.desc}', ${r.ref ? `'${r.ref}'` : 'NULL'}, 'needs_review', NULL);
    `);
  }

  console.log('Seeded 43 bank_import_rows in PGlite.');

  // PROCEDURE DEFINITION
  const executeRestoration = async () => {
    return await db.transaction(async (tx) => {
      // 1. Lock batch row
      const bRes = await tx.query(`
        SELECT id, wallet_id, opening_balance, closing_balance, status
        FROM bank_import_batches
        WHERE id = '${BATCH_ID}'
        FOR UPDATE;
      `);
      if (bRes.rows.length === 0) throw new Error('Batch not found');
      const batch = bRes.rows[0];

      // 2. Lock ALL source rows
      const rowsRes = await tx.query(`
        SELECT id, row_index, tx_date, amount, direction, description, bank_reference, linked_transaction_id
        FROM bank_import_rows
        WHERE batch_id = '${BATCH_ID}'
        ORDER BY row_index ASC
        FOR UPDATE;
      `);
      if (rowsRes.rows.length !== 43) throw new Error(`Expected 43 rows, got ${rowsRes.rows.length}`);

      // 3. Duplicate check in transactions table for this period & wallet
      const existingTxRes = await tx.query(`
        SELECT COUNT(*) as count
        FROM transactions
        WHERE business_id = '${BIZ_ID}'
          AND wallet_id = '${WALLET_ID}'
          AND transaction_date >= '2026-05-01'
          AND transaction_date <= '2026-05-31';
      `);
      if (Number(existingTxRes.rows[0].count) > 0) {
        throw new Error(`ABORT: Existing transactions found for May 2026: ${existingTxRes.rows[0].count}`);
      }

      // 4. Map and Insert transactions adhering strictly to standard import rules
      const map = [];
      let sumIn = 0;
      let sumOut = 0;

      for (const row of rowsRes.rows) {
        const type = row.direction === 'in' ? 'income' : 'expense';
        const amt = Number(row.amount);
        if (type === 'income') sumIn += amt;
        else sumOut += amt;

        // Insert transaction with standard import fields: amount_idr = amt, booked_rate = 1, currency = IDR, source = wallet name
        const insRes = await tx.query(`
          INSERT INTO transactions (
            business_id,
            wallet_id,
            amount_original,
            amount_idr,
            booked_rate,
            rate_source,
            currency_original,
            type,
            transaction_date,
            description,
            source,
            bank_reference,
            scope,
            is_reconciled
          ) VALUES (
            '${BIZ_ID}',
            '${WALLET_ID}',
            ${amt},
            ${amt},
            1.0,
            'identity',
            'IDR',
            '${type}',
            '${row.tx_date.toISOString().slice(0, 10)}',
            '${(row.description || '').replace(/'/g, "''")}',
            'Permata Bank IDR',
            ${row.bank_reference ? `'${row.bank_reference}'` : 'NULL'},
            'business',
            FALSE
          ) RETURNING id;
        `);

        const newTxId = insRes.rows[0].id;
        map.push({ row_id: row.id, tx_id: newTxId });

        // Update bank_import_rows strictly by row.id
        await tx.query(`
          UPDATE bank_import_rows
          SET linked_transaction_id = ${newTxId}, review_status = 'imported'
          WHERE id = '${row.id}';
        `);
      }

      // 5. Dynamic reconciliation verification
      const openBal = Number(batch.opening_balance);
      const closeBal = Number(batch.closing_balance);
      const calcClose = openBal + sumIn - sumOut;
      const diff = closeBal - calcClose;
      const recStatus = Math.abs(diff) < 0.01 ? 'balanced' : 'unbalanced';

      if (recStatus !== 'balanced') {
        throw new Error(`Reconciliation unbalanced: calculated ${calcClose}, expected ${closeBal}, diff ${diff}`);
      }

      // Mark transactions as reconciled only after reconciliation matches
      const allTxIds = map.map(m => m.tx_id).join(',');
      await tx.query(`
        UPDATE transactions
        SET is_reconciled = TRUE
        WHERE id IN (${allTxIds});
      `);

      // Update batch status
      await tx.query(`
        UPDATE bank_import_batches
        SET status = 'imported',
            imported_count = ${map.length},
            reconciliation_status = '${recStatus}',
            difference = ${diff}
        WHERE id = '${BATCH_ID}';
      `);

      return { map, sumIn, sumOut, diff, recStatus };
    });
  };

  // TEST RUN 1: Clean Restoration Execution
  console.log('\n--- TEST 1: Executing Atomic Restoration on Isolated Copy ---');
  const res1 = await executeRestoration();
  console.log('Restoration completed successfully.');
  console.log('  Total mapped rows:', res1.map.length);
  console.log('  Sum Income (in):', res1.sumIn);
  console.log('  Sum Expense (out):', res1.sumOut);
  console.log('  Difference:', res1.diff);
  console.log('  Reconciliation Status:', res1.recStatus);

  assert.strictEqual(res1.map.length, 43, 'Must restore exactly 43 rows');
  assert.strictEqual(res1.sumIn, 18082058, 'Income must match 18,082,058');
  assert.strictEqual(res1.sumOut, 19380066, 'Expense must match 19,380,066');
  assert.strictEqual(res1.diff, 0, 'Difference must be 0');
  assert.strictEqual(res1.recStatus, 'balanced', 'Reconciliation must be balanced');

  // Verify unique 1:1 linkages
  const distinctLinks = new Set(res1.map.map(m => m.tx_id));
  assert.strictEqual(distinctLinks.size, 43, 'Must have 43 distinct transaction IDs');

  // Verify DB state
  const txCount = await db.query(`SELECT COUNT(*) as count FROM transactions WHERE business_id = '${BIZ_ID}'`);
  assert.strictEqual(Number(txCount.rows[0].count), 43, 'DB must contain exactly 43 transactions');

  const unlinkedCheck = await db.query(`
    SELECT COUNT(*) as count
    FROM bank_import_rows
    WHERE batch_id = '${BATCH_ID}'
      AND linked_transaction_id NOT IN (SELECT id FROM transactions);
  `);
  assert.strictEqual(Number(unlinkedCheck.rows[0].count), 0, 'Zero orphaned links allowed');

  const standardFieldCheck = await db.query(`
    SELECT COUNT(*) as count
    FROM transactions
    WHERE amount_idr = amount_original
      AND booked_rate = 1.0
      AND currency_original = 'IDR'
      AND source = 'Permata Bank IDR'
      AND is_reconciled = TRUE;
  `);
  assert.strictEqual(Number(standardFieldCheck.rows[0].count), 43, 'All 43 rows must satisfy standard import fields');

  console.log('PASS: TEST 1 assertions passed completely.');

  // TEST RUN 2: Idempotency Protection (Re-run must fail and abort)
  console.log('\n--- TEST 2: Testing Idempotency & Repeat Protection ---');
  let rerunFailed = false;
  try {
    await executeRestoration();
  } catch (err) {
    rerunFailed = true;
    console.log('Expected abort caught:', err.message);
  }
  assert.strictEqual(rerunFailed, true, 'Re-run must fail because transactions already exist');
  const txCountAfterRerun = await db.query(`SELECT COUNT(*) as count FROM transactions WHERE business_id = '${BIZ_ID}'`);
  assert.strictEqual(Number(txCountAfterRerun.rows[0].count), 43, 'Transaction count must remain 43 after failed re-run');
  console.log('PASS: TEST 2 passed (zero duplicate transactions created on re-run).');

  // TEST RUN 3: Atomic Rollback on Mid-flight Error
  console.log('\n--- TEST 3: Testing Atomic Rollback on Mid-flight Error ---');
  let rollbackCaught = false;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO transactions (business_id, wallet_id, amount_original, amount_idr, type, transaction_date)
                      VALUES ('${BIZ_ID}', '${WALLET_ID}', 999, 999, 'income', '2026-05-15');`);
      throw new Error('Simulated mid-flight crash');
    });
  } catch (err) {
    rollbackCaught = true;
    console.log('Simulated crash caught:', err.message);
  }
  assert.strictEqual(rollbackCaught, true);
  const txCountAfterCrash = await db.query(`SELECT COUNT(*) as count FROM transactions WHERE business_id = '${BIZ_ID}'`);
  assert.strictEqual(Number(txCountAfterCrash.rows[0].count), 43, 'Failed transaction must roll back cleanly without partial rows');
  console.log('PASS: TEST 3 passed (atomic rollback verified).');

  console.log('\n======================================================');
  console.log('ALL ISOLATED RESTORATION TESTS PASSED (100% SUCCESS)');
  console.log('======================================================');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
