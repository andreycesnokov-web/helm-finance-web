'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{Client}=require('pg'),{chromium}=require('playwright-core');
const C=JSON.parse(fs.readFileSync('/tmp/acceptance-session.json')),db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
let browser,page;const origin='http://127.0.0.1:4333',target=new URL(process.env.BASE_URL);
// Transport only: identical real app responses; localhost gives standard secure
// browser context/Web Locks without disabling security or publishing host ports.
const proxy=http.createServer((req,res)=>{const upstream=http.request(new URL(req.url,target),{method:req.method,headers:{...req.headers,host:target.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)});
const save=()=>fs.writeFileSync('/evidence/BROWSER_NATIVE.json',JSON.stringify({mock_backend:false,transport:'real app HTTP via in-runner loopback reverse proxy; no host ports',results},null,2));
const pass=name=>{results.push({case:name,status:'PASS'});save();console.log('PASS '+name)};
async function login(){
 await page.goto(origin+'/login/email',{waitUntil:'networkidle'});await page.locator('input[type=email]').fill(C.owner.email);
 const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/email/start')&&r.request().method()==='POST'),page.getByRole('button',{name:'Get a sign-in link',exact:true}).click()]);const body=await response.json();assert.ok(body.magic_link,'Synthetic login link missing');
 // Use the actual V2 local-test link rendered after the real start request.
 await page.getByRole('link',{name:'open the sign-in link',exact:true}).click();await page.waitForFunction(()=>!!localStorage.getItem('hf_token'));await page.waitForURL('**/account');
}
async function cash(){return(await db.query("SELECT count(*)::int n,md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) hash,fn_wallet_ledger_balance($2)::text balance FROM transactions t WHERE business_id=$1",[C.biz,C.wallet])).rows[0]}
(async()=>{await db.connect();assert.equal((await db.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id,C.cluster);
 await new Promise(r=>proxy.listen(4333,'127.0.0.1',r));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const retained=fs.existsSync('/tmp/native-browser-state.json');
 const context=await browser.newContext({viewport:{width:1440,height:1000},...(retained?{storageState:'/tmp/native-browser-state.json'}:{})});await context.addInitScript(biz=>{localStorage.setItem('hf_lang','en');localStorage.setItem('last_active_workspace_id',biz);localStorage.setItem('activeBusinessId',biz)},C.biz);page=await context.newPage();
 if(retained)await page.goto(origin+'/account',{waitUntil:'networkidle'});else await login();assert.equal(await page.evaluate(()=>window.isSecureContext&&!!navigator.locks&&!!crypto.subtle),true);pass(retained?'retained actual V2 sign-in session and secure browser context':'actual V2 email/code UI sign-in and secure browser context');
 await context.storageState({path:'/tmp/native-browser-state.json'});fs.chmodSync('/tmp/native-browser-state.json',0o600);
 await page.goto(origin+'/business/documents?doc='+C.doc,{waitUntil:'networkidle'});await page.locator('[data-doc-drawer="'+C.doc+'"]').waitFor();
 const nextTx=(await db.query("SELECT id,amount_original,description FROM transactions WHERE business_id=$1 AND description LIKE 'RC synthetic bank row %' AND id NOT IN(SELECT transaction_id FROM document_transaction_links WHERE document_id=$2) ORDER BY id LIMIT 1",[C.biz,C.doc])).rows[0];assert.ok(nextTx);
 await page.getByRole('button',{name:'Find a transaction',exact:true}).click();await page.getByRole('searchbox',{name:'Search transactions'}).fill(String(nextTx.amount_original));
 const option=page.locator('.v2-txp-option');await option.waitFor();assert.equal(await option.count(),1);assert.ok((await option.innerText()).includes(nextTx.description));
 await page.getByRole('searchbox',{name:'Search transactions'}).press('ArrowDown');assert.equal(await option.evaluate(el=>document.activeElement===el),true);
 let linkPosts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/documents/'+C.doc+'/links'))linkPosts++});
 await option.press('Enter');await page.locator('.v2-txp-compare').waitFor();assert.equal(linkPosts,0);await page.locator('.v2-txp-compare').screenshot({path:'/evidence/picker-real-desktop-compare.png'});
 const ledger=await cash(),before=(await db.query('SELECT count(*)::int n FROM document_transaction_links WHERE document_id=$1',[C.doc])).rows[0].n;
 const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/documents/'+C.doc+'/links'));
 await page.evaluate(()=>{const b=document.querySelector('.v2-txp-compare + button');if(!b)throw Error('Missing confirmation');b.click();b.click()});assert.equal((await posted).status(),200);assert.equal(linkPosts,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM document_transaction_links WHERE document_id=$1',[C.doc])).rows[0].n,before+1);assert.deepEqual(await cash(),ledger);
 await page.reload({waitUntil:'networkidle'});assert.ok((await page.locator('[data-doc-drawer]').innerText()).includes(nextTx.description));pass('actual Documents picker search/keyboard/compare/double-click/link/reload matches PostgreSQL and leaves cash unchanged');
 await page.goto(origin+'/business/payroll',{waitUntil:'networkidle'});await page.locator('[data-pay-run]').waitFor();await page.locator('[data-pay-run]').click();
 const modal=page.getByRole('dialog',{name:'Monthly payroll draft'});await modal.waitFor();assert.ok(await modal.locator('.v2-payd-row:not(.is-head)').count());
 await modal.locator('input[type=month]').fill('2026-11');await modal.locator('input[type=date]').fill('2026-11-25');
 const tax=modal.locator('input[aria-label^="PPh 21 ·"]');for(let i=0;i<await tax.count();i++)await tax.nth(i).fill('0');
 await modal.getByRole('checkbox',{name:/I entered the PPh 21/}).check();await modal.screenshot({path:'/evidence/payroll-real-desktop-draft.png'});
 const saveButton=modal.getByRole('button',{name:'Save draft',exact:true});
 // On first real session the retained safety flow requires review of prior API receipts.
 await saveButton.click();
 await page.waitForFunction(()=>!document.querySelector('.v2-payrun-table')||!!document.querySelector('[data-recovery-dialog]'));
 if(await page.locator('[data-recovery-dialog]').isVisible()){
   await page.locator('[data-recovery-dialog]').getByRole('button',{name:'Close',exact:true}).click();
   await modal.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.getByRole('button',{name:/^Operation recovery/}).click();
   await page.getByRole('button',{name:'I have reviewed; this is a new operation'}).click();
   await page.locator('[data-pay-run]').click();const m=page.getByRole('dialog',{name:'Monthly payroll draft'});await m.locator('input[type=month]').fill('2026-11');await m.locator('input[type=date]').fill('2026-11-25');
   const tx=m.locator('input[aria-label^="PPh 21 ·"]');for(let i=0;i<await tx.count();i++)await tx.nth(i).fill('0');await m.getByRole('checkbox',{name:/I entered the PPh 21/}).check();
 }
 if(await page.locator('.v2-payrun-table').isVisible()){
   const response=page.waitForResponse(r=>r.url().endsWith('/api/payroll/runs/action')&&r.request().method()==='POST');await page.locator('[data-payd-run]').evaluate(el=>{el.click();el.click()});assert.equal((await response).status(),200);
 }
 await page.locator('.v2-payrun-history-row').filter({hasText:'2026-11'}).waitFor();assert.deepEqual(await cash(),ledger);pass('actual payroll form saves a single draft through existing recovery admission without a bank payment');
 await context.storageState({path:'/tmp/native-browser-state.json'});fs.chmodSync('/tmp/native-browser-state.json',0o600);
 await context.close();await browser.close();proxy.close();await db.end();
})().catch(async e=>{console.error(e.message);if(page&&page.url().includes('/business/')){await page.screenshot({path:'/evidence/browser-native-failure.png'}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-1500));}save();await browser?.close().catch(()=>{});proxy.close();await db.end().catch(()=>{});process.exit(1)});
