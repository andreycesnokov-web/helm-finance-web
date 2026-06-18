// Real migration CI on an ephemeral PostgreSQL (PGlite / WASM Postgres).
// Builds the minimal baseline that 026-029 reference, applies 026-029 twice
// (idempotency), runs a partial-state recovery, then exercises the DB guards:
// business isolation, over-allocation, legacy paid_amount. Prints real output.
// Run: node tests/migrations/ci.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
const FILES = ['026_tax_document_linking.sql', '027_tax_settlement_modes.sql', '028_intercompany_funding.sql', '029_tax_deposit_allocation.sql'];

let pass = 0, fail = 0;
const ok = (m) => { console.log('OK  ' + m); pass++; };
const bad = (m) => { console.log('XX  ' + m); fail++; };

// Minimal baseline (the existing CFO tables 026-029 reference; real types).
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE counterparties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE debts (id bigint PRIMARY KEY, business_id uuid, amount numeric, original_amount numeric, paid_amount numeric);
CREATE TABLE transactions (id bigint PRIMARY KEY, business_id uuid, amount_original numeric);
CREATE TABLE compliance_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE payroll_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE tax_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE official_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

async function applyAll(db) { for (const f of FILES) await db.exec(MIG(f)); }

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);
  console.log('\n=== baseline (001-025 stand-in) applied ===');

  // ── Clean apply ─────────────────────────────────────────────────────────
  try { await applyAll(db); ok('clean apply 026-029'); } catch (e) { bad('clean apply: ' + e.message); }

  // ── Second apply (idempotency) ──────────────────────────────────────────
  try { await applyAll(db); ok('second apply 026-029 (idempotent, no error)'); } catch (e) { bad('second apply: ' + e.message); }

  // ── Object inventory ────────────────────────────────────────────────────
  const cnt = async (sql) => Number((await db.query(sql)).rows[0].c);
  const tables = await cnt(`SELECT count(*) c FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('document_files','financial_documents','document_links','document_debt_links','document_transaction_links','document_compliance_links','tax_treatments','withholding_records','debt_settlement_allocations','withholding_payment_allocations','tax_billing_allocations','business_relationships','intercompany_funding_records','intercompany_settlement_allocations','tax_deposit_accounts','tax_deposit_entries','tax_deposit_allocations')`);
  tables === 17 ? ok(`17 new tables present (got ${tables})`) : bad(`expected 17 tables, got ${tables}`);
  const views = await cnt(`SELECT count(*) c FROM information_schema.views WHERE table_schema='public' AND table_name='intercompany_balances'`);
  views === 1 ? ok('view intercompany_balances present') : bad('view missing');
  const funcs = await cnt(`SELECT count(*) c FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'fn_%'`);
  funcs >= 9 ? ok(`guard/iso functions present (${funcs})`) : bad(`functions ${funcs}`);
  const trigs = await cnt(`SELECT count(*) c FROM information_schema.triggers WHERE trigger_schema='public'`);
  trigs >= 12 ? ok(`triggers active (${trigs})`) : bad(`triggers ${trigs}`);
  const checks = await cnt(`SELECT count(*) c FROM information_schema.table_constraints WHERE table_schema='public' AND constraint_type='CHECK' AND table_name IN ('financial_documents','tax_treatments','debt_settlement_allocations')`);
  checks > 0 ? ok(`CHECK constraints present (${checks} on 3 sampled tables)`) : bad('no checks');
  const uniq = await cnt(`SELECT count(*) c FROM pg_indexes WHERE schemaname='public' AND indexname='document_files_dedup_idx'`);
  uniq === 1 ? ok('dedup unique index on document_files') : bad('dedup index missing');

  // ── Partial-state recovery (drop a trigger + an index, re-run) ──────────
  await db.exec(`DROP TRIGGER trg_debt_settlement_guard ON debt_settlement_allocations; DROP INDEX fin_docs_file_idx;`);
  try { await applyAll(db); ok('partial-state: re-run recreated dropped trigger + index'); } catch (e) { bad('partial re-run: ' + e.message); }
  const reTrig = await cnt(`SELECT count(*) c FROM information_schema.triggers WHERE trigger_name='trg_debt_settlement_guard'`);
  const reIdx  = await cnt(`SELECT count(*) c FROM pg_indexes WHERE indexname='fin_docs_file_idx'`);
  (reTrig >= 1 && reIdx === 1) ? ok('partial-state objects restored') : bad('partial-state not restored');

  // ── Seed two businesses (explicit UUIDs; committed) ─────────────────────
  const { randomUUID } = require('crypto');
  const A = randomUUID(), B = randomUUID(), fileA = randomUUID(), fileB = randomUUID(),
        docA = randomUUID(), docB = randomUUID(), rel = randomUUID(), acct = randomUUID(),
        dep = randomUUID(), ce = randomUUID();
  await db.exec('COMMIT').catch(() => {});   // close any tx left open by migrations
  await db.exec(`BEGIN;
    INSERT INTO businesses(id) VALUES ('${A}'),('${B}');
    INSERT INTO debts(id,business_id,amount,original_amount,paid_amount) VALUES (1,'${A}',1000,1000,0),(2,'${A}',1000,1000,800),(3,'${B}',1000,1000,0);
    INSERT INTO transactions(id,business_id,amount_original) VALUES (10,'${A}',600),(11,'${A}',600),(12,'${B}',600);
    INSERT INTO document_files(id,business_id,storage_path,sha256_hash) VALUES ('${fileA}','${A}','/x','h1'),('${fileB}','${B}','/y','h2');
    INSERT INTO financial_documents(id,business_id,file_id,document_type) VALUES ('${docA}','${A}','${fileA}','vendor_invoice'),('${docB}','${B}','${fileB}','vendor_invoice');
    INSERT INTO compliance_events(id,business_id) VALUES ('${ce}','${A}');
  COMMIT;`);

  // Each test runs in its own transaction so a rejection rolls back ONLY itself.
  const expectReject = async (label, sql) => {
    try { await db.exec(`BEGIN; ${sql}; COMMIT;`); bad(label + ' (NOT rejected!)'); }
    catch { ok(label + ' rejected'); } finally { await db.exec('ROLLBACK').catch(() => {}); }
  };
  const expectOk = async (label, sql) => {
    try { await db.exec(`BEGIN; ${sql}; COMMIT;`); ok(label); }
    catch (e) { bad(label + ': ' + e.message); await db.exec('ROLLBACK').catch(() => {}); }
  };

  // ── Business isolation ──────────────────────────────────────────────────
  await expectReject('iso: financial_document with another business file',
    `INSERT INTO financial_documents(business_id,file_id,document_type) VALUES('${A}','${fileB}','tax_invoice')`);
  await expectReject('iso: document_link across businesses',
    `INSERT INTO document_links(business_id,source_document_id,target_document_id,link_type) VALUES('${A}','${docA}','${docB}','related')`);
  await expectReject('iso: document_debt_link doc(A) + debt(B)',
    `INSERT INTO document_debt_links(business_id,document_id,debt_id) VALUES('${A}','${docA}',3)`);
  await expectReject('iso: settlement debt(A) + transaction(B)',
    `INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,transaction_id,allocated_amount) VALUES('${A}',1,'transaction',12,100)`);
  await expectReject('iso: tax_treatment(A) + debt(B)',
    `INSERT INTO tax_treatments(business_id,debt_id) VALUES('${A}',3)`);

  // ── Over-allocation + legacy paid_amount ────────────────────────────────
  await expectOk('alloc 600 of debt#1 (1000)',
    `INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,transaction_id,allocated_amount) VALUES('${A}',1,'transaction',10,600)`);
  await expectReject('over-alloc: +600 on debt#1 (would be 1200>1000)',
    `INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,transaction_id,allocated_amount) VALUES('${A}',1,'transaction',11,600)`);
  await expectReject('legacy paid: alloc 300 on debt#2 (paid 800, avail 200)',
    `INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,transaction_id,allocated_amount) VALUES('${A}',2,'transaction',10,300)`);
  await expectOk('legacy paid: alloc 200 on debt#2 (== available)',
    `INSERT INTO debt_settlement_allocations(business_id,debt_id,settlement_source_type,transaction_id,allocated_amount) VALUES('${A}',2,'transaction',11,200)`);

  // ── Intercompany: cross-business only via relationship + funding ────────
  await db.exec(`INSERT INTO business_relationships(id,from_business_id,to_business_id,relationship_type) VALUES('${rel}','${A}','${B}','funding_company')`);
  await expectOk('intercompany funding A pays for B (relationship present)',
    `INSERT INTO intercompany_funding_records(relationship_id,economic_owner_business_id,cash_payer_business_id,funded_amount,funding_type,funded_transaction_id) VALUES('${rel}','${B}','${A}',600,'vendor_payment',10)`);
  await expectReject('intercompany funded_transaction must belong to cash payer',
    `INSERT INTO intercompany_funding_records(relationship_id,economic_owner_business_id,cash_payer_business_id,funded_amount,funding_type,funded_transaction_id) VALUES('${rel}','${B}','${A}',600,'vendor_payment',12)`);

  // ── Tax deposit: balance + no over-allocation ───────────────────────────
  await db.exec(`INSERT INTO tax_deposit_accounts(id,business_id) VALUES('${acct}','${A}')`);
  await db.exec(`INSERT INTO tax_deposit_entries(business_id,deposit_account_id,entry_type,amount) VALUES('${A}','${acct}','deposit_payment',1000)`);
  await db.exec(`INSERT INTO tax_deposit_entries(id,business_id,deposit_account_id,entry_type,amount) VALUES('${dep}','${A}','${acct}','allocation',300)`);
  await expectOk('deposit alloc 300 (balance 1000)',
    `INSERT INTO tax_deposit_allocations(business_id,deposit_entry_id,deposit_account_id,compliance_event_id,allocated_amount) VALUES('${A}','${dep}','${acct}','${ce}',300)`);
  await expectReject('deposit over-alloc 5000 (> balance)',
    `INSERT INTO tax_deposit_allocations(business_id,deposit_entry_id,deposit_account_id,compliance_event_id,allocated_amount) VALUES('${A}','${dep}','${acct}','${ce}',5000)`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
