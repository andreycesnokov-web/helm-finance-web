'use strict';
// Real stack: the monthly payroll window filled like the accountant's sheet (BPJS KS / TK JP / TK JHT).
// Needs browser-native.cjs first (signed-in state) and an unused month: PAYROLL_SHEET_MONTH=2027-12.
// Amounts are one row of an accountant's real sheet (gross-up to a round take-home); the person is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{Client}=require('pg'),{chromium}=require('playwright-core');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
const month=process.env.PAYROLL_SHEET_MONTH;
let browser,page;const origin='http://127.0.0.1:4333',target=new URL(process.env.BASE_URL);
const proxy=http.createServer((req,res)=>{const up=http.request(new URL(req.url,target),{method:req.method,headers:{...req.headers,host:target.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up)});
function pass(name,detail={}){results.push({case:name,status:'PASS',...detail});fs.writeFileSync('/evidence/BROWSER_PAYROLL_SHEET.json',JSON.stringify({backend:'real app + PostgreSQL',month,results},null,2));console.log('PASS '+name)}
async function cash(){return(await db.query('SELECT count(*)::int n,md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash,fn_wallet_ledger_balance($2)::text balance FROM transactions t WHERE business_id=$1',[C.biz,C.wallet])).rows[0]}
const ROW={salary:'8474663',pph21:'154663',bpjs_kes:'80000',bpjs_jp:'80000',bpjs_jht:'160000'},LABEL={salary:'Salary',pph21:'PPh 21',bpjs_kes:'BPJS Kesehatan',bpjs_jp:'BPJS TK JP',bpjs_jht:'BPJS TK JHT'};
async function open(){await page.locator('[data-pay-run]').click();const m=page.getByRole('dialog',{name:'Monthly payroll draft'});await m.waitFor();return m}
(async()=>{
 assert.match(month||'',/^\d{4}-(0[1-9]|1[0-2])$/,'Set PAYROLL_SHEET_MONTH to an unused month');
 await db.connect();
 assert.equal((await db.query('SELECT count(*)::int n FROM payroll_payments WHERE business_id=$1 AND period_month=$2',[C.biz,month])).rows[0].n,0,'month already used');
 await new Promise(r=>proxy.listen(4333,'127.0.0.1',r));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({storageState:'/tmp/native-browser-state.json',viewport:{width:1440,height:1000}});page=await context.newPage();
 await page.goto(origin+'/business/payroll',{waitUntil:'networkidle'});const before=await cash();
 const m=await open();
 const heads=await m.getByRole('columnheader').allInnerTexts();
 for(const h of ['Salary','Additional pay','Gross','PPh 21','BPJS Kesehatan','BPJS TK JP','BPJS TK JHT','Take-home'])assert.ok(heads.includes(h),'column '+h);
 for(const h of ['Employer BPJS','Other deductions'])assert.ok(!heads.includes(h),'hidden by default: '+h);
 await m.locator('input[type=month]').fill(month);await m.locator('input[type=date]').fill(month+'-25');
 const rows=m.locator('.v2-payd-row:not(.is-head):not(.is-total)');const first=rows.first(),name=(await first.locator('.v2-pe-sug-row span').innerText()).trim();
 const checks=rows.locator('input[type=checkbox]');for(let i=1;i<await checks.count();i++)await checks.nth(i).uncheck();
 for(const [k,v] of Object.entries(ROW))await m.getByLabel(LABEL[k]+' · '+name,{exact:true}).fill(v);
 assert.match(await first.locator('.v2-payrun-computed').innerText(),/8,474,663/);
 assert.match(await first.locator('.v2-payrun-net').innerText(),/Rp 8,000,000/);
 const total=m.locator('[data-payrun-total]');assert.match(await total.innerText(),/Rp 8,000,000/);assert.match(await total.innerText(),/160,000/);
 pass('the window shows the accountant sheet columns; take-home equals Gaji bersih (8,000,000) and the total row adds up',{employee:name});
 await m.locator('.v2-modal-body').evaluate(el=>{el.scrollTop=0});await m.screenshot({path:'/evidence/payroll-sheet-desktop.png'});
 await m.getByRole('checkbox',{name:/I entered the PPh 21/}).check();
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/payroll/runs/action')&&r.request().method()==='POST');
 await m.locator('[data-payd-run]').click();assert.equal((await saved).status(),200);
 const pay=(await db.query('SELECT id,gross_amount::bigint::int g,net_amount::bigint::int n,transaction_id,status FROM payroll_payments WHERE business_id=$1 AND period_month=$2',[C.biz,month])).rows;
 assert.equal(pay.length,1);assert.deepEqual([pay[0].g,pay[0].n,pay[0].transaction_id,pay[0].status],[8474663,8000000,null,'draft']);
 const items=Object.fromEntries((await db.query('SELECT item_type,amount::bigint::int a FROM payroll_payment_items WHERE payroll_payment_id=$1',[pay[0].id])).rows.map(r=>[r.item_type,r.a]));
 assert.deepEqual(items,{salary:8474663,pph21:154663,bpjs_kes:80000,bpjs_jp:80000,bpjs_jht:160000});
 assert.deepEqual(await cash(),before);
 pass('saved draft keeps BPJS Kesehatan / TK JP / TK JHT as separate items, net 8,000,000, no bank transaction, ledger unchanged',{payment:pay[0].id});
 await page.locator('.v2-payrun-history-row').filter({hasText:month}).first().waitFor();
 await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:'networkidle'});
 const mob=await open();await mob.locator('[data-payrun-total]').scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await mob.locator('[data-payrun-more]').click();const emp=mob.locator('input[aria-label^="Employer BPJS ·"]').first();await emp.scrollIntoViewIfNeeded();assert.equal(await emp.isVisible(),true);
 await mob.locator('.v2-payd-row:not(.is-head):not(.is-total)').first().screenshot({path:'/evidence/payroll-sheet-mobile-row.png'});
 await mob.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await cash(),before);
 pass('mobile: no page overflow, total row reachable, More reveals employer BPJS; cancel has no cash effect');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();proxy.close();await db.end().catch(()=>{})});
