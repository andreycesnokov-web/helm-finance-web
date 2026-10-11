// CI for 038 (fx + funding ledger tables). PGlite. Run: node tests/migrations/ci_038.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const cnt = async (db, sql) => Number((await db.query(sql)).rows[0].c);
const reject = async (db, l, sql) => { try { await db.exec(`BEGIN; ${sql}; COMMIT;`); ok(l + ' (NOT rejected!)', false); } catch { ok(l + ' rejected', true); } finally { await db.exec('ROLLBACK').catch(() => {}); } };

const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'business', owner_user_id bigint, base_currency text DEFAULT 'IDR');
CREATE TABLE business_members (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, role text DEFAULT 'owner', status text DEFAULT 'active', UNIQUE(business_id,user_id));
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, currency text NOT NULL DEFAULT 'IDR', scope text DEFAULT 'business');
CREATE TABLE transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, type text, amount_original DECIMAL(18,2) NOT NULL, amount_idr DECIMAL(18,2), currency_original text, scope text, wallet_id uuid);
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  await db.exec(MIG('037_personal_workspace_foundation.sql'));
  try { await db.exec(MIG('038_fx_and_funding_ledger.sql')); ok('clean apply 038', true); } catch (e) { ok('clean apply 038: ' + e.message, false); }
  try { await db.exec(MIG('038_fx_and_funding_ledger.sql')); ok('second apply 038 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  ok('5 ledger tables + view',
    (await cnt(db, `SELECT count(*) c FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('exchange_rate_quotes','fx_conversions','funding_transfers','funding_repayments','funding_audit')`)) === 5 &&
    (await cnt(db, `SELECT count(*) c FROM information_schema.views WHERE table_name='personal_funding_balances'`)) === 1);
  ok('transactions.fx_quote_id FK added', (await cnt(db, `SELECT count(*) c FROM pg_constraint WHERE conname='transactions_fx_quote_fk'`)) === 1);

  await db.exec('COMMIT').catch(() => {});
  await reject(db, 'quote rate must be > 0', `INSERT INTO exchange_rate_quotes(provider,base_asset,quote_asset,rate,source_type) VALUES ('p','USD','IDR',0,'market_api')`);
  await reject(db, 'manual quote requires reason', `INSERT INTO exchange_rate_quotes(provider,base_asset,quote_asset,rate,source_type) VALUES ('p','USD','IDR',16000,'manual')`);
  await reject(db, 'quote base<>quote', `INSERT INTO exchange_rate_quotes(provider,base_asset,quote_asset,rate,source_type) VALUES ('p','USD','USD',1,'market_api')`);
  await db.exec(`INSERT INTO exchange_rate_quotes(provider,base_asset,quote_asset,rate,source_type,manual_reason) VALUES ('p','USD','IDR',16300,'manual','backdated bank slip')`).then(() => ok('valid manual quote with reason', true), (e) => ok('valid manual quote: ' + e.message, false));
  await reject(db, 'capital_contribution with repayable=true', `INSERT INTO funding_transfers(relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,source_asset,source_principal_amount,source_total_debit,target_asset,target_amount,idempotency_key) VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,'capital_contribution',true,'USD',1,1,'USD',1,'k')`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
