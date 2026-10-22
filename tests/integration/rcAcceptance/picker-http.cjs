'use strict';
// Real application HTTP -> PostgREST -> PG17.6 + private Storage. No route mocking.
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID,createHash}=require('node:crypto'),{Client}=require('pg');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),BASE=process.env.BASE_URL,results=[];
const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:4000});
const save=()=>fs.writeFileSync('/evidence/PICKER_HTTP.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',mock_api:false,cluster:C.cluster,results},null,2));
const pass=(name,detail={})=>{results.push({case:name,status:'PASS',...detail});save();console.log('PASS '+name)};
async function api(path,{method='GET',body,actor=C.owner,biz=C.biz}={}){
 const r=await fetch(BASE+'/api'+path,{method,headers:{authorization:'Bearer '+actor.token,'x-business-id':biz,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});let data;try{data=await r.json()}catch{data={error:'non_json'}}return {status:r.status,data};
}
async function snap(){return(await db.query("SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) hash FROM transactions t WHERE business_id=$1",[C.biz])).rows[0]}
async function linkCounts(doc){return(await db.query("SELECT (SELECT count(*)::int FROM document_transaction_links WHERE document_id=$1) links,(SELECT count(*)::int FROM document_audit WHERE document_id=$1 AND action='linked') audits",[doc])).rows[0]}
(async()=>{await db.connect();assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id,C.cluster);
 if(!C.pickerSeed){
  // Synthetic pre-existing bank truth, before measuring the no-cash linking invariant.
  await db.query("INSERT INTO transactions(business_id,user_id,created_by_user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description,source,is_opening_balance) VALUES($1,$2,$2,'income',200000000,200000000,'IDR',$3,'business','2026-07-31','RC synthetic opening fixture','wallet_opening_balance',true)",[C.biz,C.owner.user.id,C.wallet]);
  await db.query("INSERT INTO transactions(business_id,user_id,created_by_user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date,description) SELECT $1,$2,$2,'expense',100000+i,100000+i,'IDR',$3,'business',date '2026-08-01'+(i%28),'RC synthetic bank row '||i FROM generate_series(1,1205) i",[C.biz,C.owner.user.id,C.wallet]);
  C.target=Number((await db.query("SELECT min(id) id FROM transactions WHERE business_id=$1 AND type='expense'",[C.biz])).rows[0].id);
  C.foreignTx=Number((await db.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,scope,transaction_date,description) VALUES($1,$2,'expense',100001,100001,'IDR','business','2026-08-02','RC foreign row') RETURNING id",[C.foreign,C.other.user.id])).rows[0].id);
  C.pickerSeed=true;fs.writeFileSync('/tmp/acceptance-session.json',JSON.stringify(C),{mode:0o600});
 }
 const before=await snap();let pages=[],cursor=null;
 do{const r=await api('/transactions?period=all&include_document_status=true&limit=500'+(cursor?'&before_id='+cursor:''));assert.equal(r.status,200,JSON.stringify(r));assert.ok(Array.isArray(r.data));assert.ok(r.data.every(x=>x.business_id===C.biz));pages.push(...r.data);cursor=r.data.length===500?r.data.at(-1).id:null;}while(cursor);
 assert.equal(pages.length,before.n);assert.equal(new Set(pages.map(x=>x.id)).size,pages.length);assert.ok(pages.length>=1205);pass('real authenticated company-scoped pagination beyond 1000',{rows:pages.length});
 for(const query of ['limit=501','limit=0','limit=500&before_id=bad'])assert.equal((await api('/transactions?'+query)).status,400);
 assert.equal((await api('/transactions?limit=5',{actor:C.other})).status,403);pass('invalid cursors and foreign membership denied');
 const bytes=Buffer.from('%PDF-1.4\n% Synthetic picker invoice '+Date.now()+'\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
 const fields={file_name:'synthetic-picker-'+Date.now()+'.pdf',file_size:bytes.length,mime_type:'application/pdf',document_type:'vendor_invoice',amount:100001,currency:'IDR',document_date:'2026-08-02',title:'RC synthetic invoice',sha256:createHash('sha256').update(bytes).digest('hex')};
 const init=await api('/documents/upload-init',{method:'POST',body:fields});assert.equal(init.status,200,JSON.stringify(init));
 const put=await fetch(init.data.upload_url,{method:'PUT',headers:{'content-type':'application/pdf'},body:bytes,signal:AbortSignal.timeout(15000)});assert.ok(put.ok,'signed upload '+put.status);
 const complete=await api('/documents/upload-complete',{method:'POST',body:{...fields,document_id:init.data.document_id,storage_path:init.data.storage_path}});assert.equal(complete.status,200,JSON.stringify(complete));const doc=complete.data.document.id;C.doc=doc;fs.writeFileSync('/tmp/acceptance-session.json',JSON.stringify(C),{mode:0o600});
 pass('actual signed upload and upload-complete creates audited document',{document_id:doc});
 const signed=await api('/documents/'+doc+'/signed-url',{method:'POST',body:{mode:'download'}});assert.equal(signed.status,200,JSON.stringify(signed));
 const fetched=await fetch(signed.data.url);assert.equal(fetched.status,200);assert.deepEqual(Buffer.from(await fetched.arrayBuffer()),bytes);pass('private Storage downloaded bytes equal original synthetic PDF');
 const body={target_type:'transaction',target_id:String(C.target)};
 const linked=await api('/documents/'+doc+'/links',{method:'POST',body});assert.equal(linked.status,200,JSON.stringify(linked));assert.deepEqual(await linkCounts(doc),{links:1,audits:1});
 assert.equal((await api('/documents/'+doc+'/links',{method:'POST',body})).status,409);assert.deepEqual(await linkCounts(doc),{links:1,audits:1});
 const reload=await api('/documents/'+doc);assert.equal(reload.status,200);assert.equal(reload.data.document.links?.length??reload.data.links?.length,1);pass('explicit link persisted and duplicate refuses without duplicate audit');
 let linkId=(await db.query('SELECT id FROM document_transaction_links WHERE document_id=$1',[doc])).rows[0].id;
 assert.equal((await api('/documents/'+doc+'/links/'+linkId,{method:'DELETE'})).status,200);
 const race=await Promise.all([api('/documents/'+doc+'/links',{method:'POST',body}),api('/documents/'+doc+'/links',{method:'POST',body})]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);assert.deepEqual(await linkCounts(doc),{links:1,audits:2});pass('concurrent document linking yields one link and one new linked audit');
 linkId=(await db.query('SELECT id FROM document_transaction_links WHERE document_id=$1',[doc])).rows[0].id;await api('/documents/'+doc+'/links/'+linkId,{method:'DELETE'});
 const foreign=await api('/documents/'+doc+'/links',{method:'POST',body:{...body,target_id:String(C.foreignTx)}});assert.ok([400,403,404].includes(foreign.status),JSON.stringify(foreign));assert.equal((await linkCounts(doc)).links,0);pass('cross-company target denied');
 await db.query("UPDATE business_members SET status='removed' WHERE business_id=$1 AND user_id=$2",[C.biz,C.owner.user.id]);
 try{assert.equal((await api('/documents/'+doc+'/links',{method:'POST',body})).status,403);}finally{await db.query("UPDATE business_members SET status='active' WHERE business_id=$1 AND user_id=$2",[C.biz,C.owner.user.id]);}pass('membership revocation while selected denies link');
 await db.query("CREATE FUNCTION rc_synthetic_doc_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'rc_synthetic_audit_failure';END$$;CREATE TRIGGER rc_synthetic_doc_audit BEFORE INSERT ON document_audit FOR EACH ROW EXECUTE FUNCTION rc_synthetic_doc_audit_failure()");
 try{const r=await api('/documents/'+doc+'/links',{method:'POST',body});assert.equal(r.status,500,JSON.stringify(r));assert.equal((await linkCounts(doc)).links,0);}finally{await db.query('DROP TRIGGER rc_synthetic_doc_audit ON document_audit;DROP FUNCTION rc_synthetic_doc_audit_failure()');}pass('real audit insertion failure rolls back document link');
 const final=await api('/documents/'+doc+'/links',{method:'POST',body});assert.equal(final.status,200);assert.deepEqual(await snap(),before);pass('link/unlink/failure races preserve original ledger byte-for-byte',{ledger_rows:before.n});
 const publicRead=await fetch(process.env.PLATFORM_URL+'/rest/v1/payroll_runs?select=id',{headers:{apikey:process.env.SUPABASE_ANON_KEY,authorization:'Bearer '+process.env.SUPABASE_ANON_KEY}});assert.ok([401,403].includes(publicRead.status));pass('actual PostgREST anon cannot read private payroll table',{status:publicRead.status});
 await db.end();
})().catch(async e=>{console.error(e.message);save();await db.end().catch(()=>{});process.exit(1)});
