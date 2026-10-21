// Real Express HTTP + real supabase-js request construction; synthetic REST
// transport. This is API/authorization contract proof, not real DB/RLS proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),{createClient}=require('@supabase/supabase-js');
const {install,readAll,NAMES}=require('../server/lib/profitLossRoutes');
const {fixture,B,OTHER,tx}=require('./fixtures/profitLoss.cjs');
function transport(f,mode='ok'){
 const logs=[];const tables=Object.fromEntries(Object.entries(f).map(([k,v])=>[NAMES[k]||k,v]));
 return {logs,fetch:async(url,init)=>{
  const u=new URL(url),table=u.pathname.split('/').at(-1);logs.push({table,method:init.method||'GET',query:u.search});
  assert.equal(init.method,'GET');assert.equal(u.searchParams.get('business_id'),'eq.'+B);assert.equal(u.searchParams.get('order'),'id.asc');
  if(mode==='fail')return new Response(JSON.stringify({code:'42703',message:'private database failure detail'}),{status:400,headers:{'content-type':'application/json'}});
  let rows=(tables[table]||[]).filter(x=>x.business_id===B).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));
  let count=rows.length;if(mode==='cap')count=26000;
  if(mode==='change'&&offset)count++;
  const data=rows.slice(offset,offset+(mode==='short'?5:limit));
  if(mode==='duplicate'&&offset&&data.length)data[0]=rows[0];
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','content-range':`${offset}-${offset+data.length-1}/${count}`}});
 }};
}
async function server(mode,fn){
 const f=fixture(),wire=transport(f,mode),app=express();
 const db=createClient('https://synthetic.invalid','synthetic-key',{global:{fetch:wire.fetch},auth:{persistSession:false,autoRefreshToken:false}});
 install(app,{supabase:db,auth:(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'unauthenticated'});next();},requireBusiness:async(req,res)=>{
  if(req.headers['x-revoked']){res.status(403).json({error:'membership_revoked'});return null;}
  return {business:{id:B,type:req.headers['x-personal']?'personal':'business'},role:req.headers['x-role']||'owner'};
 },canViewBusinessFinance:r=>['owner','ceo','admin','cfo','accountant','auditor'].includes(r)});
 const s=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${s.address().port}/api/pulse/profit-loss`;
 try{await fn({f,wire,db,request:(query='month=2026-08',headers={authorization:'synthetic'})=>fetch(base+'?'+query,{headers,signal:AbortSignal.timeout(3000)})});}
 finally{await new Promise(r=>s.close(r));}
}
test('HTTP report uses current resolved company and safe exact selects; no writes',async()=>server('ok',async({f,wire,request})=>{
 const before=JSON.stringify(f),res=await request('month=2026-08&business_id='+OTHER);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
 const body=await res.json();assert.equal(body.business_id,B);assert.equal(body.periods['2026-08'].totals.revenue,'975.1');assert.equal(JSON.stringify(f),before);
 assert.equal(wire.logs.length,13);assert.ok(wire.logs.every(l=>l.method==='GET'));assert.ok(decodeURIComponent(wire.logs[0].query).includes('amount_original::text'));
 assert.ok(!JSON.stringify(body).includes('synthetic-key'));
}));
test('HTTP unauthorized / membership revoked / personal / low roles cause zero DB reads',async()=>server('ok',async({wire,request})=>{
 for(const [headers,status] of [[{},401],[{authorization:'x','x-revoked':'1'},403],[{authorization:'x','x-personal':'1'},403],...['employee','manager','viewer'].map(r=>[{authorization:'x','x-role':r},403])])assert.equal((await request('month=2026-08',headers)).status,status);
 assert.equal(wire.logs.length,0);
}));
test('HTTP accountant and auditor can read without receiving a write capability',async()=>server('ok',async({request})=>{for(const role of ['accountant','auditor']){const res=await request('month=2026-08',{authorization:'x','x-role':role});assert.equal(res.status,200);const d=await res.json();assert.equal(d.accounting_ready,false);}}));
test('invalid query / accrual request is 400 before DB reads',async()=>server('ok',async({wire,request})=>{for(const q of ['month=bad','month=2026-08&basis=accrual','month=2026-08&currency=IDR%29,other'])assert.equal((await request(q)).status,400);assert.equal(wire.logs.length,0);}));
test('DB errors are 503 with no partial totals or internal error text',async()=>server('fail',async({request})=>{const res=await request();assert.equal(res.status,503);const d=await res.json();assert.ok(!JSON.stringify(d).includes('private database'));assert.equal(d.periods,undefined);assert.equal(d.totals,undefined);}));
test('source cap never returns a deceptively complete report',async()=>server('cap',async({request})=>{const res=await request();assert.equal(res.status,503);assert.equal((await res.json()).error,'report_row_limit');}));
test('stable pagination reads 1501 rows and no extra/duplicate transaction',async()=>{
 const f=fixture();f.transactions=Array.from({length:1501},(_,i)=>tx(i,'income','0.10','Product sales'));const w=transport(f),db=createClient('https://synthetic.invalid','test',{global:{fetch:w.fetch}});
 const rows=await readAll(db,'transactions',B,{month:'2026-08'},new AbortController().signal);assert.equal(rows.length,1501);assert.equal(w.logs.length,4);
});
for(const mode of ['short','change','duplicate'])test('pagination fails closed: '+mode,async()=>{
 const f=fixture();f.transactions=Array.from({length:600},(_,i)=>tx(i,'income','1','Product sales'));const w=transport(f,mode),db=createClient('https://synthetic.invalid','test',{global:{fetch:w.fetch}});
 await assert.rejects(()=>readAll(db,'transactions',B,{month:'2026-08'},new AbortController().signal),/source_read_incomplete|report_changed_during_read|source_scope_or_pagination_error/);
});
