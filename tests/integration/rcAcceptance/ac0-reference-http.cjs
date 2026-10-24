'use strict';
// AC-0 financial regression (24 Oct 2026). A synthetic reference company is seeded once with the I-1 acceptance
// scenarios; the same real endpoints are captured before and after the patch and every numeric difference is listed.
//   AC0_MODE=seed               create the reference rows in the admitted synthetic company (idempotent by marker)
//   AC0_MODE=capture AC0_LABEL=before|after   write /evidence/AC0_REF_<label>.json
//   AC0_MODE=compare            diff before/after; cash balances must not change at all
// Synthetic data only; the target must be the disposable cluster (EXPECTED_PG_SYSTEM_ID).
const assert = require('node:assert/strict'), fs = require('node:fs'), { randomUUID } = require('node:crypto'), { Client } = require('pg');
const C = JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')), base = process.env.BASE_URL, mode = process.env.AC0_MODE;
const db = new Client({ connectionString: process.env.DATABASE_URL }), MARK = 'AC0REF';
async function api(path, method = 'GET', body) {
  const r = await fetch(base + '/api' + path, { method, signal: AbortSignal.timeout(30000), headers: { authorization: 'Bearer ' + C.owner.token, 'x-business-id': C.biz, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const ok = async (path, method, body) => { const r = await api(path, method, body); assert.ok(r.status < 300, `${method || 'GET'} ${path} → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data; };
const today = new Date().toISOString().slice(0, 10), month = today.slice(0, 7);
// The I-1 acceptance rows. `cat` is a category NAME (as prod rows carry), `confirmed` uses the confirmed-group category.
const ROWS = [
  { key: 's1_customer_payment_transfer_text', type: 'income', amount: '50000000', confirmed: true, description: 'TRANSFER FROM CUSTOMER PT AC0 KLIEN INV-001' },
  { key: 's6_confirmed_income_category', type: 'income', amount: '20000000', confirmed: true, description: 'Pembayaran jasa INV-002' },
  { key: 's3_owner_capital', type: 'income', amount: '100000000', cat: 'Owner funding (loan)', description: 'TRANSFER FROM DIRECTOR SETORAN MODAL', funding: { source_kind: 'founder', instrument: 'equity' } },
  { key: 's4_loan_disbursement', type: 'income', amount: '200000000', cat: 'Bank loan', description: 'LOAN DISBURSEMENT BANK AC0', funding: { source_kind: 'bank', instrument: 'loan' } },
  { key: 's5_supplier_refund', type: 'income', amount: '1500000', cat: 'Software and subscriptions', description: 'REFUND FROM SUPPLIER AC0 SAAS' },
  { key: 's7_ambiguous_transfer_word', type: 'income', amount: '3000000', description: 'TRANSFER 0937 NO REF' },
  { key: 's7b_ambiguous_no_words', type: 'income', amount: '2000000', description: 'TRF 1188 BCA' },
  { key: 'p1_salary_transfer_text', type: 'expense', amount: '8000000', cat: 'Salary and wages', description: 'TRANSFER OR VIA IB KARYAWAN 01' },
  { key: 'p2_loan_repayment_transfer_text', type: 'expense', amount: '2000000', cat: 'Loan repayments', description: 'TRANSFER OR VIA IB ANGSURAN' },
  { key: 'p3_software_transfer_text', type: 'expense', amount: '750000', cat: 'Software and subscriptions', description: 'TRANSFER OR VIA IB SAAS TOOL' },
  { key: 's9_to_reclassify', type: 'income', amount: '4000000', description: 'TRANSFER MASUK 7781' },
];
async function seeded() { return (await db.query(`SELECT description, id FROM transactions WHERE business_id=$1 AND description LIKE $2`, [C.biz, MARK + ' %'])).rows; }
async function seed() {
  if ((await seeded()).length) { console.log('PASS seed: already seeded'); return; }
  let catId = (await db.query(`SELECT id FROM cashflow_categories WHERE business_id=$1 AND name='AC0 Sales'`, [C.biz])).rows[0]?.id;
  if (!catId) { catId = randomUUID(); await db.query(`INSERT INTO cashflow_categories(id,business_id,name,group_type,activity_type,is_system,is_active,pnl_group,source) VALUES($1,$2,'AC0 Sales','inflow','operating',false,true,'revenue','manual')`, [catId, C.biz]); }
  const wallets = await ok('/wallets');
  let second = (Array.isArray(wallets) ? wallets : wallets.wallets || []).find((w) => w.name === 'AC0 Second Bank');
  if (!second) { const w = await ok('/wallets', 'POST', { name: 'AC0 Second Bank', currency: 'IDR', type: 'bank', scope: 'business', request_key: randomUUID() }); second = w.wallet || w; }
  for (const r of ROWS) {
    const tx = { type: r.type, amount: r.amount, currency: 'IDR', wallet_id: C.wallet, transaction_date: today, description: `${MARK} ${r.description}`, scope: 'business' };
    if (r.confirmed) { tx.cashflow_category_id = catId; tx.category = 'AC0 Sales'; } else if (r.cat) tx.category = r.cat;
    await ok('/transactions/batch', 'POST', { request_key: randomUUID(), transactions: [tx] });
    if (r.funding) {
      const id = (await db.query('SELECT id FROM transactions WHERE business_id=$1 AND description=$2', [C.biz, tx.description])).rows[0].id;
      await ok('/business-funding', 'POST', { ...r.funding, amount: r.amount, currency: 'IDR', received_on: today, received_transaction_id: id, lender_name: 'AC0 ' + r.funding.source_kind, request_key: randomUUID() });
    }
  }
  await ok('/wallets/transfer', 'POST', { from_wallet_id: C.wallet, to_wallet_id: second.id, amount: '5000000', description: `${MARK} TRANSFER BETWEEN OWN ACCOUNTS`, transfer_id: randomUUID(), date: today });
  console.log(`PASS seed: ${ROWS.length} reference operations + 1 own-account transfer in ${month}`);
}
// Flatten every number / numeric string / boolean / short string in a response into path → value.
function flat(o, p = '', out = {}) {
  if (o == null) { out[p] = o; return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => flat(v, `${p}[${i}]`, out)); return out; }
  if (typeof o === 'object') { for (const k of Object.keys(o).sort()) { if (/generated_at|as_of|timestamp|request_id|_at$|token|ai_text|aiText|text$|message|brief|sentence|label/i.test(k)) continue; flat(o[k], p ? `${p}.${k}` : k, out); } return out; }
  out[p] = o; return out;
}
async function capture(label) {
  const rows = await seeded(); assert.ok(rows.length >= ROWS.length, 'seed first');
  const ids = new Map(rows.map((r) => [String(r.id), r.description.slice(MARK.length + 1)]));
  const balances = (await db.query(`SELECT name, fn_wallet_ledger_balance(id)::text b FROM wallets WHERE business_id=$1 ORDER BY name`, [C.biz])).rows;
  const txs = await ok('/transactions?period=all');
  const classes = {}; for (const t of txs) if (ids.has(String(t.id))) classes[ids.get(String(t.id))] = t.cash_class || null;
  const snap = { label, candidate: process.env.CFO_RC_SHA || 'unrecorded', month, balances,
    pulse: flat(await ok('/pulse')), insights: flat(await ok(`/pulse/advanced-insights?from=${month}-01&to=${today}`)),
    profit_loss: flat(await ok(`/pulse/profit-loss?month=${month}&currency=IDR&months=${month}`)),
    ai_cfo: flat(await ok('/ai-cfo/context')), cash_class: classes };
  fs.writeFileSync(`/evidence/AC0_REF_${label}.json`, JSON.stringify(snap, null, 2));
  console.log(`PASS capture ${label}: pulse ${Object.keys(snap.pulse).length}, insights ${Object.keys(snap.insights).length}, P&L ${Object.keys(snap.profit_loss).length}, AI CFO ${Object.keys(snap.ai_cfo).length} values; ${balances.length} wallet balances`);
}
function compare() {
  const a = JSON.parse(fs.readFileSync('/evidence/AC0_REF_before.json')), b = JSON.parse(fs.readFileSync('/evidence/AC0_REF_after.json'));
  assert.deepEqual(b.balances, a.balances, 'wallet balances changed');
  const diff = {};
  for (const part of ['pulse', 'insights', 'profit_loss', 'ai_cfo']) {
    const keys = new Set([...Object.keys(a[part]), ...Object.keys(b[part])]);
    diff[part] = [...keys].filter((k) => JSON.stringify(a[part][k]) !== JSON.stringify(b[part][k])).sort().map((k) => ({ path: k, before: a[part][k], after: b[part][k] }));
  }
  fs.writeFileSync('/evidence/AC0_REF_diff.json', JSON.stringify({ balances_unchanged: true, cash_class_after: b.cash_class, diff }, null, 2));
  console.log('PASS compare: wallet balances identical');
  for (const [part, d] of Object.entries(diff)) { console.log(`  ${part}: ${d.length} changed values`); for (const x of d.slice(0, 60)) console.log(`    ${x.path}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`); }
  console.log('  cash_class after:'); for (const [k, v] of Object.entries(b.cash_class)) console.log(`    ${k} → ${JSON.stringify(v)}`);
}
(async () => {
  await db.connect();
  assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id, process.env.EXPECTED_PG_SYSTEM_ID);
  if (mode === 'seed') await seed(); else if (mode === 'capture') await capture(process.env.AC0_LABEL); else if (mode === 'compare') compare(); else throw Error('AC0_MODE=seed|capture|compare');
  await db.end();
})().catch(async (e) => { console.error(e.message); await db.end().catch(() => {}); process.exit(1); });
