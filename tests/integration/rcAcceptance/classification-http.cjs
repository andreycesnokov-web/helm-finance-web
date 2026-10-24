'use strict';
// Real stack: management vs accounting preparation (24 Oct 2026). Ten acceptance scenarios on one unused month of
// the admitted company: an invoiced expense, an expense without an invoice, personal money paid from the company
// account, a capital purchase, a loan principal repayment, a salary, an imported bank expense with no category,
// accountant review changes, the package register, and Pulse / Radar after reclassification. Every expected figure
// is rebuilt from PostgreSQL. Needs admit-http.cjs (+ picker-http.cjs for C.doc) and CLS_MONTH (unused, e.g. 2027-10).
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomUUID } = require('node:crypto'), { Client } = require('pg');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), db = new Client({ connectionString: process.env.DATABASE_URL }), results = [];
const M = process.env.CLS_MONTH;
const pass = (name, extra = {}) => { results.push({ case: name, status: 'PASS', ...extra }); fs.writeFileSync('/evidence/CLASSIFICATION_HTTP.json', JSON.stringify({ candidate: process.env.CFO_RC_SHA || 'unrecorded', month: M, results }, null, 2)); console.log('PASS ' + name); };
const api = async (path, { method = 'GET', body, token = C.owner.token, biz = C.biz } = {}) => {
  const r = await fetch(process.env.BASE_URL + '/api' + path, { method, headers: { authorization: 'Bearer ' + token, 'x-business-id': biz, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const ok = (r, what) => { assert.ok(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
const q = async (s, p) => (await db.query(s, p)).rows;
const classify = (id, body, opts) => api(`/transactions/${id}/classification`, { method: 'PUT', body, ...opts });

(async () => {
  assert.match(M || '', /^\d{4}-(0[1-9]|1[0-2])$/, 'Set CLS_MONTH to an unused month');
  await db.connect(); assert.equal((await q('SELECT system_identifier::text id FROM pg_control_system()'))[0].id, C.cluster);
  assert.equal((await q("SELECT count(*)::int n FROM transactions WHERE business_id=$1 AND to_char(transaction_date,'YYYY-MM')=$2", [C.biz, M]))[0].n, 0, 'month must be unused');
  // Company categories with confirmed P&L groups (the existing classification system — nothing new).
  const tag = M.replace('-', '');
  const names = { ops: `RC ops ${tag}`, salary: `RC salary ${tag}`, equip: `RC equipment ${tag}`, loan: `RC loan repayment ${tag}` };
  for (const n of Object.values(names)) ok(await api('/cashflow-categories', { method: 'POST', body: { name: n, group_type: 'outflow' } }), 'category ' + n);
  const cats = ok(await api('/cashflow-categories'), 'categories').categories.filter((c) => c.business_id === C.biz);
  const id = (n) => cats.find((c) => c.name === n).id;
  ok(await api('/pnl-mapping', { method: 'PATCH', body: { mappings: [{ category_id: id(names.ops), pnl_group: 'operating_cost' }, { category_id: id(names.salary), pnl_group: 'operating_cost' },
    { category_id: id(names.equip), pnl_group: 'asset_purchase' }, { category_id: id(names.loan), pnl_group: 'funding' }] } }), 'groups');
  const row = (amount, d, category, description) => ({ type: 'expense', amount: String(amount), currency: 'IDR', wallet_id: C.wallet, transaction_date: `${M}-${d}`, category, description, scope: 'business' });
  const plan = [[1100000, '03', names.ops, 'S1 office supplies, invoice attached'], [1200000, '04', names.ops, 'S2 office supplies, no invoice'],
    [1300000, '05', names.ops, 'S3 owner personal purchase'], [1400000, '06', names.equip, 'S4 laptop'], [1500000, '07', names.loan, 'S5 loan principal'],
    [1600000, '08', names.salary, 'S6 salary']];
  ok(await api('/transactions/batch', { method: 'POST', body: { request_key: randomUUID(), transactions: plan.map(([a, d, c, s]) => row(a, d, c, s)) } }), 'operations');
  // S7: an imported bank statement row confirmed with no category.
  const bal = Number((await q('SELECT fn_wallet_ledger_balance($1)::numeric b', [C.wallet]))[0].b);
  const batch = ok(await api('/bank-import/batches', { method: 'POST', body: { wallet_id: C.wallet, file_name: `rc_${tag}.csv`, file_type: 'csv', currency: 'IDR', opening_balance: bal,
    closing_balance: bal - 1700000, statement_start: `${M}-01`, statement_end: `${M}-28`, rows: [{ row_index: 0, tx_date: `${M}-09`, amount: -1700000, direction: 'out', description: `S7 DEBIT TRF ${tag} 8899`, bank_reference: `RC${tag}S7`, balance_after: bal - 1700000 }] } }), 'statement');
  const review = ok(await api(`/bank-imports/${batch.batch.id}/review`), 'review');
  ok(await api(`/bank-imports/${batch.batch.id}/confirm`, { method: 'POST', body: { request_key: randomUUID(), review_hash: review.reviewed.review_hash,
    rows: [{ row_id: batch.rows[0].id, transaction_type: 'expense', scope: 'business', category_id: null, counterparty_id: null, match_action: 'create' }] } }), 'confirm');
  const txs = await q("SELECT id, description, amount_idr::numeric amt FROM transactions WHERE business_id=$1 AND to_char(transaction_date,'YYYY-MM')=$2 ORDER BY transaction_date, id", [C.biz, M]);
  assert.equal(txs.length, 7);
  const T = Object.fromEntries(txs.map((t) => [t.description.slice(0, 2), t.id]));
  // S1: the invoice is linked as a supporting document.
  ok(await api(`/documents/${C.doc}/links`, { method: 'POST', body: { target_type: 'transaction', target_id: String(T.S1) } }), 'link invoice');
  const ledger = async () => (await q("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) h, fn_wallet_ledger_balance($2)::text b FROM transactions t WHERE business_id=$1", [C.biz, C.wallet]))[0];
  const before = await ledger(), pulse0 = ok(await api('/pulse'), 'pulse');
  const span = `/pulse/advanced-insights?from=${M}-01&to=${M}-28`;
  const ins0 = ok(await api(span), 'insights').metrics;

  // Reclassify: S3 personal; S2 explicitly operating with a note (no invoice); S7 needs review.
  ok(await classify(T.S3, { business_purpose: 'personal', note: 'owner purchase paid by company card' }), 'personal');
  ok(await classify(T.S2, { business_purpose: 'operating', note: 'receipt lost' }), 'operating');
  ok(await classify(T.S7, { business_purpose: 'needs_review' }), 'needs review');
  const after = await ledger();
  assert.deepEqual(after, before, 'no amount, balance or ledger row changed');
  pass('classification never changes an operation, its amount or the account balance', { balance: after.b });

  // Management view (P&L): independent rebuild from SQL of the operating costs of the month.
  const pl = ok(await api(`/pulse/profit-loss?month=${M}&currency=IDR`), 'pnl');
  const where = (tid) => (pl.entries.find((e) => e.transaction_id === String(tid)) ? 'included' : pl.excluded.find((e) => e.transaction_id === String(tid))?.reason || pl.exceptions.find((e) => e.transaction_id === String(tid))?.reason);
  assert.deepEqual([where(T.S1), where(T.S2), where(T.S3), where(T.S4), where(T.S5), where(T.S6), where(T.S7)],
    ['included', 'included', 'personal_non_business', 'asset_purchase', 'funding', 'included', 'purpose_needs_review']);
  const [{ opex }] = await q(`SELECT sum(t.amount_idr)::numeric opex FROM transactions t JOIN cashflow_categories c ON c.business_id=t.business_id AND c.name=t.category
    LEFT JOIN transaction_classifications x ON x.transaction_id=t.id
    WHERE t.business_id=$1 AND to_char(t.transaction_date,'YYYY-MM')=$2 AND c.pnl_group='operating_cost' AND coalesce(x.business_purpose,'operating')='operating'`, [C.biz, M]);
  assert.equal(Number(pl.periods[M].totals.operating_cost), Number(opex));
  assert.equal(Number(opex), 1100000 + 1200000 + 1600000);
  // Nothing disappears: all seven operations are in the report, each in exactly one list.
  assert.equal([...pl.entries, ...pl.excluded, ...pl.exceptions].filter((e) => txs.some((t) => String(t.id) === e.transaction_id)).length, 7);
  pass('scenarios 1–7: invoiced and undocumented business costs count; personal, capital, loan principal and the unknown import do not', { operating_cost: Number(opex) });

  // Month figures (Pulse) follow the purpose; cash and the forecast do not.
  const ins1 = ok(await api(span), 'insights').metrics, pulse1 = ok(await api('/pulse'), 'pulse');
  assert.equal(ins1.other_cash_movement.personal, 1300000);
  assert.equal(ins0.operating_cash_out - ins1.operating_cash_out, 1300000 + (ins0.other_cash_movement.needs_review === ins1.other_cash_movement.needs_review ? 0 : 0));
  assert.deepEqual([pulse1.totalBalance, pulse1.burnRate, pulse1.runway, JSON.stringify(pulse1.payroll_schedule)], [pulse0.totalBalance, pulse0.burnRate, pulse0.runway, JSON.stringify(pulse0.payroll_schedule)]);
  const R = await import('../../../client/src/v2/lib/radarSeries.js');
  const radar = (p) => R.forecast({ balance: p.totalBalance, burnRate: R.forecastBurn(p), items: R.cashItems({ debts: p.debts, payroll: p.payroll_schedule, horizon: 90 }).items, horizon: 90 });
  assert.deepEqual(radar(pulse1).days.map((d) => d.expected), radar(pulse0).days.map((d) => d.expected));
  pass('scenario 10: after reclassification Pulse month figures move the personal 1,300,000 out of operating cost; cash, burn, runway and the 90-day Radar line are identical');

  // Scenario 8: accountant review — server records actor and time; roles; purpose change clears it; audit trail.
  const rv = ok(await classify(T.S1, { accountant_reviewed: true }), 'review');
  assert.ok(rv.classification.accountant_reviewed_at);
  // The owner's mark is stored with the owner role and never reads as an accountant's review.
  assert.deepEqual([rv.classification.accountant_reviewed_role, rv.classification.review_kind], ['owner', 'other_role']);
  const stored = (await q('SELECT accountant_reviewed_by::text by, accountant_reviewed_role role, business_purpose FROM transaction_classifications WHERE transaction_id=$1', [T.S1]))[0];
  assert.deepEqual([stored.by, stored.role], [String(C.owner.user.id), 'owner']);
  const pl8 = ok(await api(`/pulse/profit-loss?month=${M}&currency=IDR`), 'pnl review');
  assert.equal(pl8.entries.find((e) => e.transaction_id === String(T.S1)).review_status, 'reviewed_not_by_accountant');
  assert.equal((await classify(T.S1, { accountant_reviewed: true, accountant_reviewed_by: 1 })).data.error, 'server_controlled_field');
  const cleared = ok(await classify(T.S1, { business_purpose: 'capital' }), 'purpose change');
  assert.equal(cleared.classification.review_cleared, true); assert.equal(cleared.classification.accountant_reviewed_at, null);
  ok(await classify(T.S1, { business_purpose: null }), 'back to category');
  // A member without an accounting role may not mark reviewed or classify. The admitted second user is this
  // company's CFO (allowed); for this check their membership is an employee's, then restored.
  const [m0] = await q('SELECT role FROM business_members WHERE business_id=$1 AND user_id=$2', [C.biz, C.other.user.id]);
  assert.ok(m0, 'second user is a member');
  await q("UPDATE business_members SET role='employee' WHERE business_id=$1 AND user_id=$2", [C.biz, C.other.user.id]);
  try {
    assert.equal((await classify(T.S1, { accountant_reviewed: true }, { token: C.other.token })).status, 403);
    assert.equal((await classify(T.S1, { business_purpose: 'personal' }, { token: C.other.token })).status, 403);
  } finally { await q('UPDATE business_members SET role=$3 WHERE business_id=$1 AND user_id=$2', [C.biz, C.other.user.id, m0.role]); }
  const audit = await q("SELECT action, actor_user_id::text actor FROM audit_events WHERE business_id=$1 AND entity_type='transaction_classification' AND entity_id=$2 ORDER BY created_at", [C.biz, String(T.S1)]);
  assert.equal(audit.length, 3); assert.ok(audit.every((a) => a.action === 'transaction_classified' && a.actor === String(C.owner.user.id)));
  pass('scenario 8: review mark set by the server (actor + time), refused for other roles and client-sent actors, cleared by a purpose change, every change audited');

  // Tenant isolation: acting as THEIR company (C.foreign), the second user cannot reach this company's operation,
  // nor read its marks; this company's owner cannot touch theirs. (C.other is also this company's CFO — allowed here.)
  assert.equal((await classify(T.S2, { business_purpose: 'personal' }, { token: C.other.token, biz: C.foreign })).status, 404);
  const theirs = ok(await api('/transaction-classifications', { token: C.other.token, biz: C.foreign }), 'their marks').classifications;
  assert.ok(!theirs.some((c) => txs.some((t) => String(t.id) === c.transaction_id)));
  assert.equal((await classify(C.foreignTx, { business_purpose: 'personal' })).status, 404);
  pass('another company can neither read nor change these marks, and this company cannot touch theirs');

  // Scenario 9: the accountant package register keeps every operation with its evidence and review state.
  const REG = await import('../../../client/src/v2/lib/accountantRegisters.js');
  const marks = ok(await api('/transaction-classifications'), 'marks').classifications;
  const od = ok(await api(`/accountant/operation-documents/package?month=${M}`), 'operation documents');
  const allTx = ok(await api('/transactions?period=all'), 'transactions');
  const monthTx = (Array.isArray(allTx) ? allTx : allTx.transactions).filter((t) => String(t.transaction_date).slice(0, 7) === M);
  const pnlById = new Map([...pl.entries.map((e) => [e.transaction_id, `included: ${e.group}`]), ...pl.excluded.map((e) => [e.transaction_id, `excluded: ${e.reason}`]), ...pl.exceptions.map((e) => [e.transaction_id, `needs review: ${e.reason}`])]);
  const reg = REG.classificationRegister({ txs: monthTx, classifications: marks, operationDocuments: [od], pnlById });
  const col = (n) => reg.table.columns.indexOf(n), by = (tid) => reg.table.rows.find((r) => r[0] === String(tid));
  assert.equal(reg.table.rows.length, 7, 'every operation of the month is in the register');
  assert.deepEqual([T.S1, T.S2, T.S3, T.S4, T.S5, T.S6, T.S7].map((tid) => by(tid)[col('business_purpose')]), ['operating', 'operating', 'personal', 'capital', 'non_pnl', 'operating', 'needs_review']);
  // S1's linked invoice: the register repeats the operation documents engine's own verdict (the shared synthetic
  // invoice does not match this amount, so the engine asks for a check) — never "missing".
  const s1Op = (od.operations || []).find((o) => (o.payments || []).some((p) => String(p.id) === String(T.S1)));
  assert.equal(by(T.S1)[col('documents')], { complete: 'present', clarification: 'pending review', missing: 'missing' }[s1Op?.status] || 'present');
  assert.notEqual(by(T.S1)[col('documents')], 'missing');
  // S2 has no document at all: never 'present', and flagged for the accountant.
  assert.ok(['missing', 'pending review'].includes(by(T.S2)[col('documents')])); assert.equal(by(T.S2)[col('document_files')], '');
  assert.match(by(T.S2)[col('notes')], /receipt lost/); assert.match(by(T.S2)[col('notes')], /possible fiscal adjustment/);
  assert.ok(reg.table.rows.every((r) => /undetermined|not a business expense/.test(r[col('tax_treatment')])), 'tax treatment never decided by the system');
  assert.equal(reg.summary.personal_amount, 1300000);
  pass('scenario 9: register 11 lists all 7 operations with purpose, documents, review state and notes; tax treatment stays undetermined', reg.summary);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.end().catch(() => {}));
