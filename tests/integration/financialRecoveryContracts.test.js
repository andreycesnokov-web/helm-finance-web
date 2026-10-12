'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{Client}=require('pg');
const {createIntegratedDatabase}=require('./_integratedSchemaDb'),{createRealPgSupabase}=require('./_realPgSupabase');
const B=randomUUID(),C=randomUUID(),P=randomUUID(),W=randomUUID(),V=randomUUID();
const U=-96001,A=-96002,R=-96003,secret='native-recovery-test-only-secret';
let db,sql,supa,server,base,canonical,token;
before(async()=>{
 assert.equal(process.env.HF_EMBEDDED_SQL,'0','recovery contracts require native independent PostgreSQL');
 db=await createIntegratedDatabase('hf_recovery_contracts');sql=new Client({connectionString:db.connectionString});await sql.connect();
 assert.equal((await sql.query("SELECT current_setting('server_version_num')::int n")).rows[0].n,170006);
 canonical=(await import('../../server/lib/financialIntent.mjs')).canonicalFinancialIntent;
 await sql.query('INSERT INTO users(id) VALUES($1),($2),($3)',[U,A,R]);
 await sql.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Recovery A',$4,'business'),($2,'Recovery B',$5,'business'),($3,'Recovery Personal',$4,'personal')",[B,C,P,U,A]);
 await sql.query("INSERT INTO business_members(business_id,user_id,role,status) VALUES($1,$2,'admin','active'),($1,$3,'admin','active')",[B,A,R]);
 await sql.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope) VALUES($1,$3,$4,'Native source','IDR','business'),($2,$3,$4,'Native target','IDR','business')",[W,V,B,U]);
 await sql.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,$2,'income',1000,1000,'IDR',$3,'business','2026-10-01'),($1,$2,'income',1000,1000,'IDR',$4,'business','2026-10-01')",[B,U,W,V]);
 supa=createRealPgSupabase(db.connectionString);
 const mod=require.resolve('@supabase/supabase-js'),actual=require(mod);require.cache[mod]={id:mod,filename:mod,loaded:true,exports:{...actual,createClient:()=>supa}};
 Object.assign(process.env,{PORT:'0',NODE_ENV:'test',JWT_SECRET:secret,SUPABASE_URL:'http://localhost:54321',SUPABASE_SECRET_KEY:'synthetic',BOT_TOKEN:'synthetic',TELEGRAM_WEBHOOK_SECRET:'synthetic',FX_PROVIDER:'mock',PERSONAL_ACCOUNT_V1_ENABLED:'true'});
 const listen=http.Server.prototype.listen,interval=global.setInterval;http.Server.prototype.listen=function(...a){server=this;return listen.apply(this,a)};global.setInterval=(...a)=>{const t=interval(...a);t.unref();return t};
 try{require('../../server/index.js')}finally{http.Server.prototype.listen=listen;global.setInterval=interval}
 if(!server.listening)await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port+'/api';
 token=id=>require('jsonwebtoken').sign({userId:id},secret);
 console.log('native PG17.6 recovery contracts; real Express/SQL adapter, not actual GoTrue/PostgREST; actual stage access tested separately');
});
after(async()=>{
 if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r))}
 await supa?.pool.end();await sql?.end();if(db)await db.drop();
});
async function api(method,path,body,actor=U,business=B,credential=token(actor)){
 const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+credential,'x-business-id':business,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return{status:r.status,body:await r.json()};
}
const get=(op,key,actor=U,business=B)=>api('GET','/financial-operations/'+op+'/'+encodeURIComponent(key),undefined,actor,business);
const walletBody=(key,name='Native recovery '+randomUUID(),opening=10)=>({name,currency:'IDR',type:'bank',scope:'business',opening_balance:opening,request_key:key});
async function snapshot(){return(await sql.query("SELECT jsonb_build_object('ledger',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM transactions t),'wallets',(SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM wallets w),'debts',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY id),'[]') FROM debts d),'receipts',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY business_id,actor_user_id,operation,request_key),'[]') FROM financial_write_requests r),'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM debt_payment_idempotency p)) j")).rows[0].j}
async function debt(){return(await sql.query("INSERT INTO debts(business_id,user_id,type,counterparty,amount,original_amount,currency,scope,approval_status) VALUES($1,$2,'payable','Native recovery vendor',100,100,'IDR','business','approved') RETURNING id",[B,U])).rows[0].id}
test('wallet opening result and receipt commit once; reload credential reads/replays original snapshot without current balance claim',async()=>{
 const key=randomUUID(),body=walletBody(key),r=await api('POST','/wallets',body);assert.equal(r.status,200);
 const before=await snapshot(),read=await get('wallet_create',key);assert.equal(read.status,200);assert.equal(read.body.result.wallet.id,r.body.wallet.id);
 assert.equal(read.body.result_is_historical,true);assert.equal(read.body.not_current_balance,true);assert.deepEqual(await snapshot(),before);
 const replay=await api('POST','/wallets',{...body,opening_balance:'10.00'});assert.equal(replay.status,200);assert.equal(replay.body.is_replay,true);assert.deepEqual(await snapshot(),before);
 const tx=await sql.query('SELECT count(*)::int n,sum(amount_original)::text amount FROM transactions WHERE wallet_id=$1',[r.body.wallet.id]);assert.equal(tx.rows[0].n,1);assert.equal(Number(tx.rows[0].amount),10);
});
test('same key across actors and operation kinds is isolated; other business and unsupported Personal do not expose results',async()=>{
 const key=randomUUID(),one=await api('POST','/wallets',walletBody(key)),two=await api('POST','/wallets',walletBody(key),A);
 assert.equal(one.status,200);assert.equal(two.status,200);assert.notEqual(one.body.wallet.id,two.body.wallet.id);
 const batch=await api('POST','/transactions/batch',{request_key:key,transactions:[{type:'income',amount:3,currency:'IDR',wallet_id:W,scope:'business',description:'typed operation isolation'}]});assert.equal(batch.status,200);
 assert.equal((await get('wallet_create',key)).body.result.wallet.id,one.body.wallet.id);
 assert.equal((await get('wallet_create',key,A)).body.result.wallet.id,two.body.wallet.id);
 assert.equal((await get('transaction_batch',key)).body.result.saved,1);assert.equal((await get('wallet_adjust',key)).status,404);
 assert.equal((await get('wallet_create',key,U,C)).status,403);
 const personal=await get('wallet_create',key,U,P);assert([400,403,409].includes(personal.status));
});
test('payload mismatch and secret-bearing request fail without financial side effects',async()=>{
 const key=randomUUID(),body=walletBody(key);assert.equal((await api('POST','/wallets',body)).status,200);const before=await snapshot();
 const mismatch=await api('POST','/wallets',{...body,opening_balance:11});assert.equal(mismatch.status,409);assert.equal(mismatch.body.error,'idempotency_key_mismatch');
 const secretBody=await api('POST','/wallets',{...walletBody(randomUUID()),token:'do-not-persist-this-credential'});assert.equal(secretBody.status,400);assert.equal(secretBody.body.error,'invalid_financial_intent');
 assert.deepEqual(await snapshot(),before);
});
test('payment uses existing actor-qualified receipt, once/replay/mismatch including same key from another authorized actor',async()=>{
 const d=await debt(),key=randomUUID(),body={amount:7,wallet_id:W,date:'2026-10-01',idempotency_key:key};
 assert.equal((await api('POST','/debts/'+d+'/pay',body)).status,200);const before=await snapshot();
 const read=await get('debt_payment',key);assert.equal(read.status,200);assert.equal(read.body.result.paid_amount,7);
 assert.equal((await get('debt_payment',key,A)).status,404);
 assert.equal((await api('POST','/debts/'+d+'/pay',body)).body.is_replay,true);
 assert.equal((await api('POST','/debts/'+d+'/pay',{...body,amount:8})).status,409);assert.deepEqual(await snapshot(),before);
 assert.equal((await api('POST','/debts/'+d+'/pay',body,A)).status,200);
 assert.equal((await sql.query('SELECT count(*)::int n FROM debt_payment_idempotency WHERE business_id=$1 AND key=$2',[B,key])).rows[0].n,2);
});
test('transfer adds durable atomic original result; same public key from different actors creates isolated leg identities',async()=>{
 const key=randomUUID(),body={from_wallet_id:W,to_wallet_id:V,amount:5,date:'2026-10-01',transfer_id:key,description:'native transfer receipt'};
 const a=await api('POST','/wallets/transfer',body);assert.equal(a.status,201);
 const before=await snapshot(),r=await get('wallet_transfer',key);assert.equal(r.status,200);assert.equal(r.body.result.debit_transaction_id,a.body.debit_transaction_id);
 assert.equal((await api('POST','/wallets/transfer',body)).body.is_replay,true);
 assert.equal((await api('POST','/wallets/transfer',{...body,amount:6})).status,409);assert.deepEqual(await snapshot(),before);
 const b=await api('POST','/wallets/transfer',body,A);assert.equal(b.status,201);assert.notEqual(a.body.transfer_id,b.body.transfer_id);
 for(const id of [a.body.transfer_id,b.body.transfer_id])assert.equal((await sql.query('SELECT count(*)::int n FROM transactions WHERE business_id=$1 AND transfer_id=$2',[B,id])).rows[0].n,2);
});
test('adjustment snapshot remains historical after another money movement; original CAS and original replay both preserved',async()=>{
 const balance=Number((await sql.query('SELECT public.fn_wallet_ledger_balance($1)::text b',[W])).rows[0].b);
 const key=randomUUID(),body={target_balance:balance+20,expected_balance:balance,reason:'native recovery correction',transaction_date:'2026-10-01',request_key:key};
 const first=await api('POST','/wallets/'+W+'/adjust-balance',body);assert.equal(first.status,200);
 assert.equal((await api('POST','/transactions/batch',{request_key:randomUUID(),transactions:[{type:'income',amount:2,currency:'IDR',wallet_id:W,scope:'business',description:'arrived after correction receipt'}]})).status,200);
 const before=await snapshot(),read=await get('wallet_adjust',key);assert.equal(read.body.result.new_balance,balance+20);assert.equal(read.body.not_current_balance,true);
 const replay=await api('POST','/wallets/'+W+'/adjust-balance',body);assert.equal(replay.status,200);assert.equal(replay.body.is_replay,true);assert.deepEqual(await snapshot(),before);
 const stale=await api('POST','/wallets/'+W+'/adjust-balance',{...body,request_key:randomUUID()});assert.equal(stale.status,409);
});
test('removed/archived original object keeps evidence and replay, never creates a replacement',async()=>{
 const key=randomUUID(),body=walletBody(key,undefined,0),first=await api('POST','/wallets',body);assert.equal(first.status,200);
 await sql.query('DELETE FROM wallets WHERE id=$1',[first.body.wallet.id]);const before=await snapshot();
 const read=await get('wallet_create',key);assert.equal(read.status,200);assert.equal(read.body.current_objects[0].state,'removed');
 const replay=await api('POST','/wallets',body);assert.equal(replay.status,200);assert.equal(replay.body.wallet.id,first.body.wallet.id);assert.equal(replay.body.result_is_historical,true);assert.deepEqual(await snapshot(),before);
});
test('revoked membership, changed role and invalid/expired JWT cannot recover an original receipt',async()=>{
 const key=randomUUID(),first=await api('POST','/wallets',walletBody(key),R);assert.equal(first.status,200);
 await sql.query("UPDATE business_members SET status='revoked' WHERE business_id=$1 AND user_id=$2",[B,R]);const before=await snapshot();
 assert.equal((await get('wallet_create',key,R)).status,403);
 for(const credential of ['invalid.jwt.signature',require('jsonwebtoken').sign({userId:U,exp:1},secret)])assert.equal((await api('GET','/financial-operations/recent',undefined,U,B,credential)).status,401);
 const ownKey=randomUUID();await sql.query("UPDATE business_members SET role='auditor' WHERE business_id=$1 AND user_id=$2",[B,A]);
 assert.equal((await get('wallet_create',ownKey,A)).status,403);assert.deepEqual(await snapshot(),before);
 await sql.query("UPDATE business_members SET role='admin' WHERE business_id=$1 AND user_id=$2",[B,A]);
});
test('late receipt failures roll back transfer legs and payment settlement; absence never gives a false confirmed result',async()=>{
 await sql.query("CREATE FUNCTION recovery_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'controlled_late_receipt_failure';END$$");
 await sql.query("CREATE TRIGGER recovery_late_transfer AFTER INSERT ON financial_write_requests FOR EACH ROW WHEN(NEW.operation='wallet_transfer') EXECUTE FUNCTION recovery_late_failure()");
 let key=randomUUID(),before=await snapshot();
 try{assert((await api('POST','/wallets/transfer',{from_wallet_id:W,to_wallet_id:V,amount:4,date:'2026-10-01',transfer_id:key})).status>=400);assert.deepEqual(await snapshot(),before);assert.equal((await get('wallet_transfer',key)).status,404)}
 finally{await sql.query('DROP TRIGGER recovery_late_transfer ON financial_write_requests')}
 await sql.query('CREATE TRIGGER recovery_late_payment AFTER UPDATE OF intent ON debt_payment_idempotency FOR EACH ROW EXECUTE FUNCTION recovery_late_failure()');
 const d=await debt();key=randomUUID();before=await snapshot();
 try{assert((await api('POST','/debts/'+d+'/pay',{amount:3,wallet_id:W,date:'2026-10-01',idempotency_key:key})).status>=400);assert.deepEqual(await snapshot(),before);const missing=await get('debt_payment',key);assert.equal(missing.status,404);assert.equal(missing.body.outcome,'unknown')}
 finally{await sql.query('DROP TRIGGER recovery_late_payment ON debt_payment_idempotency');await sql.query('DROP FUNCTION recovery_late_failure()')}
});
test('recent receipt paging at identical native timestamps is complete, deterministic, actor/type scoped and read-only',async()=>{
 const when='2026-10-12T03:00:00.123456Z';
 for(let i=0;i<28;i++)await sql.query("INSERT INTO financial_write_requests(business_id,actor_user_id,operation,request_key,intent,result,created_at) VALUES($1,$2,'transaction_batch',$3,'[]','{\"saved\":0}',$4)",[B,U,'page-'+String(i).padStart(3,'0'),when]);
 const before=await snapshot(),seen=new Set();let cursor=null;
 for(let page=0;page<10;page++){
  const r=await api('GET','/financial-operations/recent'+(cursor?'?cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);
  for(const row of r.body.operations){const id=row.operation+':'+row.request_key;assert(!seen.has(id));seen.add(id)}
  if(!r.body.has_more)break;assert(r.body.next_cursor);cursor=r.body.next_cursor;
 }
 assert([...Array(28)].every((_,i)=>seen.has('transaction_batch:page-'+String(i).padStart(3,'0'))));assert.deepEqual(await snapshot(),before);
 const readonly=await sql.query('BEGIN READ ONLY');try{await sql.query('SELECT public.rpc_list_own_financial_receipts($1,$2)',[B,U])}finally{await sql.query('ROLLBACK')}
 const grants=await sql.query("SELECT bool_and(NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) closed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('rpc_list_own_financial_receipts','rpc_record_debt_payment_recovery','rpc_execute_wallet_transfer_recovery')");
 assert.equal(grants.rows[0].closed,true);
});
test('two independent native sessions for the same create key produce one wallet/opening/receipt',async()=>{
 const clients=[new Client({connectionString:db.connectionString}),new Client({connectionString:db.connectionString})];await Promise.all(clients.map(c=>c.connect()));
 try{
  const ids=await Promise.all(clients.map(c=>c.query('SELECT pg_backend_pid() p')));assert.notEqual(ids[0].rows[0].p,ids[1].rows[0].p);
  const key=randomUUID(),body=walletBody(key),identity=canonical('wallet_create',body);
  const args=[B,U,key,JSON.stringify(identity),JSON.stringify({name:body.name,currency:'IDR',type:'bank',scope:'business'}),JSON.stringify({type:'income',amount_original:10,currency_original:'IDR',amount_idr:10,booked_rate:1,rate_source:'base_currency',description:'native session race opening'})];
  const results=await Promise.all(clients.map(c=>c.query('SELECT public.rpc_create_business_wallet($1,$2,$3,$4,$5,$6) j',args)));
  assert.equal(results[0].rows[0].j.wallet.id,results[1].rows[0].j.wallet.id);
  const count=await sql.query('SELECT count(*)::int n,sum(amount_original)::text amount FROM transactions WHERE wallet_id=$1',[results[0].rows[0].j.wallet.id]);assert.equal(count.rows[0].n,1);assert.equal(Number(count.rows[0].amount),10);
  assert.equal((await sql.query("SELECT count(*)::int n FROM financial_write_requests WHERE business_id=$1 AND actor_user_id=$2 AND operation='wallet_create' AND request_key=$3",[B,U,key])).rows[0].n,1);
 }finally{await Promise.all(clients.map(c=>c.end()))}
});
