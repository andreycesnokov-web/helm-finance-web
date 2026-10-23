// UI only, built app + existing synthetic fixtures; no database/API acceptance claim.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {chromium} from 'playwright-core'
import {installFixtureTransport} from './fixtureTransport.mjs'
const dir=path.resolve('reports/payroll-preview');fs.mkdirSync(dir,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM})
try{
 for(const [width,height,name]of [[1440,1000,'desktop'],[390,844,'mobile']]){
  const c=await browser.newContext({viewport:{width,height}});await installFixtureTransport(c)
  const token='x.'+Buffer.from(JSON.stringify({userId:1,firstName:'Demo'})).toString('base64')+'.y'
  await c.addInitScript(t=>{localStorage.setItem('hf_token',t);localStorage.setItem('hf_lang','en')},token)
  const page=await c.newPage(),runs=[];let posts=0,cashPosts=0,lastBody
  page.on('pageerror',e=>console.log('Synthetic UI error:',e.message))
  page.on('request',req=>{if(req.method()==='POST'&&/\/api\/(transactions|payroll\/payments)/.test(req.url()))cashPosts++})
  await page.route('**/api/access/status',r=>r.fulfill({json:{limits:{payroll_enabled:true},usage:{},plan:{effective_plan:'founder'}}}))
  await page.route('**/api/financial-operations/recent',r=>r.fulfill({json:{operations:[]}}))
  await page.route('**/api/payroll/runs',r=>r.fulfill({json:{runs,limit:100,cash_changed:false}}))
  await page.route('**/api/payroll/runs/action',async r=>{
   posts++;lastBody=r.request().postDataJSON();assert.equal(lastBody.action,'create');assert.ok(lastBody.request_key)
   const run={id:'synthetic-run',version:1,status:'draft',period_month:lastBody.period_month,payment_date:lastBody.payment_date,wallet_id:lastBody.wallet_id,
    payroll_payments:lastBody.lines.map((l,i)=>({id:'p'+i,employee_id:l.employee_id,employee_name:'Employee '+(i+1),status:'draft',net_amount:Number(l.salary),employer_bpjs:Number(l.employer_bpjs)}))}
   runs.push(run);await r.fulfill({json:{ok:true,run,audit_id:'synthetic-audit',cash_changed:false}})
  })
  await page.goto('http://127.0.0.1:4332/business/payroll',{waitUntil:'networkidle'})
  await page.locator('[data-pay-run]').click()
  const modal=page.getByRole('dialog');
  try{await modal.getByRole('heading',{name:'Monthly payroll draft'}).waitFor({timeout:5000})}
  catch(e){console.log('Synthetic page text:',(await page.locator('body').innerText()).slice(-1800));await page.screenshot({path:path.join(dir,name+'-error.png')});throw e}
  await modal.getByLabel('PPh 21 · Employee One',{exact:true}).fill('0')
  await modal.getByLabel('PPh 21 · Employee Two',{exact:true}).fill('0')
  // Employer BPJS is not on the accountant's sheet: it sits under More.
  await modal.locator('[data-payrun-more]').click()
  await modal.getByLabel('Employer BPJS · Employee One',{exact:true}).fill('50000')
  assert.match(await modal.innerText(),/Rp 10,000,000/)
  const save=modal.getByRole('button',{name:'Save draft',exact:true});assert.equal(await save.isDisabled(),true)
  await modal.getByRole('checkbox',{name:/I entered the PPh 21/}).check()
  assert.equal(await save.isEnabled(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await modal.locator('.v2-modal-body').evaluate(el=>{el.scrollTop=0})
  await modal.screenshot({path:path.join(dir,name+'-filled.png')})
  if(name==='mobile')await modal.locator('.v2-payd-row:not(.is-head)').first().screenshot({path:path.join(dir,'mobile-employee-fields.png')})
  await save.evaluate(el=>{el.click();el.click()})
  await page.waitForFunction(()=>!document.querySelector('.v2-modal'))
  assert.equal(posts,1);assert.equal(cashPosts,0);assert.equal(lastBody.lines[0].employer_bpjs,'50000')
  await page.locator('.v2-payrun-history-row').first().click()
  await page.getByRole('dialog').getByRole('button',{name:'Approve payroll — no transfer'}).waitFor()
  await page.getByRole('dialog').screenshot({path:path.join(dir,name+'-saved-draft.png')})
  assert.equal(cashPosts,0);await c.close()
 }
 console.log('Payroll UI fixtures PASS: desktop/mobile, accountant-entered zeros, separate employer BPJS, atomic single draft request, history and no payment POST')
}finally{await browser.close()}
