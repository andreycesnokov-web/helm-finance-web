'use strict';
// Phase G — core financial workflows on the fresh company A1 (Control trial) through the real HTTP API, every balance
// cross-checked against the database ledger function. Synthetic amounts only.
const { assert, call, collector, db, key, state, signIn } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/finance.json');
const n = (x) => Number(x);
(async () => {
  const c = await db();
  const st = state(), A1 = st.companies.A1, A2 = st.companies.A2;
  const alpha = await signIn('owner.alpha@rehearsal.test', st.alpha_password);
  const beta = await signIn('owner.beta@rehearsal.test', st.beta_password);
  const T = alpha.token, api = (m, p, body, extra = {}) => call(m, p, { token: T, biz: A1, body, ...extra });
  const ledger = async (w) => n((await c.query('SELECT fn_wallet_ledger_balance($1) b', [w])).rows[0].b);
  const apiBalance = async (w) => { const r = await api('GET', '/wallets'); const row = (r.body.wallets || r.body).find((x) => x.id === w); return n(row.balance ?? row.current_balance); };
  const W = {}, RUN = key().slice(0, 4);
  await check('G1 accounts: create two accounts with dated opening balances; API balance = ledger; rename allowed', async () => {
    for (const [k, name, open] of [['bca', 'BCA Operating ' + RUN, 50_000_000], ['mandiri', 'Mandiri Reserve ' + RUN, 10_000_000]]) {
      const r = await api('POST', '/wallets', { request_key: key(), name, currency: 'IDR', opening_balance: open, opening_balance_date: '2026-09-30' });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); W[k] = r.body.wallet.id;
      assert.equal(await ledger(W[k]), open); assert.equal(await apiBalance(W[k]), open);
    }
    const dup = await api('POST', '/wallets', { request_key: key(), name: 'BCA Operating ' + RUN, currency: 'IDR' }); assert.ok(dup.status >= 400, 'duplicate account name accepted');
    const ren = await api('PUT', '/wallets/' + W.mandiri, { name: 'Mandiri Reserve IDR ' + RUN });
    state({ wallets: W });
    return { rename_status: ren.status, duplicate_name_status: dup.status };
  });
  const tx = {};
  await check('G2 transactions: income + expense change balances exactly; permitted edit; idempotent batch replay', async () => {
    const body = { request_key: key(), transactions: [
      { type: 'income', amount: 15_000_000, currency: 'IDR', wallet_id: W.bca, scope: 'business', date: '2026-10-05', description: 'Client payment INV-001 ' + RUN },
      { type: 'expense', amount: 4_500_000, currency: 'IDR', wallet_id: W.bca, scope: 'business', date: '2026-10-06', description: 'Office rent October ' + RUN }] };
    const r = await api('POST', '/transactions/batch', body); assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    const again = await api('POST', '/transactions/batch', body); assert.equal(again.status, 200);
    assert.equal(await ledger(W.bca), 60_500_000); assert.equal(await apiBalance(W.bca), 60_500_000);
    const rows = (await c.query("SELECT id, description FROM transactions WHERE business_id=$1 AND description IN ($2,$3)", [A1, 'Client payment INV-001 ' + RUN, 'Office rent October ' + RUN])).rows;
    assert.equal(rows.length, 2, 'replay booked twice');
    tx.rent = rows.find((x) => x.description === 'Office rent October ' + RUN).id;
    const tr = (await api('GET', '/transactions?period=all')).body; const t = (Array.isArray(tr) ? tr : tr.transactions).find((x) => String(x.id) === String(tx.rent));
    const ed = await api('PATCH', '/transactions/' + tx.rent, { description: 'Office rent October (edited) ' + RUN, expected_version: t.balance_version ?? t.version, request_key: key() });
    return { edit_status: ed.status, edit_error: ed.body?.error || null };
  });
  await check('G3 transfer: both sides booked once; same transfer id is a replay; balances exact', async () => {
    const body = { transfer_id: key(), from_wallet_id: W.bca, to_wallet_id: W.mandiri, amount: 5_000_000, date: '2026-10-07', description: 'Move to reserve' };
    const r1 = await api('POST', '/wallets/transfer', body); assert.ok([200, 201].includes(r1.status), JSON.stringify(r1.body).slice(0, 200));
    const r2 = await api('POST', '/wallets/transfer', body); assert.ok([200, 201].includes(r2.status), 'replay ' + r2.status + JSON.stringify(r2.body).slice(0, 200));
    assert.equal(await ledger(W.bca), 55_500_000); assert.equal(await ledger(W.mandiri), 15_000_000);
    assert.equal(n((await c.query('SELECT count(*) n FROM transactions WHERE transfer_id=$1', [r1.body.transfer_id])).rows[0].n), 2);
    assert.equal(r2.body.transfer_id, r1.body.transfer_id);
    const nokey = await api('POST', '/wallets/transfer', { ...body, transfer_id: undefined }); assert.equal(nokey.status, 400);
    const self = await api('POST', '/wallets/transfer', { ...body, transfer_id: key(), to_wallet_id: W.bca }); assert.equal(self.status, 400);
  });
  let bill, invoice;
  await check('G4 payable: partial payment, idempotent replay, full payment, overpayment refused, outstanding exact', async () => {
    const r = await api('POST', '/debts', { request_key: key(), type: 'payable', counterparty: 'PT Supplier Rehearsal', amount: 10_000_000, currency: 'IDR', due_date: '2026-10-31', description: 'Inventory purchase PO-17' });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); bill = r.body.id;
    if (r.body.approval_status && r.body.approval_status !== 'approved') { const ap = await api('PATCH', `/debts/${bill}/approve`, { channel: 'web' }); assert.ok(ap.status < 300, 'approve ' + ap.status); }
    const pay = (amount, k) => api('POST', `/debts/${bill}/pay`, { amount, wallet_id: W.bca, date: '2026-10-08' }, { headers: { 'Idempotency-Key': k } });
    const k1 = key(); const p1 = await pay(4_000_000, k1); assert.equal(p1.status, 200, 'p1 ' + JSON.stringify(p1.body).slice(0, 200));
    const p1r = await pay(4_000_000, k1); assert.equal(p1r.status, 200, 'replay ' + JSON.stringify(p1r.body).slice(0, 300));
    assert.equal(await ledger(W.bca), 51_500_000, 'replay paid twice');
    const over = await pay(6_000_001, key()); assert.ok(over.status >= 400 && over.status < 500, 'overpayment accepted: ' + over.status);
    assert.equal(await ledger(W.bca), 51_500_000);
    const p2 = await pay(6_000_000, key()); assert.equal(p2.status, 200, 'p2 ' + JSON.stringify(p2.body).slice(0, 200));
    const d = (await c.query('SELECT paid_amount, is_settled FROM debts WHERE id=$1', [bill])).rows[0];
    assert.equal(n(d.paid_amount), 10_000_000); assert.equal(d.is_settled, true);
    assert.ok((await pay(1, key())).status >= 400, 'payment on a settled bill accepted');
    assert.equal(await ledger(W.bca), 45_500_000);
    const nokey = await api('POST', `/debts/${bill}/pay`, { amount: 1, wallet_id: W.bca, date: '2026-10-08' }); assert.equal(nokey.status, 400);
    return { overpayment: over.body?.error };
  });
  await check('G5 invoice (receivable): created in A1 with status, invisible to another customer and to the other company', async () => {
    const r = await api('POST', '/debts', { request_key: key(), type: 'receivable', counterparty: 'PT Client Rehearsal', amount: 7_500_000, currency: 'IDR', due_date: '2026-11-15', description: 'Invoice INV-002 consulting', invoice_number: 'INV-002' });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); invoice = r.body.id;
    const list = await api('GET', '/debts?type=receivable'); assert.ok((list.body.debts || list.body).some((d) => d.id === invoice));
    const st = (list.body.debts || list.body).find((d) => d.id === invoice);
    assert.ok([403, 404].includes((await call('GET', '/debts?type=receivable', { token: beta.token, biz: A1 })).status));
    const a2 = await call('GET', '/debts?type=receivable', { token: T, biz: A2 }); assert.ok(!(a2.body.debts || a2.body).some((d) => d.id === invoice));
    assert.equal((await c.query('SELECT business_id FROM debts WHERE id=$1', [invoice])).rows[0].business_id, A1);
    return { status: st.status || st.payment_status || null };
  });
  let batchId;
  const statement = [
    { tx_date: '2026-10-09', description: 'TRF IN PT CLIENT INV-003', amount: 2_000_000, row_index: 0, bank_reference: 'BCA-REF-0009' },
    { tx_date: '2026-10-10', description: 'BIAYA ADMIN BANK', amount: -25_000, row_index: 1, bank_reference: 'BCA-REF-0010' }];
  await check('G6 bank statement: import → review → confirm books each row once; replay books nothing; re-upload is caught as duplicate', async () => {
    const before = await ledger(W.bca);
    const b = await api('POST', '/bank-import/batches', { wallet_id: W.bca, file_name: 'bca-oct-2026.csv', file_type: 'csv', currency: 'IDR', rows: statement, statement_start: '2026-10-09', statement_end: '2026-10-10' });
    assert.equal(b.status, 200, 'batch ' + JSON.stringify(b.body).slice(0, 300)); batchId = b.body.batch.id;
    const rv = await api('GET', `/bank-imports/${batchId}/review`); assert.equal(rv.status, 200); assert.equal(rv.body.reviewed.can_confirm, true, rv.body.reviewed.opening_state);
    const rows = rv.body.rows.map((r) => ({ row_id: r.id, transaction_type: r.direction === 'in' ? 'income' : 'expense', scope: 'business' }));
    const body = { request_key: key(), review_hash: rv.body.reviewed.review_hash, rows };
    const c1 = await api('POST', `/bank-imports/${batchId}/confirm`, body); assert.equal(c1.status, 200, JSON.stringify(c1.body).slice(0, 300));
    const c2 = await api('POST', `/bank-imports/${batchId}/confirm`, body); assert.equal(c2.status, 200);
    assert.equal(await ledger(W.bca), before + 2_000_000 - 25_000);
    assert.equal(n((await c.query('SELECT count(*) n FROM transactions WHERE bank_import_row_id IN (SELECT id FROM bank_import_rows WHERE batch_id=$1)', [batchId])).rows[0].n), 2);
    const again = await api('POST', '/bank-import/batches', { wallet_id: W.bca, file_name: 'bca-oct-2026-again.csv', file_type: 'csv', currency: 'IDR', rows: statement });
    const dupInfo = { status: again.status, duplicate_count: again.body?.batch?.duplicate_count, matched_count: again.body?.batch?.matched_count, error: again.body?.error };
    if (again.status === 200 && again.body.batch) {
      const rv2 = await api('GET', `/bank-imports/${again.body.batch.id}/review`);
      const rows2 = rv2.body.rows.map((r) => ({ row_id: r.id, transaction_type: r.direction === 'in' ? 'income' : 'expense', scope: 'business' }));
      const c3 = await api('POST', `/bank-imports/${again.body.batch.id}/confirm`, { request_key: key(), review_hash: rv2.body.reviewed.review_hash, rows: rows2 });
      dupInfo.reconfirm = c3.status; dupInfo.reconfirm_error = c3.body?.error;
    }
    assert.equal(await ledger(W.bca), before + 2_000_000 - 25_000, 'the same statement was booked twice');
    const rec = await api('GET', `/wallets/${W.bca}/reconciliation`);
    return { duplicate: dupInfo, reconciliation_status: rec.status };
  });
  await check('G7 reporting: Pulse cash = sum of ledger balances; nothing leaks across companies', async () => {
    const p = await api('GET', '/pulse'); assert.equal(p.status, 200);
    const cash = n(p.body.totalBalance);
    const ledgerSum = (await ledger(W.bca)) + (await ledger(W.mandiri));
    const all = (await c.query('SELECT coalesce(sum(fn_wallet_ledger_balance(id)),0) s FROM wallets WHERE business_id=$1 AND is_active', [A1])).rows[0].s;
    assert.equal(cash, n(all), `pulse ${cash} vs ledger ${all}`);
    assert.ok([403, 404].includes((await call('GET', '/pulse', { token: beta.token, biz: A1 })).status));
    for (const p of ['/transactions?period=all', '/wallets', '/debts']) assert.ok([403, 404].includes((await call('GET', p, { token: beta.token, biz: A1 })).status), p);
    const a2 = await call('GET', '/wallets', { token: T, biz: A2 }); assert.ok(!(a2.body.wallets || a2.body).some((w) => w.id === W.bca));
    return { pulse_cash: cash, ledger_sum_two_main_accounts: ledgerSum, ledger_sum_all_accounts: n(all) };
  });
  await c.end();
  process.exit(save() ? 0 : 1);
})().catch((e) => { console.error('FINANCE CRASHED', e); process.exit(1); });
