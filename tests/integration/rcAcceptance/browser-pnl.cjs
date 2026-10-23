'use strict';
// Interactive P&L on the REAL stack (no fixture transport): real writer API creates the operations, a real
// signed upload + link attaches the document, the real /api/pulse/profit-loss computes the report, and the
// V2 Performance UI is driven in Chromium. Category→P&L group mapping is set as explicit setup (a person
// confirms it in the product). Synthetic data only; refuses any cluster except the admitted one.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{randomUUID,createHash}=require('node:crypto'),{Client}=require('pg'),{chromium}=require('playwright-core');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
const MONTH=process.env.PNL_MONTH||'2027-02',origin='http://127.0.0.1:4334',target=new URL(process.env.BASE_URL);
const proxy=http.createServer((req,res)=>{const u=http.request(new URL(req.url,target),{method:req.method,headers:{...req.headers,host:target.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});u.on('error',()=>{res.writeHead(502);res.end()});req.pipe(u)});
const save=()=>fs.writeFileSync('/evidence/BROWSER_PNL.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',cluster:C.cluster,mock_backend:false,month:MONTH,results},null,2));
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});save();console.log('PASS '+name)};
async function api(path,{method='GET',body,actor=C.owner}={}){const r=await fetch(process.env.BASE_URL+'/api'+path,{method,headers:{authorization:'Bearer '+actor.token,'x-business-id':C.biz,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json().catch(()=>null)}}
async function cash(){return(await db.query("SELECT count(*)::int n,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]')::text) hash,fn_wallet_ledger_balance($2)::text balance FROM transactions t WHERE business_id=$1",[C.biz,C.wallet])).rows[0]}
const shot=(page,n)=>page.screenshot({path:'/evidence/'+n+'.png',fullPage:true});
(async()=>{
 await db.connect();assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id,C.cluster);
 assert.equal((await db.query("SELECT count(*)::int n FROM transactions WHERE business_id=$1 AND to_char(transaction_date,'YYYY-MM')=$2",[C.biz,MONTH])).rows[0].n,0,'period '+MONTH+' must be unused');
 // ── setup: categories with a person-confirmed P&L group (one deliberately unmapped)
 const cat=async(name,group_type,pnl)=>(await db.query("INSERT INTO cashflow_categories(id,business_id,user_id,name,group_type,is_system,is_active,sort_order,pnl_group) VALUES($1,$2,$3,$4,$5,false,true,0,$6) RETURNING id",[randomUUID(),C.biz,C.owner.user.id,name,group_type,pnl])).rows[0].id;
 const sales=await cat('PnL Sales '+MONTH,'inflow','revenue'),rent=await cat('PnL Rent '+MONTH,'outflow','operating_cost');await cat('PnL Unmapped '+MONTH,'outflow',null);
 // Fund the account first (real writer, outside the month) so the negative-balance guard allows expenses.
 const fund=await api('/transactions/batch',{method:'POST',body:{request_key:randomUUID(),transactions:[{type:'income',amount:'50000000',currency:'IDR',wallet_id:C.wallet,transaction_date:'2027-01-15',description:'PnL setup funding',category:'Owner funding (loan)',scope:'business'}]}});
 assert.equal(fund.status,200,JSON.stringify(fund));
 // ── real operations in the month through the confirmed-transaction writer
 const ops=[{type:'income',amount:'12500000',category:'PnL Sales '+MONTH,description:'PT Synthetic Client invoice SYN-001'},
   {type:'expense',amount:'3000000',category:'PnL Rent '+MONTH,description:'Office rent February'},
   {type:'expense',amount:'450000',category:'PnL Unmapped '+MONTH,description:'Misc unmapped cost'}];
 const created=[];
 for(const o of ops){const r=await api('/transactions/batch',{method:'POST',body:{request_key:randomUUID(),transactions:[{...o,currency:'IDR',wallet_id:C.wallet,transaction_date:MONTH+'-10',scope:'business'}]}});assert.equal(r.status,200,JSON.stringify(r));created.push(r.data);}
 const income=(await db.query("SELECT id FROM transactions WHERE business_id=$1 AND description='PT Synthetic Client invoice SYN-001' AND to_char(transaction_date,'YYYY-MM')=$2",[C.biz,MONTH])).rows[0].id;
 pass('real writer API recorded 3 operations in '+MONTH);
 // ── real document upload + explicit link to the income transaction
 const bytes=Buffer.from('%PDF-1.4\n% Synthetic P&L invoice '+Date.now()+'\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
 const fields={file_name:'synthetic-pnl-'+Date.now()+'.pdf',file_size:bytes.length,mime_type:'application/pdf',document_type:'customer_invoice',amount:12500000,currency:'IDR',document_date:MONTH+'-10',title:'SYN-001',sha256:createHash('sha256').update(bytes).digest('hex')};
 const init=await api('/documents/upload-init',{method:'POST',body:fields});assert.equal(init.status,200,JSON.stringify(init));
 const put=await fetch(init.data.upload_url,{method:'PUT',headers:{'content-type':'application/pdf'},body:bytes});assert.ok(put.ok,'signed upload '+put.status);
 const done=await api('/documents/upload-complete',{method:'POST',body:{...fields,document_id:init.data.document_id,storage_path:init.data.storage_path}});assert.equal(done.status,200,JSON.stringify(done));
 const doc=done.data.document.id;const link=await api('/documents/'+doc+'/links',{method:'POST',body:{target_type:'transaction',target_id:String(income)}});assert.equal(link.status,200,JSON.stringify(link));
 pass('real signed upload + link attached the invoice to the income operation',{document_id:doc});
 // ── the real report
 const before=await cash();
 const rep=await api('/pulse/profit-loss?month='+MONTH+'&currency=IDR');assert.equal(rep.status,200,JSON.stringify(rep).slice(0,300));
 const T=rep.data.periods[MONTH].totals;
 assert.equal(Number(T.revenue),12500000);assert.equal(Number(T.operating_cost),3000000);assert.equal(Number(T.ebitda),9500000);assert.equal(T.net_profit,null);
 assert.equal(rep.data.accounting_ready,false);assert.equal(rep.data.basis,'cash');
 const unm=rep.data.exceptions.filter(e=>e.reason==='unclassified_or_ambiguous_category'&&e.date&&e.date.startsWith(MONTH));assert.equal(unm.length,1);assert.equal(unm[0].native_amount,'450000.00');
 const incEntry=rep.data.entries.find(e=>e.transaction_id===String(income));assert.ok(incEntry.documents.some(d=>String(d.id)===String(doc)));
 assert.ok(!rep.data.entries.some(e=>e.description==='PnL setup funding'),'funding is never revenue');
 pass('report totals: revenue 12,500,000 · operating cost 3,000,000 · EBITDA 9,500,000 · net profit null (cash view, not accrual)');
 pass('unmapped category shown as an explicit exception (450,000), not silently classified');
 pass('drill-down entry carries the linked document');
 // C.other became this company's CFO in payroll-http (intended); use a fresh real email user with no membership.
 const email='pnl.outsider.'+Date.now()+'@example.invalid';
 const st=await (await fetch(process.env.BASE_URL+'/api/auth/email/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})})).json();
 const vr=await (await fetch(process.env.BASE_URL+'/api/auth/email/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,code:st.dev_code})})).json();assert.ok(vr.token);
 const outsider={token:vr.token,user:vr.user};
 for(const p of ['/pulse/profit-loss?month='+MONTH,'/transactions?limit=5']){const r=await api(p,{actor:outsider});assert.ok([403,404,409].includes(r.status),p+' as outsider: '+r.status);}
 pass('a signed-in user with no membership cannot read this company report or transactions');
 // ── browser
 await new Promise(r=>proxy.listen(4334,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 for(const vp of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  const ctx=await browser.newContext({viewport:{width:vp.width,height:vp.height}});
  await ctx.addInitScript(({biz,token})=>{localStorage.setItem('hf_lang','en');localStorage.setItem('hf_token',token);localStorage.setItem('last_active_workspace_id',biz);localStorage.setItem('activeWorkspaceId',biz)},{biz:C.biz,token:C.owner.token});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(origin+'/business/performance?month='+MONTH,{waitUntil:'networkidle'});
  await page.waitForSelector('[data-pnl-metric="revenue"]',{timeout:30000});
  // Existing Performance UI is preserved: charts + rows render.
  assert.ok(await page.locator('svg').count()>0,'charts render');
  await shot(page,'pnl-'+vp.name+'-overview');
  await page.locator('[data-pnl-metric="revenue"]').first().click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.match(await dialog.locator('[data-pnl-total]').innerText(),/12[.,\s]?500[.,\s]?000/);
  await dialog.getByRole('button',{name:/expand/i}).first().click();
  await dialog.locator('.pnl-entry').first().waitFor({timeout:15000});
  const entryText=await dialog.locator('.pnl-entry').first().innerText();assert.match(entryText,/SYN-001|customer/i);
  const docLink=dialog.locator('.pnl-documents a').first();assert.match(await docLink.getAttribute('href'),new RegExp('/business/documents\\?doc='+doc));
  await shot(page,'pnl-'+vp.name+'-revenue-drilldown');
  const [docPage]=await Promise.all([ctx.waitForEvent('page'),docLink.click()]);await docPage.waitForLoadState('networkidle');
  assert.match(docPage.url(),new RegExp('doc='+doc));await docPage.waitForTimeout(1500);await docPage.screenshot({path:'/evidence/pnl-'+vp.name+'-document-opened.png',fullPage:true});await docPage.close();
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  await page.locator('[data-pnl-metric="operating_cost"]').first().click();await dialog.waitFor();
  assert.match(await dialog.locator('[data-pnl-total]').innerText(),/3[.,\s]?000[.,\s]?000/);
  await dialog.locator('summary',{hasText:/needs review/i}).first().click();
  assert.match(await dialog.innerText(),/450[.,\s]?000/);await shot(page,'pnl-'+vp.name+'-costs-exceptions');
  if(vp.name==='mobile'){const w=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(w[0]<=w[1]+1,'no horizontal page overflow on mobile '+w);}
  assert.deepEqual(errors,[]);
  pass(vp.name+': Performance → revenue → expand categories → transaction → document opens; costs show the unmapped exception');
  await ctx.close();
 }
 await browser.close();proxy.close();
 assert.deepEqual(await cash(),before);pass('viewing and drilling the report changed no ledger row or balance');
 await db.end();
})().catch(async e=>{console.error('FAIL '+e.message);results.push({case:'FAILED',status:'FAIL',error:e.message.slice(0,400)});save();process.exit(1)});
