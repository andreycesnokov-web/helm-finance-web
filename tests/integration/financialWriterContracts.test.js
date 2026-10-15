'use strict';
// Default: real PostgreSQL, full schema, fresh disposable DB. Never silently skip.
// HF_EMBEDDED_SQL=1 is a separately labelled single-connection SQL smoke only:
// NO independent sessions, lock/timeout/load or PostgREST/JWT/RLS certification.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createIntegratedDatabase, migrations } = require('./_integratedSchemaDb');
const { createRealPgSupabase, createSqlSupabase } = require('./_realPgSupabase');
const embedded = process.env.HF_EMBEDDED_SQL === '1';
const mode = embedded ? 'EMBEDDED SQL smoke (no concurrency proof)' : 'REAL PostgreSQL';
const root = path.resolve(__dirname, '../..');
const B=randomUUID(), C=randomUUID(), P=randomUUID(), U=randomUUID(), I=randomUUID();
const owner=85001, secret='local-writer-contract-test-secret';
let db, sql, supa, server, base, token;
before(async () => {
  console.log(mode);
  if (embedded) {
    const { PGlite }=require('@electric-sql/pglite');
    sql=new PGlite(); await sql.waitReady;
    await sql.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await sql.exec(fs.readFileSync(path.join(root,'tests/fixtures/schema/prod_public_schema_2026-10-08.sql'),'utf8'));
    for(const m of migrations.filter(m=>!process.env.HF_BASELINE_SERVER || !m.includes('financial_writer_protocol'))) await sql.exec(fs.readFileSync(path.join(root,'migrations',m),'utf8'));
    supa=createSqlSupabase({query:(...a)=>sql.query(...a),end:async()=>{}});
  } else {
    db=await createIntegratedDatabase('hf_writer_contracts');
    const { Client }=require('pg'); sql=new Client({connectionString:db.connectionString}); await sql.connect();
    supa=createRealPgSupabase(db.connectionString);
  }
  await sql.query('SET search_path=public,pg_catalog');
  console.log(JSON.stringify({node:process.version,postgres:(await sql.query('SHOW server_version')).rows[0].server_version,
    qualification:embedded?'single-session SQL smoke; not PG17 concurrency/PostgREST/JWT/RLS':'real PostgreSQL with HTTP SQL adapter; not PostgREST/JWT/RLS'}));
  await sql.query('INSERT INTO users(id) VALUES($1)',[owner]);
  await sql.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Contract A',$4,'business'),($2,'Contract B',$4,'business'),($3,'Personal',$4,'personal')",[B,C,P,owner]);
  for(const b of [B,C,P]) await sql.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')",[b,owner]);
  await sql.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$3,$4,'Wise USD','USD','business'),($2,$3,$4,'Bank IDR','IDR','business')",[U,I,B,owner]);
  await sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,$2,'income',2000,32600000,'USD',$3,'business','2026-10-01'),($1,$2,'income',10000000,10000000,'IDR',$4,'business','2026-10-01')",[B,owner,U,I]);
  const mod=require.resolve('@supabase/supabase-js'); const actual=require(mod);
  require.cache[mod]={id:mod,filename:mod,loaded:true,exports:{...actual,createClient:()=>supa}};
  Object.assign(process.env,{PORT:'0',NODE_ENV:'test',JWT_SECRET:secret,SUPABASE_URL:'http://localhost:54321',SUPABASE_SECRET_KEY:'synthetic',BOT_TOKEN:'synthetic',TELEGRAM_WEBHOOK_SECRET:'synthetic',FX_PROVIDER:'mock',PERSONAL_ACCOUNT_V1_ENABLED:'true'});
  const listen=http.Server.prototype.listen, interval=global.setInterval;
  http.Server.prototype.listen=function(...a){server=this;return listen.apply(this,a)};
  global.setInterval=(...a)=>{const t=interval(...a);t.unref();return t};
  try{require(process.env.HF_BASELINE_SERVER || '../../server/index.js')}finally{http.Server.prototype.listen=listen;global.setInterval=interval}
  if(!server.listening) await new Promise(r=>server.once('listening',r));
  base=`http://127.0.0.1:${server.address().port}/api`;
  token=require('jsonwebtoken').sign({userId:owner},secret);
});
after(async()=>{
  if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r))}
  await supa?.pool.end(); if(embedded) await sql?.close();else {await sql?.end();if(db) await db.drop()}
});
async function api(method,url,body,b=B,actorToken=token){const r=await fetch(base+url,{method,headers:{authorization:`Bearer ${actorToken}`,'x-business-id':b,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()}}
async function debt(amount=1000){return (await sql.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope,approval_status) VALUES($1,$2,'payable','Synthetic Vendor',$3,$3,'USD','business','approved') RETURNING id",[B,owner,amount])).rows[0].id}
async function state(id){return (await sql.query('SELECT to_json(d) j FROM debts d WHERE id=$1',[id])).rows[0].j}
async function rows(){return Number((await sql.query('SELECT count(*) n FROM transactions')).rows[0].n)}
test(`${mode}: staging catalog is metadata-only and runs in a read-only transaction`,async()=>{
  const catalog=fs.readFileSync(path.join(__dirname,'stagingSchemaCatalog.sql'),'utf8');
  // The authoritative public fixture has no policies. Add one synthetic policy
  // to exercise role-name resolution without enabling RLS or changing data.
  await sql.query('CREATE POLICY catalog_probe_policy ON users FOR SELECT TO authenticated USING (true)');
  let result;
  try { result=embedded?await sql.exec(catalog):await sql.query(catalog); }
  finally { await sql.query('ROLLBACK');await sql.query('DROP POLICY catalog_probe_policy ON users'); }
  const entries=result.flatMap(r=>r.rows||[]);
  assert.equal(entries.find(r=>r.category==='runtime').item.transaction_read_only,'on');
  for(const category of ['relations','columns','constraints','functions','triggers','indexes','policies','schema_acl','roles','sequences']){
    assert.ok(entries.some(r=>r.category===category),`Missing ${category}`);
  }
  const writer=entries.find(r=>r.category==='functions'&&r.item.name==='rpc_insert_business_transactions_once');
  assert.ok(writer);assert.match(writer.item.definition_hash,/^[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(writer.item,'body'),false);
  assert.deepEqual(entries.find(r=>r.category==='policies'&&r.item.name==='catalog_probe_policy').item.roles,['authenticated']);
});
test(`${mode}: partial/full USD + replay preserve native amount, settlement and HTTP contract`,async()=>{
  const id=await debt(); const before=await rows();
  const partial={amount:400,wallet_id:U,date:'2026-10-04',idempotency_key:randomUUID()};
  const a=await api('POST',`/debts/${id}/pay`,partial);
  assert.equal(a.status,200,JSON.stringify(a));assert.equal(a.body.isFullyPaid,false);assert.equal(a.body.remaining,600);
  assert.equal((await state(id)).is_settled,false);
  const full={...partial,amount:600,idempotency_key:randomUUID()};
  const b=await api('POST',`/debts/${id}/pay`,full);
  assert.equal(b.status,200,JSON.stringify(b));assert.equal(b.body.isFullyPaid,true);assert.equal(b.body.remaining,0);
  const d=await state(id);assert.equal(Number(d.paid_amount),1000);assert.equal(d.is_settled,true);assert.ok(d.settled_at);
  const repeat=await api('POST',`/debts/${id}/pay`,full);assert.equal(repeat.status,200);assert.equal(repeat.body.is_replay,true);assert.equal(repeat.body.isFullyPaid,true);
  assert.equal(await rows(),before+2);
  await assert.rejects(sql.query('UPDATE debts SET original_amount=999,amount=999 WHERE id=$1',[id]),/invalid_amount/);
  await assert.rejects(sql.query("UPDATE debts SET currency='IDR' WHERE id=$1",[id]),/debt_metadata_locked/);
  const txs=(await sql.query('SELECT amount_original::text a,currency_original,wallet_id FROM transactions WHERE debt_payment_id=$1 ORDER BY id',[id])).rows;
  assert.deepEqual(txs.map(t=>[Number(t.a),t.currency_original,t.wallet_id]),[[400,'USD',U],[600,'USD',U]]);
});
test(`${mode}: scenarios 9/12 reject unknown wallet, keep debt/ledger unchanged, explicit selection completes`,async()=>{
  const id=await debt(500);const old=await state(id),n=await rows();
  for(const account of ['Petty Cash USD','External Wire']){
    const r=await api('POST',`/debts/${id}/pay`,{amount:100,account,date:'2026-10-04',idempotency_key:randomUUID()});
    assert.equal(r.status,400);assert.equal(r.body.error,'wallet_required');assert.deepEqual(await state(id),old);assert.equal(await rows(),n);
  }
  const r=await api('POST',`/debts/${id}/pay`,{amount:100,wallet_id:U,date:'2026-10-04',idempotency_key:randomUUID()});assert.equal(r.status,200,JSON.stringify(r));assert.equal(await rows(),n+1);
});
test(`${mode}: same-name legacy resolves explicit USD wallet; wrong currency never mutates`,async()=>{
  const id=await debt(200);const old=await state(id),n=await rows();
  const bad=await api('POST',`/debts/${id}/pay`,{amount:10,account:'Bank IDR',idempotency_key:randomUUID()});assert.equal(bad.status,400);assert.equal(bad.body.error,'cross_currency_not_supported');assert.deepEqual(await state(id),old);assert.equal(await rows(),n);
  const good=await api('POST',`/debts/${id}/pay`,{amount:10,account:'Wise USD',idempotency_key:randomUUID()});assert.equal(good.status,200,JSON.stringify(good));
  assert.equal((await sql.query('SELECT wallet_id FROM transactions WHERE debt_payment_id=$1',[id])).rows[0].wallet_id,U);
});
test(`${mode}: full IDR settlement retains native amount, wallet, settlement and keyed replay`,async()=>{
  const id=(await sql.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope,approval_status) VALUES($1,$2,'payable','IDR Vendor',25000,25000,'IDR','business','approved') RETURNING id",[B,owner])).rows[0].id;
  const body={amount:25000,wallet_id:I,idempotency_key:randomUUID()},n=await rows();
  const r=await api('POST',`/debts/${id}/pay`,body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.isFullyPaid,true);
  const d=await state(id);assert.equal(Number(d.paid_amount),25000);assert.equal(d.is_settled,true);
  assert.equal((await api('POST',`/debts/${id}/pay`,body)).body.is_replay,true);assert.equal(await rows(),n+1);
  const t=(await sql.query('SELECT amount_original::text a,currency_original,wallet_id FROM transactions WHERE debt_payment_id=$1',[id])).rows[0];assert.deepEqual(t,{a:'25000.00',currency_original:'IDR',wallet_id:I});
});
test(`${mode}: atomic wallet opening and manual create receipts prevent duplicate unknown-outcome repeats`,async()=>{
  const key=randomUUID(),body={name:'Receipt Wallet',currency:'IDR',opening_balance:500,request_key:key};
  const n=await rows(),a=await api('POST','/wallets',body);assert.equal(a.status,200,JSON.stringify(a));assert.ok(a.body.wallet.id);
  const b=await api('POST','/wallets',body);assert.equal(b.status,200,JSON.stringify(b));assert.equal(b.body.is_replay,true);assert.equal(b.body.wallet.id,a.body.wallet.id);assert.equal(await rows(),n+1);
  const mismatch=await api('POST','/wallets',{...body,opening_balance:600});assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'idempotency_key_mismatch');assert.equal(await rows(),n+1);
  const exec=embedded?sql.exec.bind(sql):sql.query.bind(sql);
  await exec("CREATE FUNCTION test_fail_opening() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_opening_balance THEN RAISE EXCEPTION 'opening_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_opening AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION test_fail_opening();");
  const failed=await api('POST','/wallets',{name:'Rollback Wallet',currency:'IDR',opening_balance:9,request_key:randomUUID()});assert.equal(failed.status,500);assert.match(failed.body.error,/opening_failure/);
  assert.equal(Number((await sql.query("SELECT count(*) n FROM wallets WHERE name='Rollback Wallet'")).rows[0].n),0);assert.equal(await rows(),n+1);
  await exec('DROP TRIGGER test_fail_opening ON transactions; DROP FUNCTION test_fail_opening();');
  const empty={name:'Removed receipt wallet',currency:'IDR',request_key:randomUUID()},e=await api('POST','/wallets',empty);assert.equal(e.status,200);
  await sql.query('DELETE FROM wallets WHERE id=$1',[e.body.wallet.id]);
  const removed=await api('POST','/wallets',empty);assert.equal(removed.status,200);assert.equal(removed.body.is_replay,true);assert.equal(removed.body.result_is_historical,true);assert.equal(removed.body.wallet.id,e.body.wallet.id);assert.equal(removed.body.recovery.current_objects[0].state,'removed');assert.equal(await rows(),n+1);
  const tx={type:'income',amount:17,currency:'IDR',wallet_id:I,scope:'business',date:'2026-10-05',description:'Receipt transaction'},batch={transactions:[tx],request_key:randomUUID()};
  assert.equal((await api('POST','/transactions/batch',batch)).status,200);assert.equal((await api('POST','/transactions/batch',batch)).status,200);assert.equal(await rows(),n+2);
  const bad=await api('POST','/transactions/batch',{...batch,transactions:[{...tx,amount:18}]});assert.equal(bad.status,409);assert.equal(bad.body.error,'idempotency_key_mismatch');assert.equal(await rows(),n+2);
  const unkeyed=await api('POST','/transactions/batch',{transactions:[tx]});assert.equal(unkeyed.status,400);assert.equal(unkeyed.body.error,'idempotency_key_required');assert.equal(await rows(),n+2);
});
test(`${mode}: unsafe legacy user-wide writers are refused without changing Personal or Business history`,async()=>{
  const n=await rows();for(const path of ['/wallets/backfill','/accounts','/accounts/adjust','/accounts/rename','/accounts/delete']){
    const r=await api('POST',path,{name:'Wise USD',oldName:'Wise USD',newName:'Changed',diff:5,balance:5,type:'personal'});assert.equal(r.status,409);assert.equal(r.body.error,'legacy_wallet_review_required');assert.equal(await rows(),n);
  }
});
test(`${mode}: adjustment uses compare-and-set under gate; repeat does not apply a second correction`,async()=>{
  const body={target_balance:510,reason:'Synthetic reviewed target',request_key:randomUUID()};
  const r=await api('POST','/wallets/'+I+'/adjust-balance',body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.new_balance,510);
  const n=await rows();assert.equal((await api('POST','/wallets/'+I+'/adjust-balance',body)).body.is_replay,true);assert.equal(await rows(),n);
  await assert.rejects(sql.query('SELECT rpc_adjust_business_wallet($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)',[B,owner,I,randomUUID(),JSON.stringify({target_balance:520}),509,520,JSON.stringify({amount_original:11,currency_original:'IDR',amount_idr:11,booked_rate:1,rate_source:'identity'})]),/transaction_version_conflict/);assert.equal(await rows(),n);
  assert.equal(Number((await sql.query('SELECT fn_wallet_ledger_balance($1) b',[I])).rows[0].b),510);
});
test(`${mode}: unchecked settled flag and legacy settle endpoint cannot invent payment`,async()=>{
  const r=await api('POST','/debts',{type:'payable',counterparty:'Unpaid synthetic',amount:20,currency:'IDR',scope:'business',is_settled:true,settled_at:'2026-10-04',paid_amount:20,status:'paid'});
  assert.equal(r.status,200,JSON.stringify(r));const id=r.body.id,n=await rows();
  const d=await state(id);assert.equal(d.is_settled,false);assert.equal(d.settled_at,null);assert.equal(Number(d.paid_amount),0);
  const pretend=await api('PATCH',`/debts/${id}/settle`,{});assert.equal(pretend.status,409);assert.equal(pretend.body.error,'confirmed_payment_required');assert.equal(await rows(),n);assert.deepEqual(await state(id),d);
});

test(`${mode}: HTTP correction respects the displayed snapshot after a separately committed inflow`,async()=>{
  const reviewed=Number((await sql.query('SELECT fn_wallet_ledger_balance($1) b',[I])).rows[0].b);
  const inflow=await api('POST','/transactions/batch',{request_key:randomUUID(),transactions:[{type:'income',amount:1,currency:'IDR',wallet_id:I,scope:'business',description:'Committed after correction form review'}]});
  assert.equal(inflow.status,200,JSON.stringify(inflow));
  const n=await rows(),key=randomUUID();
  const receipts=Number((await sql.query('SELECT count(*) n FROM financial_write_requests')).rows[0].n);
  const stale=await api('POST','/wallets/'+I+'/adjust-balance',{target_balance:reviewed+10,expected_balance:reviewed,reason:'Stale displayed balance',request_key:key});
  assert.equal(stale.status,409,JSON.stringify(stale));assert.equal(stale.body.error,'transaction_version_conflict');
  assert.equal(await rows(),n);assert.equal(Number((await sql.query('SELECT fn_wallet_ledger_balance($1) b',[I])).rows[0].b),reviewed+1);
  assert.equal(Number((await sql.query('SELECT count(*) n FROM financial_write_requests')).rows[0].n),receipts);
  for(const expected_balance of [null,'not-a-number','Infinity',{}]){
    const bad=await api('POST','/wallets/'+I+'/adjust-balance',{target_balance:reviewed+10,expected_balance,reason:'Invalid review snapshot',request_key:randomUUID()});
    assert.equal(bad.status,400);assert.equal(bad.body.error,'invalid_expected_balance');assert.equal(await rows(),n);
  }
  const body={target_balance:reviewed+10,expected_balance:reviewed+1,reason:'Explicit refreshed review',request_key:randomUUID()};
  const accepted=await api('POST','/wallets/'+I+'/adjust-balance',body);assert.equal(accepted.status,200,JSON.stringify(accepted));
  assert.equal(accepted.body.delta,9);assert.equal(await rows(),n+1);
  const replay=await api('POST','/wallets/'+I+'/adjust-balance',body);assert.equal(replay.status,200);assert.equal(replay.body.is_replay,true);assert.equal(await rows(),n+1);
});
test(`${mode}: new payment/transfer without stable key is refused, including guarded SQL entry`,async()=>{
  const id=await debt(40),n=await rows(),old=await state(id);
  const noKey=await api('POST',`/debts/${id}/pay`,{amount:10,wallet_id:U});assert.equal(noKey.status,400);assert.equal(noKey.body.error,'idempotency_key_required');assert.deepEqual(await state(id),old);assert.equal(await rows(),n);
  await assert.rejects(sql.query("SELECT rpc_record_debt_payment_guarded($1,$2,$3,$4,10,'USD',163000,16300,'identity','2026-10-04',NULL,'hash')",[B,owner,id,U]),/idempotency_key_required/);assert.equal(await rows(),n);
  const transfer=await api('POST','/wallets/transfer',{from_wallet_id:U,to_wallet_id:I,amount:1,target_amount:16300,date:'2026-10-04'});assert.equal(transfer.status,400);assert.equal(transfer.body.error,'idempotency_key_required');assert.equal(await rows(),n);
});
test(`${mode}: metadata cannot reinterpret explicit or NULL-wallet money; no history rewrite`,async()=>{
  const currency=await api('PUT',`/wallets/${U}`,{currency:'IDR'});assert.equal(currency.status,409);assert.equal(currency.body.error,'wallet_metadata_locked');
  await sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,source,scope) VALUES($1,$2,'income',5,81500,'USD','Wise USD','business')",[B,owner]);
  const rename=await api('PUT',`/wallets/${U}`,{name:'Renamed USD'});assert.equal(rename.status,409);assert.equal(rename.body.error,'wallet_legacy_name_locked');
  const w=(await sql.query('SELECT name,currency FROM wallets WHERE id=$1',[U])).rows[0];assert.deepEqual(w,{name:'Wise USD',currency:'USD'});
  const displayType=await api('PUT',`/wallets/${U}`,{type:'bank'});assert.equal(displayType.status,200);
  const policy=await api('PUT',`/wallets/${U}`,{type:'credit_line'});assert.equal(policy.status,409);assert.equal(policy.body.error,'wallet_metadata_locked');
  assert.equal(Number((await sql.query("SELECT count(*) n FROM transactions WHERE source='Wise USD' AND wallet_id IS NULL")).rows[0].n),1);
  await assert.rejects(sql.query("UPDATE wallets SET scope='personal' WHERE id=$1",[U]),/wallet_scope_mismatch/);
});
test(`${mode}: duplicate wallet names and silent legacy reattachment are refused`,async()=>{
  await assert.rejects(sql.query("INSERT INTO wallets(business_id,user_id,name,currency,scope) VALUES($1,$2,'Wise USD','USD','business')",[B,owner]),/wallet_name_ambiguous/);
  await sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,source,scope) VALUES($1,$2,'income',7,114100,'USD','Legacy orphan','business')",[B,owner]);
  await assert.rejects(sql.query("INSERT INTO wallets(business_id,user_id,name,currency,scope) VALUES($1,$2,'Legacy orphan','USD','business')",[B,owner]),/wallet_legacy_binding_requires_review/);
});
test(`${mode}: archive blocks NEW payment, existing keyed replay remains readable`,async()=>{
  const id=await debt(50), body={amount:10,wallet_id:U,idempotency_key:randomUUID()};
  assert.equal((await api('POST',`/debts/${id}/pay`,body)).status,200);
  await sql.query('UPDATE wallets SET is_active=false WHERE id=$1',[U]);const n=await rows(),old=await state(id);
  assert.equal((await api('POST',`/debts/${id}/pay`,body)).body.is_replay,true);
  const r=await api('POST',`/debts/${id}/pay`,{...body,idempotency_key:randomUUID()});assert.equal(r.status,409);assert.equal(r.body.error,'wallet_inactive');assert.deepEqual(await state(id),old);assert.equal(await rows(),n);
  await sql.query('UPDATE wallets SET is_active=true WHERE id=$1',[U]);
});
test(`${mode}: delete RPC refuses financial data/Personal/last business and accepts empty extra Business`,async()=>{
  const blocked=await api('DELETE',`/businesses/${B}`,{confirm:'DELETE BUSINESS'});assert.equal(blocked.status,409);assert.equal(blocked.body.error,'business_not_empty');
  const personal=await api('DELETE',`/businesses/${P}`,{confirm:'DELETE BUSINESS'},P);assert.equal(personal.status,403);
  const ok=await api('DELETE',`/businesses/${C}`,{confirm:'DELETE BUSINESS'},C);assert.equal(ok.status,200,JSON.stringify(ok));assert.equal(ok.body.next_business_id,B);
  const last=await api('DELETE',`/businesses/${B}`,{confirm:'DELETE BUSINESS'});assert.equal(last.status,409);assert.equal(last.body.error,'last_business');
});
test(`${mode}: late SQL exception rolls back ledger and debt; provenance and balance remain guarded`,async()=>{
  const n=await rows(); const exec=embedded?sql.exec.bind(sql):sql.query.bind(sql);
  await assert.rejects(exec(`DO $$ BEGIN INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope) VALUES('${B}',${owner},'income',1,1,'IDR','${I}','business'); RAISE EXCEPTION 'late_failure'; END $$;`),/late_failure/);assert.equal(await rows(),n);
  await assert.rejects(sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope) VALUES($1,$2,'expense',99999999,99999999,'IDR',$3,'business')",[B,owner,I]),/insufficient_balance/);
  await assert.rejects(sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,bank_import_row_id) VALUES($1,$2,'expense',1,1,'IDR',$3,'business',$4)",[B,owner,I,randomUUID()]),/invalid_import_provenance/);assert.equal(await rows(),n);
});

test(`${mode}: controlled HTTP error mapping (injected SQLSTATE/transport/missing RPC, not a concurrency proof)`,async()=>{
  const id=await debt(100), n=await rows(), old=await state(id), original=supa.rpc;
  try {
    for(const [code,expected,outcome] of [['40P01',409,'rolled_back'],['55P03',409,'rolled_back'],['57014',409,'rolled_back'],['ECONNRESET',503,'unknown'],['PGRST202',503,null]]) {
      supa.rpc=async()=>({data:null,error:{code,message:code==='PGRST202'?'Could not find function in schema cache':'synthetic fault'}});
      const r=await api('POST',`/debts/${id}/pay`,{amount:10,wallet_id:U,idempotency_key:randomUUID()});
      assert.equal(r.status,expected,JSON.stringify(r));if(outcome){assert.equal(r.body.outcome,outcome);assert.equal(r.body.automatic_retry,false)}
      assert.equal(await rows(),n);assert.deepEqual(await state(id),old);
    }
  } finally {supa.rpc=original}
});
test(`${mode}: read-only preflight runs on full schema without mutating synthetic money`,async()=>{
  const n=await rows();const exec=embedded?sql.exec.bind(sql):sql.query.bind(sql);
  const preflight=fs.readFileSync(path.join(root,'tests/integration/financialWriterPreflight.sql'),'utf8');
  await exec(preflight);assert.equal(await rows(),n);
  // The same preflight must report missing prerequisites on the authoritative
  // pre-069 base, rather than abort or pretend its provenance counts are zero.
  let baseDb,baseSql;
  try {
    if(embedded){const {PGlite}=require('@electric-sql/pglite');baseSql=new PGlite();await baseSql.waitReady;await baseSql.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');await baseSql.exec(fs.readFileSync(path.join(root,'tests/fixtures/schema/prod_public_schema_2026-10-08.sql'),'utf8'));}
    else {baseDb=await require('./_prodSchemaDb').createProdSchemaDatabase('hf_preflight_base');assert.ok(baseDb);baseSql=new(require('pg').Client)({connectionString:baseDb.connectionString});await baseSql.connect();}
    const column=await baseSql.query("SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='bank_import_row_id'");assert.equal(Number(column.rows[0].n),0);
    const results=await (embedded?baseSql.exec(preflight):baseSql.query(preflight));
    assert.ok(results.some(r=>r.rows?.some(row=>row.name==='rpc_create_business_wallet'&&Number(row.signatures_present)===0)));
    assert.equal(Number((await baseSql.query('SELECT count(*) n FROM public.transactions')).rows[0].n),0);
  } finally {if(embedded)await baseSql?.close();else {await baseSql?.end();if(baseDb)await baseDb.drop();}}
});
test(`${mode}: failed Personal delete cannot report success or affect Business money`,async()=>{
  const pw=randomUUID();
  await sql.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Personal delete test','IDR','personal')",[pw,P,owner]);
  const id=(await sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope) VALUES($1,$2,'income',3,3,'IDR',$3,'personal') RETURNING id",[P,owner,pw])).rows[0].id;
  const n=await rows();const exec=embedded?sql.exec.bind(sql):sql.query.bind(sql);
  await exec(`CREATE FUNCTION test_personal_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id=${id} THEN RAISE EXCEPTION 'synthetic_lock_timeout' USING ERRCODE='55P03'; END IF; RETURN OLD; END $$; CREATE TRIGGER test_personal_delete_failure BEFORE DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION test_personal_delete_failure();`);
  try {
    const r=await api('DELETE',`/personal/transactions/${id}`,undefined,P);
    assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.outcome,'rolled_back');assert.equal(r.body.error,'financial_lock_timeout');assert.equal(await rows(),n);
    const boundary=await api('DELETE',`/personal/transactions/${id}`,undefined,B);assert.equal(boundary.status,409);assert.equal(boundary.body.error,'personal_workspace_required');assert.equal(await rows(),n);
  } finally {await exec('DROP TRIGGER test_personal_delete_failure ON transactions; DROP FUNCTION test_personal_delete_failure()');}
});
test(`${mode}: existing businessIsolation script executes all assertions in disposable full-schema HTTP harness`,async()=>{
  const vm=require('node:vm'),logs=[];let exitCode=null;
  const fakeProcess={env:{...process.env,BASE_URL:base.replace(/\/api$/,''),JWT_SECRET:secret,ISO_TEST_USER:String(owner),SUPABASE_URL:'http://localhost:54321',SUPABASE_SECRET_KEY:'synthetic'},exit:code=>{exitCode=code}};
  const program=fs.readFileSync(path.join(root,'tests/integration/businessIsolation.test.js'),'utf8');
  const finished=vm.runInNewContext(program,{require,process:fakeProcess,fetch,URL,console:{log:s=>{logs.push(String(s));console.log('[existing isolation] '+s)}}});
  await finished;assert.equal(exitCode,0,logs.join('\n'));assert.ok(logs.some(s=>/ALL PASS/.test(s)));assert.ok(!logs.some(s=>/SKIP/.test(s)),logs.join('\n'));
  const result=logs.find(s=>/ALL PASS/.test(s))?.match(/(\d+) passed, (\d+) failed/);
  assert.ok(result&&Number(result[1])>0&&Number(result[2])===0);
  assert.equal(logs.filter(s=>/^OK\s/.test(s)).length,Number(result[1]),'Nested assertion count must match its executed success records');
});

test(`${mode}: durable receipt scopes and response lost AFTER SQL commit preserve one booking`,async()=>{
  const collaborator=85002,other=randomUUID(),otherWallet=randomUUID(),key=randomUUID();
  await sql.query('INSERT INTO users(id) VALUES($1)',[collaborator]);
  await sql.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'cfo','active')",[B,collaborator]);
  await sql.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Receipt other Business',$2,'business')",[other,owner]);
  await sql.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'owner','active')",[other,owner]);
  await sql.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$2,$3,'Receipt other cash','IDR','business')",[otherWallet,other,owner]);
  const collaboratorToken=require('jsonwebtoken').sign({userId:collaborator},secret);
  const row={type:'income',amount:7,currency:'IDR',wallet_id:I,scope:'business',date:'2026-10-06',description:'Lost response after commit'};
  const body={transactions:[row],request_key:key},before=await rows(),original=supa.rpc;
  try {
    supa.rpc=async(name,args)=>{const result=await original(name,args);return name==='rpc_insert_business_transactions_once'&&!result.error?{data:null,error:{code:'ECONNRESET',message:'synthetic response lost after committed RPC'}}:result};
    const lost=await api('POST','/transactions/batch',body,B,collaboratorToken);assert.equal(lost.status,503);assert.equal(lost.body.outcome,'unknown');
  } finally {supa.rpc=original}
  assert.equal(await rows(),before+1);
  assert.equal(Number((await sql.query('SELECT count(*) n FROM financial_write_requests WHERE actor_user_id=$1 AND request_key=$2',[collaborator,key])).rows[0].n),1);
  await sql.query("UPDATE business_members SET role='auditor' WHERE business_id=$1 AND user_id=$2",[B,collaborator]);
  const refused=await api('POST','/transactions/batch',body,B,collaboratorToken);assert.equal(refused.status,403);assert.equal(await rows(),before+1);
  await sql.query("UPDATE business_members SET role='cfo' WHERE business_id=$1 AND user_id=$2",[B,collaborator]);
  const replay=await api('POST','/transactions/batch',body,B,collaboratorToken);assert.equal(replay.status,200);assert.equal(replay.body.is_replay,true);assert.equal(await rows(),before+1);
  const mismatch=await api('POST','/transactions/batch',{...body,transactions:[{...row,amount:8}]},B,collaboratorToken);assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'idempotency_key_mismatch');assert.equal(await rows(),before+1);
  // Same textual key in a different actor/business is a different authorized
  // intent, and cannot replay or reveal the first actor's result.
  const otherActor=await api('POST','/transactions/batch',{...body,transactions:[{...row,amount:9}]});assert.equal(otherActor.status,200);assert.ok(!otherActor.body.is_replay);assert.equal(await rows(),before+2);
  const otherBusiness=await api('POST','/transactions/batch',{...body,transactions:[{...row,wallet_id:otherWallet}]},other);assert.equal(otherBusiness.status,200);assert.ok(!otherBusiness.body.is_replay);assert.equal(await rows(),before+3);
  const inaccessible=await api('POST','/transactions/batch',body,other,collaboratorToken);assert.equal(inaccessible.status,403);assert.equal(await rows(),before+3);
  const created=(await sql.query("SELECT rpc_create_business_wallet($1,$2,$3,$4::jsonb,$4::jsonb,NULL) r",[B,owner,key,JSON.stringify({name:'Separate wallet operation',currency:'IDR',type:'bank',scope:'business'})])).rows[0].r;assert.ok(created.wallet.id);assert.equal(await rows(),before+3);
  try {await sql.query('SET ROLE authenticated');await assert.rejects(sql.query('SELECT * FROM public.financial_write_requests'),e=>e.code==='42501');}
  finally {await sql.query('RESET ROLE')}
  assert.equal(Number((await sql.query('SELECT count(*) n FROM financial_write_requests WHERE request_key=$1',[key])).rows[0].n),4);
});
