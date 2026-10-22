'use strict';
// Real Express/JWT and native PostgreSQL through the existing SQL adapter. Not an
// external Auth/PostgREST acceptance test or a production restore. New DB per run.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./_d4Harness');

describe('Real PostgreSQL: bank reconciliation and transaction linking HTTP flow', () => {
  const OWNER = 9001, OTHER = 9999;
  let db, admin, app, seed, biz, otherBiz, wallet, otherWallet, wrongWallet;
  let doc, income, payment, expense, foreignTx, wrongWalletTx, completed;
  let closeReadiness, packageExportData, skipped = false;
  const call = (p, opts = {}) => app.call(p, { user: OWNER, biz, ...opts });
  const count = async (sql, args = []) => Number((await admin.query(sql, args)).rows[0].n);
  const txCount = () => count('SELECT count(*) n FROM public.transactions WHERE business_id=$1', [biz]);
  const rows = [
    { tx_date: '2026-09-05', amount: 20000000, direction: 'in', description: 'Client Retainer Payment' },
    { tx_date: '2026-09-15', amount: 5000000, direction: 'out', description: 'Vendor invoice payment' },
    { tx_date: '2026-09-20', amount: 3000000, direction: 'out', description: 'Office Supplies' },
  ];
  async function upload(lines = rows, name = 'synthetic-bca-sept.csv') {
    const r = await call('/bank-import/batches', { method: 'POST', body: {
      wallet_id: wallet.id, file_name: name, currency: 'IDR', document_id: doc,
      opening_balance: 45000000, closing_balance: 57000000,
      statement_start: '2026-09-01', statement_end: '2026-09-30', rows: lines,
    } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
  }
  async function request(batch, decisions) {
    const r = await call(`/bank-imports/${batch}/review`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.reviewed.review_hash, /^[a-f0-9]{64}$/);
    return { request_key: crypto.randomUUID(), review_hash: r.body.reviewed.review_hash, rows: decisions };
  }
  const confirm = (id, body) => call(`/bank-imports/${id}/confirm`, { method: 'POST', body });
  async function live() {
    const read = async (p) => { const r = await call(p); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
    const [transactions, b, w, debts] = await Promise.all([
      read('/transactions'), read('/bank-import/batches'), read('/wallets'), read('/debts'),
    ]);
    assert.ok(Array.isArray(transactions), 'backward-compatible transaction response');
    return { month: '2026-09', transactions, batches: b.batches, wallets: w.wallets, debts };
  }
  async function mutationSnapshot() {
    return (await admin.query(`SELECT
      (SELECT count(*) FROM public.transactions) AS tx,
      (SELECT count(*) FROM public.bank_import_confirm_requests) AS receipts,
      (SELECT count(*) FROM public.classification_feedback) AS feedback,
      (SELECT count(*) FROM public.bank_reconciliations) AS reconciliations,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.bank_import_rows r) AS rows`)).rows[0];
  }
  before(async () => {
    db = await H.createD4Database('hf_recon_ci');
    if (!db) {
      if (process.env.CI) throw new Error('Native PostgreSQL required in CI; refusing a green skip');
      skipped = true; return;
    }
    admin = await H.openAdmin(db.connectionString); seed = H.seeder(admin);
    biz = await seed.company({ owner: OWNER, name: 'Synthetic Reconciliation A' });
    otherBiz = await seed.company({ owner: OTHER, name: 'Synthetic Reconciliation B' });
    wallet = await seed.wallet(biz, OWNER, { opening: 45000000, date: '2026-08-31', createdAt: '2026-08-31T00:00:00Z' });
    otherWallet = await seed.wallet(otherBiz, OTHER, { opening: 0, date: '2026-08-31' });
    wrongWallet = await seed.wallet(biz, OWNER, { opening: 0, date: '2026-08-31', name: 'Other account' });
    // Account used only for refusal; exclude from active-bank readiness checks.
    await admin.query('UPDATE public.wallets SET is_active=false WHERE id=$1', [wrongWallet.id]);
    const file = crypto.randomUUID(); doc = crypto.randomUUID();
    await admin.query(`INSERT INTO public.document_files(id,business_id,storage_path,file_name,sha256_hash)
      VALUES($1,$2,$3,'synthetic-bca-sept.csv',$4)`, [file, biz, `${biz}/${file}`, 'a'.repeat(64)]);
    await admin.query(`INSERT INTO public.financial_documents(id,business_id,file_id,document_type)
      VALUES($1,$2,$3,'bank_document')`, [doc, biz, file]);
    income = await seed.manual(biz, OWNER, wallet.id, '2026-09-05', 20000000, rows[0].description);
    const debt = (await admin.query(`INSERT INTO public.debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope)
      VALUES($1,$2,'payable','Synthetic Hosting Vendor',5000000,5000000,'IDR','business') RETURNING id`, [biz, OWNER])).rows[0].id;
    // Fixture payment through a real database function, never a fake RPC success.
    const key = crypto.randomUUID();
    const p = (await admin.query(`SELECT public.rpc_record_debt_payment($1::uuid,$2::bigint,$3::bigint,$4::uuid,
      5000000::numeric,'IDR',5000000::numeric,1::numeric,'native','2026-09-15'::date,$5::text,$6::text) AS r`,
      [biz, OWNER, debt, wallet.id, key, crypto.createHash('sha256').update(key).digest('hex')])).rows[0].r;
    assert.equal(p.ok, true); payment = Number(p.data.transaction_id); assert.ok(payment > 0);
    expense = await seed.manual(biz, OWNER, wallet.id, '2026-09-20', -3000000, rows[2].description);
    foreignTx = await seed.manual(otherBiz, OTHER, otherWallet.id, '2026-09-20', -3000000);
    wrongWalletTx = await seed.manual(biz, OWNER, wrongWallet.id, '2026-09-20', -3000000);
    app = await H.startServer(db.connectionString);
    ({ closeReadiness, packageExportData } = await import('../../client/src/v2/lib/accounting.js'));
  });
  after(async () => {
    try { await app?.stop(); } finally {
      try { await admin?.end(); } finally { if (db) await db.drop(); }
    }
  });

  it('A: reviewed confirmation links existing income, debt payment and expense with zero new cash', async (t) => {
    if (skipped) return t.skip('Local PostgreSQL unavailable');
    const n = await txCount(), up = await upload(); assert.equal(up.rows.length, 3);
    const body = await request(up.batch.id, up.rows.map((r, i) => ({ row_id: r.id, match_action: 'link',
      matched_transaction_id: [income, payment, expense][i], transaction_type: i ? 'expense' : 'income' })));
    const r = await confirm(up.batch.id, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true); assert.equal(r.body.linked, 3); assert.equal(r.body.imported, 0);
    assert.equal(r.body.status, 'imported'); assert.equal(r.body.reconciliation.status, 'balanced');
    assert.equal(Number(r.body.reconciliation.difference), 0); assert.equal(await txCount(), n);
    assert.equal(await count('SELECT count(*) n FROM public.bank_import_confirm_requests WHERE batch_id=$1', [up.batch.id]), 1);
    assert.equal(await count('SELECT count(*) n FROM public.bank_import_rows WHERE batch_id=$1 AND linked_transaction_id IS NOT NULL', [up.batch.id]), 3);
    completed = { id: up.batch.id, body };
    const data = await live();
    const bankTx = data.transactions.filter(x => x.wallet_id === wallet.id && x.source !== 'wallet_opening_balance');
    assert.equal(bankTx.length, 3); assert.ok(bankTx.every(x => x.linked_statement_row_id != null));
    const readiness = closeReadiness(data);
    assert.equal(readiness.unlinked_transactions.length, 0);
    assert.equal(readiness.checks.find(x => x.key === 'reconciliation').done, true);
    assert.equal(readiness.banks.reconciled, 1); assert.equal(readiness.is_closed, false);
    const out = packageExportData({ ...data, companyName: 'Synthetic A', businessId: biz });
    assert.equal(out.readiness.bank_reconciliation_status, 'reconciled');
    assert.equal(out.discrepancies.unlinked_transactions.length, 0);
  });

  it('B: exact-key replay recovers the result; changed payload and duplicate relinking write nothing', async (t) => {
    if (skipped) return t.skip('Local PostgreSQL unavailable');
    assert.ok(completed, 'Scenario A must complete');
    const before = await mutationSnapshot(), replay = await confirm(completed.id, completed.body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.replayed, true);
    assert.deepEqual(await mutationSnapshot(), before, 'replay creates no ledger/link/feedback/reconciliation/receipt');
    const changed = structuredClone(completed.body); changed.rows[0].match_action = 'exclude';
    const conflict = await confirm(completed.id, changed);
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'import_request_conflict');
    assert.deepEqual(await mutationSnapshot(), before);
    const readback = await call(`/bank-imports/${completed.id}/requests/${completed.body.request_key}`);
    assert.equal(readback.status, 200); assert.equal(readback.body.state, 'confirmed');
    const up = await upload([rows[0]], 'synthetic-duplicate.csv');
    const body = await request(up.batch.id, [{ row_id: up.rows[0].id, match_action: 'link', matched_transaction_id: income, transaction_type: 'income' }]);
    const b = await mutationSnapshot(), r = await confirm(up.batch.id, body);
    assert.equal(r.status, 400, JSON.stringify(r.body)); assert.equal(r.body.code, 'invalid_rows');
    assert.match(r.body.error, /already linked/i); assert.deepEqual(await mutationSnapshot(), b);
  });

  it('C: equal and opposite missing ledger rows still prevent reconciliation and accountant sign-off', async (t) => {
    if (skipped) return t.skip('Local PostgreSQL unavailable');
    const incoming = await seed.manual(biz, OWNER, wallet.id, '2026-09-25', 1000000, 'Unreconciled receipt');
    const outgoing = await seed.manual(biz, OWNER, wallet.id, '2026-09-26', -1000000, 'Unreconciled expense');
    assert.equal(await H.ledgerReader(admin).today(wallet.id), 57000000);
    const data = await live(), readiness = closeReadiness(data);
    const ids = readiness.unlinked_transactions.map(x => Number(x.id));
    assert.ok(ids.includes(incoming)); assert.ok(ids.includes(outgoing));
    assert.equal(readiness.checks.find(x => x.key === 'reconciliation').done, false);
    assert.equal(readiness.automated_checks_passed, false); assert.equal(readiness.status, 'in_progress');
    assert.equal(readiness.is_closed, false);
    const out = packageExportData({ ...data, companyName: 'Synthetic A', businessId: biz });
    assert.equal(out.readiness.bank_reconciliation_status, 'unreconciled');
    assert.equal(out.readiness.automated_checks_passed, false); assert.equal(out.readiness.status, 'in_progress');
    assert.ok(out.discrepancies.unlinked_transactions.length >= 2);
    assert.ok(out.limitations.some(x => x.includes('Unreconciled ledger transactions')));
  });

  it('D: foreign company and wrong account links are denied without ledger or receipt mutation', async (t) => {
    if (skipped) return t.skip('Local PostgreSQL unavailable');
    const up = await upload([{ ...rows[2], description: 'Isolation refusal' }]);
    for (const [tx, status, error] of [[foreignTx, 403, 'isolation_violation'], [wrongWalletTx, 400, 'invalid_rows']]) {
      const body = await request(up.batch.id, [{ row_id: up.rows[0].id, match_action: 'link', matched_transaction_id: tx, transaction_type: 'expense' }]);
      const before = await mutationSnapshot(), r = await confirm(up.batch.id, body);
      assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.code || r.body.error, error);
      if (tx === wrongWalletTx) assert.match(r.body.error, /different wallet/i);
      assert.deepEqual(await mutationSnapshot(), before);
    }
    const denied = await call(`/bank-imports/${completed.id}/requests/${completed.body.request_key}`, { user: OTHER, biz: otherBiz });
    assert.notEqual(denied.status, 200); assert.equal(denied.body.result, undefined);
  });
});
