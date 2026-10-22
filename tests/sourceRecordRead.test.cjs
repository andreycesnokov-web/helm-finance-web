// Execute the actual existing GET handlers, with Express + supabase-js and a
// synthetic REST transport. This verifies contracts, not deployed RLS/Auth.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const express=require('express'),{createClient}=require('@supabase/supabase-js'),{createRequire}=require('node:module');
const read=require('../server/lib/sourceRecordRead'),{B,OTHER}=require('./fixtures/profitLoss.cjs');
const index=fs.readFileSync('server/index.js','utf8'),localRequire=createRequire(path.resolve('server/index.js'));
test('bounded lookup validates bigint IDs and preserves exact strings',()=>{
 for(const id of ['',null,'0','-1','1,2','1)',[],['1'],'9223372036854775808'])assert.throws(()=>read.lookupId({id}));
 assert.equal(read.lookupId({}),null);assert.equal(read.lookupId({id:'9007199254740993'}),'9007199254740993');
 const rows=[{id:9007199254740992,amount_original:1,exact_id:'9007199254740993',exact_amount_original:'0.000000000000000001',exact_balance_version:'9'}];
 assert.deepEqual(read.decode(rows,'transactions','1'),[{id:'9007199254740993',amount_original:'0.000000000000000001',balance_version:'9'}]);
 assert.equal(read.select('transactions',null),'*');assert.equal(read.decode(rows,'transactions',null),rows);
});
async function harness(table,fn){
 const logs=[],app=express(),id='9007199254740993';
 const supabase=createClient('https://synthetic.invalid','synthetic',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
  const u=new URL(url),name=u.pathname.split('/').at(-1);assert.equal(init.method,'GET');logs.push(u);
  let data=[];
  if(name===table){assert.equal(u.searchParams.get('business_id'),'eq.'+B);assert.equal(u.searchParams.get('limit'),'1');
   const own=u.searchParams.get('id')==='eq.'+id,employee=u.searchParams.get('created_by_user_id');
   if(own&&!employee)data=[{business_id:B,type:'payable',exact_id:id,exact_amount_original:'0.1',exact_amount:'1.1',exact_original_amount:'1.1',exact_paid_amount:'0.1',exact_balance_version:'2',exact_bill_version:'2'}];
  }
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 }}});
 const tag=`app.get('/api/${table}',`,start=index.indexOf(tag),end=index.indexOf('\n});',start)+5;assert.ok(start>0&&end>start);
 vm.runInNewContext(index.slice(start,end),{app,require:localRequire,auth:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.user={userId:7};next();},
  requireBusiness:async(req,res)=>{if(req.headers['x-revoked']){res.sendStatus(403);return null;}return {business:{id:B},role:req.headers['x-role']||'owner'};},
  canViewBusinessFinance:role=>['owner','cfo','accountant','auditor'].includes(role),supabase,bizOrFilter:()=>`business_id.eq.${B}`,balanceFailure:()=>false,enrichDebtsFor:async(biz,data)=>{assert.equal(biz,B);return data;},Date});
 const s=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
 try{await fn({logs,id,get:(q,headers={authorization:'synthetic'})=>fetch(`http://127.0.0.1:${s.address().port}/api/${table}?period=all&${q}`,{headers})});}finally{await new Promise(r=>s.close(r));}
}
for(const table of ['transactions','debts'])test(table+' actual route deep lookup: exact, bounded, current-company, authorized, no writes',()=>harness(table,async({get,id,logs})=>{
 for(const role of ['owner','accountant','auditor']){
  const r=await get('id='+id+'&business_id='+OTHER,{authorization:'x','x-role':role});assert.equal(r.status,200);const rows=await r.json();assert.equal(rows.length,1);assert.equal(rows[0].id,id);assert.equal(rows[0].business_id,B);assert.equal(rows[0][table==='debts'?'bill_version':'balance_version'],'2');
 }
 assert.deepEqual(await(await get('id=42')).json(),[]);
 const n=logs.length;assert.equal((await get('id='+id,{})).status,401);assert.equal((await get('id='+id,{authorization:'x','x-revoked':'1'})).status,403);assert.equal(logs.length,n);
 assert.equal((await get('id=bad')).status,400);assert.equal(logs.length,n);
 const employee=await get('id='+id,{authorization:'x','x-role':'employee'});assert.equal(employee.status,table==='transactions'?403:200);if(table==='debts')assert.deepEqual(await employee.json(),[]);
}));
