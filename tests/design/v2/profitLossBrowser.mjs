// Before/after real built V2, deterministic synthetic API transport only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {chromium} from 'playwright-core'
import {installFixtureTransport} from './fixtureTransport.mjs'
import {metricDetail,exactMoney} from '../../../client/src/v2/lib/profitLossView.js'
const require=createRequire(import.meta.url),{B,OTHER,fixture,tx}=require('../../fixtures/profitLoss.cjs'),{buildReport}=require('../../../server/lib/profitLoss.js'),FININ=require('../../../server/lib/financialInsights.js')
const dir=path.resolve('reports/interactive-pnl-20261021/browser-final');fs.mkdirSync(dir,{recursive:true})
const before=process.env.PNL_BEFORE==='true',root=path.resolve('reports/interactive-pnl-20261021/'+(before?'before-dist':'after-dist'))
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const results=[]
try{
 for(const [width,height,name]of [[1440,1100,'desktop'],[390,844,'mobile']]){
  const context=await browser.newContext({viewport:{width,height},acceptDownloads:true});await installFixtureTransport(context,{root})
  const token='x.'+Buffer.from(JSON.stringify({userId:1,firstName:'Synthetic'})).toString('base64')+'.y'
  await context.addInitScript(t=>{localStorage.setItem('hf_token',t);localStorage.setItem('hf_lang','en')},token)
  const f=fixture(),page=await context.newPage(),errors=[];let mode='ok',writes=0,lastReport
  page.on('pageerror',e=>errors.push(e.message))
  page.on('request',r=>{if(r.method()!=='GET'&&/\/api\/(transactions|debts|payroll|documents)/.test(r.url()))writes++})
  await context.route('**/api/workspaces',r=>r.fulfill({json:{personal:[],business:[{id:B,name:'Synthetic P&L Co',type:'business',role:'owner',is_last_active:true},{id:OTHER,name:'Other Synthetic Co',type:'business',role:'owner'}]}}))
  await context.route('**/api/financial-operations/recent',r=>r.fulfill({json:{operations:[]}}))
  await context.route('**/api/transactions?*',r=>r.fulfill({json:f.transactions}))
  await context.route('**/api/cashflow-categories',r=>r.fulfill({json:{categories:f.categories}}))
  await context.route('**/api/debts',r=>r.fulfill({json:f.debts}))
  await context.route('**/api/pulse/advanced-insights?*',r=>r.fulfill({json:FININ.computeInsights(f.transactions)}))
  await context.route('**/api/pulse/profit-loss?*',async r=>{
   if(mode==='error')return r.fulfill({status:503,json:{error:'profit_loss_unavailable'}})
   const p=new URL(r.request().url()).searchParams,q=Object.fromEntries(p),biz=r.request().headers()['x-business-id']||B
   if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,500))
   lastReport=buildReport(mode==='empty'?{...f,transactions:[]}:f,{businessId:biz,...q})
   return r.fulfill({json:{...lastReport,read_started_at:'2026-10-21T00:00:00Z',read_finished_at:'2026-10-21T00:00:01Z'}})
  })
  const url='http://127.0.0.1:4332/business/performance?month=2026-08'
  await page.goto(url,{waitUntil:'networkidle'})
  try{await page.getByRole('heading',{name:'Performance',exact:true}).waitFor({timeout:7000})}catch(e){console.log('Synthetic UI diagnostic:',JSON.stringify(errors),(await page.locator('body').innerText()).slice(-1000));throw e}
  for(const text of ['Revenue and gross profit','EBITDA and net profit','From revenue to profit','Where the money went','How profit is counted'])assert.ok(await page.getByRole('heading',{name:new RegExp(text)}).count(),text)
  assert.equal(await page.getByRole('img',{name:/Revenue and gross profit/}).count(),1)
  assert.equal(await page.getByRole('img',{name:/EBITDA and net profit/}).count(),1)
  await page.screenshot({path:path.join(dir,name+(before?'-before':'-after')+'-overview.png'),fullPage:true})
  await page.getByRole('heading',{name:/From revenue to profit/}).evaluate(e=>e.scrollIntoView({block:'start'}))
  await page.screenshot({path:path.join(dir,name+(before?'-before':'-after')+'-waterfall.png')})
  if(before){results.push({viewport:name,layer:'exact baseline Performance + BarChart blobs',preserved_blocks:5,ok:true});await context.close();continue}
  assert.equal(await page.locator('.pnl-table').count(),0,'No standalone report table on Performance')
  assert.equal(await page.locator('[role="dialog"]').count(),0)
  // Existing chart table/keyboard interactions still work.
  const chart=page.locator('.v2-chart').first();await chart.getByRole('button').click();assert.equal(await chart.getByRole('table').count(),1);await chart.getByRole('button').click()
  await chart.getByRole('img').focus();await page.keyboard.press('ArrowRight');assert.ok(await chart.locator('.v2-sr[aria-live]').innerText())
  for(const metric of ['revenue','direct_cost','gross','operating_cost','ebitda','net_profit']){
   const opener=page.locator(`[data-pnl-metric="${metric}"]`);await opener.click();const modal=page.getByRole('dialog');await modal.waitFor()
   assert.equal((await modal.locator('[data-pnl-total]').innerText()).trim(),exactMoney(metricDetail(lastReport,'2026-08',metric).total,'IDR'))
   if(metric==='net_profit'){assert.ok((await modal.innerText()).includes('Net Profit is unavailable'));assert.equal(await modal.locator('.pnl-metric-group').count(),0)}
   else {assert.ok(await modal.locator('.pnl-metric-group').count());await modal.getByRole('button',{name:'Expand all',exact:true}).click();assert.ok(await modal.locator('.pnl-metric-group .pnl-entry').count())}
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await opener.evaluate(e=>e===document.activeElement),true)
  }
  await page.locator('[data-pnl-metric="gross"]').click();let modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Expand all',exact:true}).click()
  const saved=page.url();await page.reload({waitUntil:'networkidle'});modal=page.getByRole('dialog');await modal.waitFor();assert.equal(page.url(),saved);assert.ok(await modal.locator('.pnl-metric-group .pnl-entry').count())
  assert.ok((await modal.innerText()).includes('No linked supporting document'))
  const source=modal.locator('.pnl-metric-group .pnl-entry').first().getByRole('link',{name:/^Transaction/});const event=context.waitForEvent('page');await source.click();const src=await event;await src.waitForLoadState('networkidle');assert.ok(src.url().includes('/business/transactions?tx=1'));await src.close();assert.equal(page.url(),saved)
  // OPEX retains invoice -> document navigation from its actual linked record.
  await page.keyboard.press('Escape');await page.locator('[data-pnl-metric="operating_cost"]').click();modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Expand all',exact:true}).click()
  assert.ok(await modal.getByRole('link',{name:/SYN-RENT/}).count());assert.ok((await modal.getByRole('link',{name:/SYN-RENT/}).getAttribute('href')).includes('/business/documents?doc=doc1'))
  await page.screenshot({path:path.join(dir,name+'-after-detail.png')})
  await modal.getByRole('link',{name:/SYN-RENT/}).evaluate(e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(dir,name+'-after-evidence.png')})
  assert.equal(await modal.evaluate(e=>e.scrollWidth>e.clientWidth),false,'No modal horizontal overflow')
  const dlEvent=page.waitForEvent('download');await modal.getByRole('button',{name:'Export detail CSV'}).click();const dl=await dlEvent;await dl.saveAs(path.join(dir,name+'-detail.csv'));assert.ok(fs.readFileSync(path.join(dir,name+'-detail.csv'),'utf8').includes('SYN-RENT'))
  await modal.getByLabel('Compare with',{exact:true}).fill('2026-07');await page.waitForTimeout(1000);modal=page.getByRole('dialog');assert.ok((await modal.innerText()).includes('2026-07'))
  mode='slow';await modal.getByLabel('Currency',{exact:true}).selectOption('USD');await page.waitForTimeout(30);assert.equal(await page.locator('[data-pnl-total]').count(),0);await page.getByRole('dialog').locator('[data-pnl-total]').waitFor();mode='ok';assert.equal(await page.getByRole('dialog').locator('[data-pnl-total]').innerText(),'USD 0')
  await page.keyboard.press('Escape');assert.ok(page.url().includes('currency=USD'))
  // Retained month filter and deep-link context; large details render in pages.
  f.transactions=Array.from({length:20000},(_,i)=>tx(i,'income','0.1','Product sales'))
  await page.goto(url,{waitUntil:'networkidle'});await page.locator('[data-pnl-metric="revenue"]').click();modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Expand all',exact:true}).click();assert.equal(await modal.locator('.pnl-metric-group .pnl-entry').count(),50);assert.equal(await modal.locator('[data-pnl-total]').innerText(),'Rp 2,000');await modal.getByRole('button',{name:/Show next 50/}).click();assert.equal(await modal.locator('.pnl-metric-group .pnl-entry').count(),100)
  await page.keyboard.press('Escape');mode='error';await page.goto(url+'&compare=2026-07',{waitUntil:'networkidle'});await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-pnl-metric]').count(),0)
  mode='empty';await page.goto(url,{waitUntil:'networkidle'});assert.ok((await page.locator('[data-pnl-metric="revenue"]').innerText()).includes('Rp 0'));assert.equal(await page.locator('[data-pnl-metric="net_profit"]').innerText(),'Net profit\n— ›')
  mode='slow';await page.evaluate(id=>window.dispatchEvent(new CustomEvent('workspace-switch',{detail:{id}})),OTHER);await page.waitForTimeout(100);assert.equal(await page.locator('[data-pnl-metric]').count(),0);await page.locator('[data-pnl-metric="revenue"]').waitFor();assert.ok(!(await page.locator('[data-pnl-metric="revenue"]').innerText()).includes('2,000'))
  assert.equal(writes,0);assert.deepEqual(errors,[])
  results.push({viewport:name,width,height,checks:['existing_5_blocks','two_existing_charts','chart_table_and_keyboard','six_clickable_rows','exact_panel_totals','signed_composite_lineage','no_fake_net','focus_return','reload_context','source_navigation','linked_document','comparison','csv','no_overflow','currency_guard','error','empty','20000_record_pagination','tenant_switch','no_financial_writes'],ok:true})
  await context.close()
 }
 fs.writeFileSync(path.join(dir,before?'BEFORE_RESULTS.json':'RESULTS.json'),JSON.stringify({layer:'built V2 + synthetic API transport, not full native application acceptance',results},null,2));console.log(JSON.stringify(results))
}finally{await browser.close()}
