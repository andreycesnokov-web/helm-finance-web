// Current built V2 with synthetic API transport. No database / external AI calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {chromium} from 'playwright-core'
import {installFixtureTransport} from './fixtureTransport.mjs'
import {exactMoney,metricDetail} from '../../../client/src/v2/lib/profitLossView.js'
const require=createRequire(import.meta.url),{B,OTHER,fixture}=require('../../fixtures/profitLoss.cjs'),{buildReport}=require('../../../server/lib/profitLoss.js')
const root=path.resolve(process.env.PNL_BUILD_ROOT||'reports/pnl-completion-20261022/after-dist'),out=path.resolve(process.env.PNL_BROWSER_OUT||'reports/pnl-completion-20261022/browser-completion');fs.mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results=[]
try{for(const width of [1440,320,375,390,430]){
 const context=await browser.newContext({viewport:{width,height:width===1440?1100:844},acceptDownloads:true});await installFixtureTransport(context,{root})
 const token='x.'+Buffer.from(JSON.stringify({userId:1,firstName:'Synthetic'})).toString('base64')+'.y'
 await context.addInitScript(token=>{localStorage.setItem('hf_token',token);localStorage.setItem('hf_lang','en')},token)
 const f=fixture(),errors=[],requests=[],checks=[];let report,mode='ok',reads=0
 f.debts[0].counterparty='Synthetic Landlord'
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({method:r.method(),url:r.url()})})
 await context.route('**/api/workspaces',r=>r.fulfill({json:{personal:[],business:[{id:B,name:'Synthetic P&L Co',type:'business',role:'auditor',is_last_active:true},{id:OTHER,name:'Other Synthetic Co',type:'business',role:'auditor'}]}}))
 await context.route('**/api/financial-operations/recent',r=>r.fulfill({json:{operations:[]}}))
 for(const pattern of ['**/api/pulse','**/api/pulse/advanced-insights?*','**/api/accountant/obligations','**/api/business-funding'])await context.route(pattern,r=>r.fulfill({status:503,json:{error:'synthetic_legacy_outage'}}))
 await context.route('**/api/transactions?*',r=>{const id=new URL(r.request().url()).searchParams.get('id');return r.fulfill({json:id?f.transactions.filter(t=>t.id===id&&t.business_id===B):[]})})
 await context.route('**/api/debts*',r=>{const id=new URL(r.request().url()).searchParams.get('id');return r.fulfill({json:id?f.debts.filter(t=>t.id===id):[]})})
 await context.route('**/api/cashflow-categories',r=>r.fulfill({json:{categories:f.categories}}))
 await context.route('**/api/pulse/profit-loss?*',r=>{
  reads++;const q=Object.fromEntries(new URL(r.request().url()).searchParams)
  report=buildReport(f,{businessId:B,...q});return r.fulfill({json:mode==='foreign'?{...report,business_id:OTHER}:report})
 })
 const base='http://127.0.0.1:4332/business/performance',url=base+'?month=2026-08'
 await page.goto(url,{waitUntil:'networkidle'});await page.locator('[data-pnl-metric="revenue"]').waitFor()
 assert.ok((await page.locator('[data-pnl-metric="revenue"]').innerText()).includes('Rp 975.1'));checks.push('legacy_api_outage_does_not_block_cash_report')
 assert.ok((await page.locator('main').innerText()).includes('count by transaction date'));assert.ok(!(await page.locator('main').innerText()).includes('when you invoice or deliver'));checks.push('methodology_text_matches_cash_model')
 const n=reads;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForLoadState('networkidle');await page.locator('[data-pnl-metric="revenue"]').waitFor();assert.ok(reads>n);checks.push('refresh_issues_fresh_report_read')
 await page.getByRole('combobox',{name:'Month',exact:true}).count().then(n=>assert.equal(n,0))
 const month=page.getByLabel('Month',{exact:true});await month.fill('2024-01');await page.waitForLoadState('networkidle');await page.locator('[data-pnl-metric="revenue"]').waitFor();assert.equal(report.month,'2024-01');assert.equal(await month.inputValue(),'2024-01');assert.ok((await page.locator('[data-pnl-metric="revenue"]').innerText()).includes('Rp 0'));checks.push('historical_month_not_silently_replaced')
 await page.goto(base+'?month=2024-01&compare=2025-01',{waitUntil:'networkidle'});await page.locator('[data-pnl-metric="revenue"]').waitFor();assert.equal(report.compare,'2025-01');checks.push('valid_future_comparison_uses_bounded_history')
 for(const q of ['month=2026-13','month=2026-08&compare=2024-08','month=2026-08&currency=idr']){
  const before=reads;await page.goto(base+'?'+q,{waitUntil:'networkidle'});await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-pnl-metric]').count(),0);assert.equal(reads,before)
 }
 await page.getByRole('button',{name:'Reset report filters'}).click();await page.locator('[data-pnl-metric="revenue"]').waitFor();checks.push('invalid_filters_explicit_error_reset_no_report_query')
 mode='foreign';await page.goto(url,{waitUntil:'networkidle'});await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-pnl-metric]').count(),0);mode='ok';checks.push('mismatched_company_response_rejected_without_forever_loading')
 await page.goto(url+'&detail=constructor',{waitUntil:'networkidle'});await page.getByRole('dialog').getByRole('alert').waitFor();await page.getByRole('button',{name:'Back to report'}).click();assert.equal(await page.getByRole('dialog').count(),0);checks.push('unknown_metric_explicit_error_and_close')
 await page.locator('[data-pnl-metric="cash_result"]').click();let modal=page.getByRole('dialog');assert.equal(await modal.locator('[data-pnl-total]').innerText(),exactMoney(metricDetail(report,'2026-08','cash_result').total));await modal.getByRole('button',{name:'Expand all',exact:true}).click();await page.screenshot({path:path.join(out,`${width}-cash-result.png`)});await page.keyboard.press('Escape');checks.push('cash_result_signed_drill_reconciles_not_net_profit')
 await page.locator('[data-pnl-metric="operating_cost"]').click();modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Expand all',exact:true}).click()
 const [dl]=await Promise.all([page.waitForEvent('download'),modal.getByRole('button',{name:'Export detail CSV'}).click()]);await dl.saveAs(path.join(out,`${width}-opex.csv`));const csv=fs.readFileSync(path.join(out,`${width}-opex.csv`),'utf8');assert.ok(csv.includes('-100.3,100.30,operating_cost'));assert.ok(!csv.includes('2026-07-31'));assert.ok(csv.includes('missing_transaction_date'));assert.ok((await modal.innerText()).includes('cannot be assigned to a month'));checks.push('selected_period_signed_csv_and_undated_exception_explanation')
 // An older source absent from the truncated list still opens the existing V2 dialog.
 const source=modal.locator('.pnl-metric-group .pnl-entry').first().getByRole('link',{name:/^Transaction/})
 const [txPage]=await Promise.all([context.waitForEvent('page'),source.click()]);await txPage.waitForLoadState('networkidle');await txPage.getByRole('dialog').waitFor();assert.equal(await txPage.getByRole('dialog').getByRole('textbox').first().inputValue(),'Synthetic Rent');assert.ok(await txPage.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).isDisabled());await txPage.close();checks.push('missing_list_record_lookup_opens_actual_readonly_transaction_dialog')
 const bill=modal.getByRole('link',{name:/^Bill \/ invoice/}).first();const [billPage]=await Promise.all([context.waitForEvent('page'),bill.click()]);await billPage.waitForLoadState('networkidle');await billPage.getByRole('heading',{name:'Synthetic Landlord',exact:true}).waitFor();await billPage.close();checks.push('missing_list_record_lookup_opens_actual_v2_bill')
 const doc=modal.getByRole('link',{name:/SYN-RENT/});const [docPage]=await Promise.all([context.waitForEvent('page'),doc.click()]);await docPage.waitForLoadState('networkidle');await docPage.getByRole('dialog').waitFor();await docPage.close();checks.push('supporting_document_opens_actual_document_drawer')
 await page.keyboard.press('Escape');await page.screenshot({path:path.join(out,`${width}-overview.png`),fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('no_horizontal_page_overflow')
 assert.deepEqual(errors,[]);assert.equal(requests.filter(x=>x.method!=='GET').length,0);checks.push('no_browser_errors_no_api_writes')
 results.push({width,checks,ok:true});await context.close()
}fs.writeFileSync(path.join(out,'RESULTS.json'),JSON.stringify({layer:'actual built V2 + synthetic transport; not native Auth/RLS acceptance',results},null,2));console.log(JSON.stringify(results.map(x=>({width:x.width,checks:x.checks.length,ok:x.ok}))))}finally{await browser.close()}
