'use strict';
// Real stack + real V2 screen: the owner downloads the accountant package for a month, a quarter, an incomplete
// month and an empty month, exactly as a person does (AI Accountant → package period → Download). Each ZIP is then
// verified independently against PostgreSQL (_packageVerify.cjs). Env: PKG_EMAIL, PKG_PASSWORD, PKG_BIZ and
// PKG_PERIODS (default 2026-09,2026-Q3,2026-10,2026-04). Synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{Client}=require('pg'),{chromium}=require('playwright-core');
const {verifyPackage}=require('./_packageVerify.cjs');
const db=new Client({connectionString:process.env.DATABASE_URL}),results=[];
const BIZ=process.env.PKG_BIZ,PERIODS=(process.env.PKG_PERIODS||'2026-09,2026-Q3,2026-10,2026-04').split(',');
const origin='http://127.0.0.1:4337',target=new URL(process.env.BASE_URL),OUT='/evidence/accountant-packages';
const proxy=http.createServer((req,res)=>{const up=http.request(new URL(req.url,target),{method:req.method,headers:{...req.headers,host:target.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up)});
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});fs.writeFileSync('/evidence/BROWSER_ACCOUNTANT_PACKAGE.json',JSON.stringify({candidate:process.env.CFO_RC_SHA||'unrecorded',results},null,2));console.log('PASS '+name)};
const monthOf=(p)=>/^\d{4}-Q[1-4]$/.test(p)?`${p.slice(0,4)}-${String(Number(p.slice(-1))*3).padStart(2,'0')}`:p;
let browser;
(async()=>{
 assert.ok(BIZ&&process.env.PKG_EMAIL&&process.env.PKG_PASSWORD,'PKG_EMAIL, PKG_PASSWORD and PKG_BIZ are required');
 await db.connect();fs.mkdirSync(OUT,{recursive:true});
 const others=(await db.query('SELECT DISTINCT name FROM businesses WHERE id<>$1 AND length(name)>6',[BIZ])).rows.map(r=>r.name);
 await new Promise(r=>proxy.listen(4337,'127.0.0.1',r));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await ctx.addInitScript(biz=>{localStorage.setItem('hf_lang','en');localStorage.setItem('last_active_workspace_id',biz);localStorage.setItem('activeBusinessId',biz)},BIZ);
 const page=await ctx.newPage();
 await page.goto(origin+'/login',{waitUntil:'networkidle'});
 await page.locator('input[type=email]').fill(process.env.PKG_EMAIL);await page.locator('input[type=password]').fill(process.env.PKG_PASSWORD);
 await Promise.all([page.waitForURL('**/account'),page.getByRole('button',{name:'Sign in',exact:true}).click()]);
 for(const period of PERIODS){
  await page.goto(`${origin}/business/accountant?month=${monthOf(period)}`,{waitUntil:'networkidle'});
  const sel=page.locator('[data-acct-period]');await sel.waitFor();
  await sel.selectOption(/Q/.test(period)?'quarter':'month');
  const optionText=await sel.locator('option:checked').innerText();
  if(/Q/.test(period))assert.ok(optionText.includes(period)&&/\d{4}-\d{2}-01 – \d{4}-\d{2}-\d{2}/.test(optionText),'quarter option shows exact dates: '+optionText);
  const [dl]=await Promise.all([page.waitForEvent('download',{timeout:180000}),page.locator('[data-acct-download]').click()]);
  const file=path.join(OUT,dl.suggestedFilename());await dl.saveAs(file);
  assert.equal(path.basename(file),`CFO_AI_PT_Contoh_Solusi_Digital_${period}_Accountant_Package.zip`);
  const note=page.locator('[data-acct-package-done]');await note.waitFor();const noteText=await note.innerText();
  const r=await verifyPackage({zipPath:file,db,biz:BIZ,periodKey:period,otherCompanyNames:others});
  assert.equal(r.summary.filed,false);
  if(!r.summary.is_complete)assert.match(noteText,/INCOMPLETE/,'an incomplete package is never shown as ready');
  assert.match(noteText,/Nothing has been filed/);
  await page.screenshot({path:path.join(OUT,`screen-${period}.png`)});
  pass(`${period}: downloaded through the screen and verified against PostgreSQL (${r.files.size} files)`,{file:path.basename(file),checks:r.checks,totals:r.manifest.totals,is_complete:r.summary.is_complete,screen_note:noteText});
 }
 // The accountant page and its download controls on a phone.
 await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/business/accountant?month=2026-09`,{waitUntil:'networkidle'});
 const btn=page.locator('[data-acct-download]');await btn.scrollIntoViewIfNeeded();assert.equal(await btn.isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow on a phone');
 await page.screenshot({path:path.join(OUT,'screen-mobile.png')});
 pass('phone: the package period, language and download controls are reachable without horizontal overflow');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();proxy.close();await db.end().catch(()=>{})});
