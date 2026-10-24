// Real Express HTTP + real supabase-js request construction; synthetic REST
// transport. This is API/authorization contract proof, not real DB/RLS proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),{createClient}=require('@supabase/supabase-js');
const {install,readAll,NAMES}=require('../server/lib/profitLossRoutes');
const {fixture,B,OTHER,tx}=require('./fixtures/profitLoss.cjs');
function transport(f,mode='ok'){
 const logs=[];const tables=Object.fromEntries(Object.entries(f).filter(([k])=>!['systemCategories','categoryGroups','classifications'].includes(k)).map(([k,v])=>[NAMES[k]||k,v]));
 tables.business_category_pnl_groups=f.categoryGroups||[];tables.transaction_classifications=f.classifications||[];
 return {logs,fetch:async(url,init)=>{
  const u=new URL(url),table=u.pathname.split('/').at(-1);logs.push({table,method:init.method||'GET',query:u.search});
  assert.equal(init.method,'GET');
  // The ONE unscoped read: shared system categories (business_id IS NULL, is_system). Every other read is this company's.
  const system=table==='cashflow_categories'&&u.searchParams.get('business_id')==='is.null';
  if(system)assert.equal(u.searchParams.get('is_system'),'eq.true');else assert.equal(u.searchParams.get('business_id'),'eq.'+B);
  assert.equal(u.searchParams.get('order'),table==='business_category_pnl_groups'?'category_id.asc':table==='transaction_classifications'?'transaction_id.asc':'id.asc');
  if(['business_category_pnl_groups','transaction_classifications'].includes(table)&&mode==='nooverlay')return new Response(JSON.stringify({code:'42P01',message:'relation does not exist'}),{status:404,headers:{'content-type':'application/json'}});
  if(system)return new Response(JSON.stringify(f.systemCategories||[]),{status:200,headers:{'content-type':'application/json'}});
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
 assert.equal(wire.logs.length,16); // + one read of this company's operation classifications
 assert.deepEqual(wire.logs.filter(l=>['cashflow_categories','business_category_pnl_groups'].includes(l.table)).map(l=>[l.table,new URLSearchParams(l.query).get('business_id')]),
  [['cashflow_categories','eq.'+B],['cashflow_categories','is.null'],['business_category_pnl_groups','eq.'+B]]);assert.ok(wire.logs.every(l=>l.method==='GET'));assert.ok(decodeURIComponent(wire.logs[0].query).includes('amount_original::text'));
 assert.ok(!JSON.stringify(body).includes('synthetic-key'));
}));
// System categories (shared by all companies) count only with THIS company's confirmed group.
const SYS='c0000000-0000-4000-8000-0000000000aa';
const sysCat={id:SYS,business_id:null,name:'Office rent',pnl_group:null,is_system:true};
async function systemServer(mode,extra,fn){
 const f=fixture();Object.assign(f,extra);f.transactions=[...f.transactions,tx(90,'expense','300','Office rent',{cashflow_category_id:SYS})];
 const wire=transport(f,mode),app=express();
 const db=createClient('https://synthetic.invalid','synthetic-key',{global:{fetch:wire.fetch},auth:{persistSession:false,autoRefreshToken:false}});
 install(app,{supabase:db,auth:(req,res,next)=>next(),requireBusiness:async()=>({business:{id:B,type:'business'},role:'owner'}),canViewBusinessFinance:()=>true});
 const s=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 try{const res=await fetch('http://127.0.0.1:'+s.address().port+'/api/pulse/profit-loss?month=2026-08',{signal:AbortSignal.timeout(3000)});await fn(res,wire);}
 finally{await new Promise(r=>s.close(r));}
}
test('a system category mapped by this company classifies its operations; nothing is written',async()=>{
 await systemServer('ok',{systemCategories:[sysCat],categoryGroups:[{business_id:B,category_id:SYS,pnl_group:'operating_cost'}]},async(res,wire)=>{
  assert.equal(res.status,200);const d=await res.json();assert.equal(d.system_category_mapping,true);
  const e=d.entries.find(x=>x.transaction_id==='90');assert.equal(e.group,'operating_cost');assert.equal(e.category_id,SYS);
  assert.ok(!d.exceptions.some(x=>x.transaction_id==='90'));assert.ok(wire.logs.every(l=>l.method==='GET'));
 });
});
test('without this company confirmation a system category stays in Needs review',async()=>{
 await systemServer('ok',{systemCategories:[sysCat],categoryGroups:[]},async(res)=>{
  const d=await res.json();assert.ok(d.exceptions.some(x=>x.transaction_id==='90'&&x.reason==='unclassified_or_ambiguous_category'));
  assert.ok(!d.entries.some(x=>x.transaction_id==='90'));
 });
});
test('before the migration (no overlay table) the report still answers; system categories stay unclassified',async()=>{
 await systemServer('nooverlay',{systemCategories:[sysCat]},async(res)=>{
  assert.equal(res.status,200);const d=await res.json();assert.equal(d.system_category_mapping,false);assert.ok(d.exceptions.some(x=>x.transaction_id==='90'));
 });
});
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
