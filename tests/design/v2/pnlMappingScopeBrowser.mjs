// Actual category form with synthetic transport; no live mapping is changed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {chromium} from 'playwright-core'
import {installFixtureTransport} from './fixtureTransport.mjs'
const require=createRequire(import.meta.url),{B,OTHER}=require('../../fixtures/profitLoss.cjs')
const root=path.resolve(process.env.PNL_BUILD_ROOT||'reports/pnl-completion-20261022/after-dist'),out=path.resolve('reports/pnl-completion-20261022/browser-mapping');fs.mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});await installFixtureTransport(context,{root})
 const token='x.'+Buffer.from(JSON.stringify({userId:1,firstName:'Synthetic'})).toString('base64')+'.y'
 await context.addInitScript(t=>{localStorage.setItem('hf_token',t);localStorage.setItem('hf_lang','en')},token)
 await context.route('**/api/workspaces',r=>r.fulfill({json:{personal:[],business:[{id:B,name:'First Synthetic Co',type:'business',role:'owner',is_last_active:true},{id:OTHER,name:'Other Synthetic Co',type:'business',role:'auditor'}]}}))
 let release,write;const pending=new Promise(r=>release=r),ready=new Promise(resolve=>write=resolve);let recorded
 await context.route('**/api/pnl-mapping',async r=>{
  const req=r.request(),business=req.headers()['x-business-id'];
  if(req.method()==='PATCH'){recorded={business,body:req.postDataJSON()};write();await pending;return r.fulfill({json:{ok:true,updated:1}})}
  return r.fulfill({json:{available:true,can_edit:business===B,confirmed:true,kbli:['81210'],categories:[{id:'cat1',name:business===B?'First company expense':'Other company category',group_type:'outflow',pnl_group:'operating_cost'}]}})
 })
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:4332/business/performance/groups',{waitUntil:'networkidle'})
 const select=page.getByRole('combobox',{name:/First company expense/});await select.selectOption('direct_cost');await page.locator('.v2-page button.v2-btn-primary').click();await ready
 assert.equal(recorded.business,B);assert.deepEqual(recorded.body,{mappings:[{category_id:'cat1',pnl_group:'direct_cost'}]})
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('workspace-switch',{detail:{id}})),OTHER)
 await page.getByText('Other company category',{exact:true}).waitFor();release();await page.waitForTimeout(200)
 assert.equal(await page.getByRole('combobox',{name:/Other company category/}).isDisabled(),true)
 assert.equal(await page.locator('.v2-page .v2-dec-done').count(),0);assert.ok(!(await page.locator('.v2-page').innerText()).includes('First company expense'))
 await page.screenshot({path:path.join(out,'mobile-other-company-readonly.png'),fullPage:true});assert.deepEqual(errors,[])
 const result={layer:'built V2 + synthetic PATCH transport only',checks:['mapping_action_pins_business_header','mapping_payload_reuses_existing_writer','late_old_company_completion_cannot_show_success','auditor_mapping_form_readonly'],ok:true};fs.writeFileSync(path.join(out,'RESULTS.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close()
}finally{await browser.close()}
