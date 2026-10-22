// Actual built UI, deterministic synthetic transport. No network/DB/application writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {chromium} from 'playwright-core'
import {installFixtureTransport} from './fixtureTransport.mjs'
import {exactMoney,metricDetail} from '../../../client/src/v2/lib/profitLossView.js'
const require=createRequire(import.meta.url)
const {B,OTHER,fixture}=require('../../fixtures/profitLoss.cjs')
const {buildReport}=require('../../../server/lib/profitLoss.js')
const FININ=require('../../../server/lib/financialInsights.js')
const stage=process.env.PNL_REVIEW_STAGE||'after'
assert.ok(['baseline','before','after'].includes(stage))
const out=path.resolve(process.env.PNL_BROWSER_OUT||'reports/pnl-final-review-20261022/'+stage);fs.mkdirSync(out,{recursive:true})
const root=path.resolve(process.env.PNL_BUILD_ROOT||(stage==='baseline'?'reports/interactive-pnl-20261021/before-dist':stage==='before'?'reports/interactive-pnl-20261021/after-dist':'reports/pnl-final-review-20261022/after-dist'))
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const results=[]
const scale=v=>{const [i,f='']=String(v).split('.'),n=BigInt(i+f.padEnd(18,'0'))*1000000n,frac=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return (n/10n**18n).toString()+(frac?'.'+frac:'')}
async function singleLineMoney(page){
 return page.locator('.pnl-money, .pnl-financial-row > .v2-num, .pnl-performance .v2-tile-val').evaluateAll(nodes=>nodes.filter(e=>e.getClientRects().length).map(e=>{
  const range=document.createRange();range.selectNodeContents(e)
  return {text:e.textContent,nowrap:getComputedStyle(e).whiteSpace==='nowrap',lines:[...range.getClientRects()].map(r=>Math.round(r.top)).filter((x,i,a)=>a.indexOf(x)===i).length}
 }))
}
try{
 for(const width of [1440,320,375,390,430]){
  const height=width===1440?1100:844,label=width===1440?'desktop':`mobile-${width}`
  const context=await browser.newContext({viewport:{width,height},acceptDownloads:true})
  await installFixtureTransport(context,{root})
  const token='x.'+Buffer.from(JSON.stringify({userId:1,firstName:'Synthetic'})).toString('base64')+'.y'
  await context.addInitScript(t=>{localStorage.setItem('hf_token',t);localStorage.setItem('hf_lang','en')},token)
  const f=fixture();f.transactions=f.transactions.map(t=>({...t,amount_original:scale(t.amount_original)}))
  f.debts=f.debts.map(d=>({...d,original_amount:scale(d.original_amount)}))
  const page=await context.newPage(),errors=[],requests=[];let report
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({method:r.method(),url:new URL(r.url()).pathname})})
  await context.route('**/api/workspaces',r=>r.fulfill({json:{personal:[],business:[{id:B,name:'Synthetic P&L Co',type:'business',role:'owner',is_last_active:true},{id:OTHER,name:'Other Synthetic Co',type:'business',role:'owner'}]}}))
  await context.route('**/api/financial-operations/recent',r=>r.fulfill({json:{operations:[]}}))
  await context.route('**/api/transactions?*',r=>r.fulfill({json:f.transactions}))
  await context.route('**/api/cashflow-categories',r=>r.fulfill({json:{categories:f.categories}}))
  await context.route('**/api/debts',r=>r.fulfill({json:f.debts}))
  await context.route('**/api/pulse/advanced-insights?*',r=>r.fulfill({json:FININ.computeInsights(f.transactions)}))
  await context.route('**/api/pulse/profit-loss?*',r=>{
   report=buildReport(f,{businessId:B,...Object.fromEntries(new URL(r.request().url()).searchParams)})
   return r.fulfill({json:{...report,read_started_at:'2026-10-22T00:00:00Z',read_finished_at:'2026-10-22T00:00:01Z'}})
  })
  const url='http://127.0.0.1:4332/business/performance?month=2026-08'
  await page.goto(url,{waitUntil:'networkidle'})
  await page.getByRole('heading',{name:'Performance',exact:true}).waitFor()
  await page.screenshot({path:path.join(out,`${label}-overview.png`),fullPage:true})
  await page.getByRole('heading',{name:/From revenue to profit/}).evaluate(e=>e.scrollIntoView({block:'start'}))
  await page.screenshot({path:path.join(out,`${label}-waterfall.png`)})
  if(stage==='baseline'){
   const cells=await page.locator('.v2-waterfall dd').evaluateAll(nodes=>nodes.map(e=>({text:e.textContent,width:e.clientWidth,height:e.clientHeight,wrap:getComputedStyle(e).overflowWrap})))
   results.push({viewport:label,width,stage,source:'a55876d Performance/BarChart blobs',baseline_cells:cells,ok:true})
   await context.close();continue
  }
  const opener=page.locator('[data-pnl-metric="operating_cost"]')
  await opener.click();let modal=page.getByRole('dialog');await modal.waitFor()
  await modal.getByRole('button',{name:'Expand all',exact:true}).click()
  await page.screenshot({path:path.join(out,`${label}-detail.png`)})
  if(stage==='before'){
   await modal.getByRole('link',{name:/SYN-RENT/}).evaluate(e=>e.scrollIntoView({block:'center'}))
   await page.screenshot({path:path.join(out,`${label}-evidence.png`)})
   results.push({viewport:label,width,stage,source:'ee37d33 pre-fix built UI',ok:true})
   await context.close();continue
  }
  const checks=[]
  if(width<1025){
   const rect=await page.evaluate(()=>{const a=document.querySelector('[data-financial-recovery]').getBoundingClientRect(),b=document.querySelector('.v2-tabbar').getBoundingClientRect();return {recoveryBottom:a.bottom,navTop:b.top}})
   assert.ok(rect.recoveryBottom<=rect.navTop,JSON.stringify(rect))
   checks.push('recovery_above_mobile_navigation')
  }
  // Monetary values must not break into characters, including the exact source amount.
  for(const x of await singleLineMoney(page))assert.ok(x.nowrap&&x.lines<=1,JSON.stringify(x))
  assert.equal((await modal.locator('[data-pnl-total]').innerText()).trim(),exactMoney(metricDetail(report,'2026-08','operating_cost').total))
  assert.equal(await modal.evaluate(e=>e.scrollWidth>e.clientWidth),false)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  checks.push('single_line_full_money','exact_panel_total','no_page_or_modal_overflow')
  // Compact entry: original description, bank/audit status and journal gap remain reachable.
  const entry=modal.locator('.pnl-metric-group .pnl-entry').first(),technical=entry.locator('.pnl-technical')
  assert.equal(await technical.getAttribute('open'),null)
  assert.ok((await entry.innerText()).includes('Synthetic IDR bank'))
  await technical.locator('summary').focus();await page.keyboard.press('Enter')
  assert.notEqual(await technical.getAttribute('open'),null)
  assert.ok((await technical.innerText()).includes('Synthetic Rent'))
  assert.ok((await technical.innerText()).includes('reconciliation not confirmed'))
  assert.ok((await technical.innerText()).includes('Journal entry'))
  await technical.locator('summary').press('Space');assert.equal(await technical.getAttribute('open'),null)
  checks.push('compact_summary','keyboard_expand_evidence_audit')
  const docs=entry.getByRole('link',{name:/SYN-RENT/});assert.equal(await docs.count(),1)
  await docs.evaluate(e=>e.scrollIntoView({block:'center'}))
  await page.screenshot({path:path.join(out,`${label}-evidence.png`)})
  const event=context.waitForEvent('page');await docs.click();const linked=await event;await linked.waitForLoadState('networkidle');assert.ok(linked.url().includes('/business/documents?doc=doc1'));await linked.close()
  await technical.locator('summary').click();await technical.locator('summary').evaluate(e=>e.scrollIntoView({block:'start'}))
  await page.screenshot({path:path.join(out,`${label}-audit-expanded.png`)})
  checks.push('document_navigation','full_audit_retained')
  const scroll=modal.locator('.v2-modal-body');await scroll.evaluate(e=>e.scrollTop=e.scrollHeight)
  const scrollState=await scroll.evaluate(e=>({top:e.scrollTop,max:e.scrollHeight-e.clientHeight}))
  assert.ok(scrollState.top>0&&Math.abs(scrollState.top-scrollState.max)<3)
  // Inert background + P&L-only overlay protects against both tab bar and recovery button.
  assert.ok(await page.locator('#root').evaluate(e=>e.inert))
  const close=modal.locator('[data-modal-x]');await close.click({trial:true})
  const hit=await close.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})
  assert.ok(hit)
  const protectedPoint=await modal.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.right-8,r.bottom-8))})
  assert.ok(protectedPoint)
  checks.push('modal_scroll_to_end','close_unobscured','background_inert','navigation_recovery_no_overlap')
  const focusables=()=>modal.locator('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]').filter({visible:true})
  await focusables().last().focus();await page.keyboard.press('Tab');assert.ok(await close.evaluate(e=>e===document.activeElement))
  await page.keyboard.press('Shift+Tab');assert.ok(await focusables().last().evaluate(e=>e===document.activeElement))
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.ok(await opener.evaluate(e=>e===document.activeElement));assert.equal(await page.locator('#root').evaluate(e=>e.inert),false)
  checks.push('focus_trap_forward_backward','escape_focus_restoration')
  // Button and backdrop close must restore focus too; preserve reload context.
  await opener.click();await page.getByRole('dialog').locator('[data-modal-x]').click();assert.ok(await opener.evaluate(e=>e===document.activeElement))
  await opener.click();await page.locator('.pnl-modal-scrim').click({position:{x:2,y:2}});assert.equal(await page.getByRole('dialog').count(),0);assert.ok(await opener.evaluate(e=>e===document.activeElement))
  await opener.click();const saved=page.url();await page.reload({waitUntil:'networkidle'});modal=page.getByRole('dialog');await modal.waitFor();assert.equal(page.url(),saved)
  checks.push('close_button_focus','backdrop_focus','reload_context')
  await page.keyboard.press('Escape')
  for(const metric of ['revenue','direct_cost','gross','operating_cost','ebitda','net_profit']){
   await page.locator(`[data-pnl-metric="${metric}"]`).click();modal=page.getByRole('dialog')
   assert.equal((await modal.locator('[data-pnl-total]').innerText()).trim(),exactMoney(metricDetail(report,'2026-08',metric).total))
   if(metric==='net_profit'){assert.ok((await modal.innerText()).includes('Net Profit is unavailable'));assert.equal(await modal.locator('.pnl-metric-group').count(),0)}
   await page.keyboard.press('Escape')
  }
  assert.equal(await page.getByRole('button',{name:/accrual/i}).count(),0)
  checks.push('six_rows_signed_lineage','unsupported_net_accrual_not_implemented')
  const chart=page.locator('.v2-chart').first();assert.ok((await chart.innerText()).includes('≈ IDR × 1,000,000 (M)'))
  await chart.getByRole('img').focus();await page.keyboard.press('Home')
  let found=false;for(let i=0;i<12;i++){if((await chart.locator('.v2-sr[aria-live]').innerText()).includes('Rp 975,100,000')){found=true;break}await page.keyboard.press('ArrowRight')}
  assert.ok(found)
  await chart.getByRole('button').click();assert.ok((await chart.getByRole('table').innerText()).includes('Rp 975,100,000'));await chart.getByRole('button').click()
  checks.push('chart_explicit_axis_units','chart_exact_keyboard_tooltip_table')
  // Exact fractional/unsafe-number edge case: display stays one line and CSV strings unchanged.
  f.transactions[0].amount_original='9007199254740993.000000000000000001'
  await page.goto(url,{waitUntil:'networkidle'})
  for(const x of await singleLineMoney(page))assert.ok(x.nowrap&&x.lines<=1,JSON.stringify(x))
  const [monthly]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export',exact:true}).click()]);await monthly.saveAs(path.join(out,`${label}-monthly.csv`))
  const monthlyCsv=fs.readFileSync(path.join(out,`${label}-monthly.csv`),'utf8')
  assert.ok(monthlyCsv.includes('9007199229740993.000000000000000001'))
  assert.ok(monthlyCsv.includes('currency,basis'))
  await page.locator('[data-pnl-metric="revenue"]').click();modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Expand all',exact:true}).click()
  for(const x of await singleLineMoney(page))assert.ok(x.nowrap&&x.lines<=1,JSON.stringify(x))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  const dlEvent=page.waitForEvent('download');await modal.getByRole('button',{name:'Export detail CSV'}).click();const dl=await dlEvent;await dl.saveAs(path.join(out,`${label}-detail.csv`))
  assert.ok(fs.readFileSync(path.join(out,`${label}-detail.csv`),'utf8').includes('9007199254740993.000000000000000001'))
  checks.push('large_fraction_no_vertical_wrap','monthly_csv_full_precision','detail_csv_full_precision')
  assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method!=='GET').length,0)
  checks.push('no_browser_errors','no_api_writes')
  results.push({viewport:label,width,height,checks,ok:true})
  await context.close()
 }
 fs.writeFileSync(path.join(out,'RESULTS.json'),JSON.stringify({stage,layer:'built V2 + synthetic transport; no native acceptance claim',results},null,2));console.log(JSON.stringify({stage,viewports:results.map(r=>({width:r.width,checks:r.checks?.length,ok:r.ok}))}))
}finally{await browser.close()}
