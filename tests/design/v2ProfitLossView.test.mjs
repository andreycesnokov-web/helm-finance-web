import {test} from 'node:test'
import assert from 'node:assert/strict'
import {exactMoney,difference,sourceLinks,copy,metricDetail,metricTotal,reportSeries,expenseBreakdown,reportCsv,chartMoneyScale,monthlyReportCsv} from '../../client/src/v2/lib/profitLossView.js'
import {createRequire} from 'node:module'
import {safeTarget} from '../../client/src/v2/lib/aiLinks.js'
const require=createRequire(import.meta.url),{B,fixture}=require('../fixtures/profitLoss.cjs'),{buildReport}=require('../../server/lib/profitLoss.js')
test('money presentation and comparison never round huge or fractional decimals',()=>{
 assert.equal(exactMoney('9007199254740993.000000000000000001'),'Rp 9,007,199,254,740,993.000000000000000001')
 assert.equal(difference('0.3','0.2'),'0.1');assert.equal(difference('0','0.000000000000000001'),'-0.000000000000000001')
 assert.equal(exactMoney(null),'—');assert.equal(exactMoney('bad'),'—');assert.equal(difference(null,'0'),null)
})
test('P&L money uses full native units while approximate chart axes declare their divisor',()=>{
 for(const [value,expected]of [['0','Rp 0'],['100000000','Rp 100,000,000'],['-100000000.01','Rp −100,000,000.01'],['0.000000000000000001','Rp 0.000000000000000001']])assert.equal(exactMoney(value),expected)
 assert.equal(exactMoney('100.123456789012345678','USD'),'USD 100.123456789012345678')
 for(const [max,divisor]of [['10','1'],['1000','1,000'],['100000000','1,000,000'],['1000000000','1,000,000,000'],['1000000000000','1,000,000,000,000']]){
  const scale=chartMoneyScale([null,'0','-'+max,max]);assert.ok(scale.unitLabel.startsWith('≈ IDR × '+divisor));assert.equal(scale.formatTick(0),'0')
 }
 const scale=chartMoneyScale(['100000000'],'IDR');assert.equal(scale.formatTick(10000000),'10');assert.equal(scale.formatTick(-1250000),'-1.25')
 assert.ok(chartMoneyScale(['0'],'USD').unitLabel.startsWith('≈ USD × 1'))
})
test('both CSV exports preserve fractional digits beyond Number precision without unit abbreviations',()=>{
 const f=fixture();f.transactions[0].amount_original='9007199254740993.000000000000000001'
 const r=buildReport(f,{businessId:B,month:'2026-08'})
 const monthly=monthlyReportCsv(r,['2026-08']),detail=reportCsv(r)
 assert.ok(monthly.includes('month,currency,basis,revenue'))
 assert.ok(monthly.includes('2026-08,IDR,provisional_cash,9007199254740968.000000000000000001'))
 assert.ok(detail.includes('9007199254740993.000000000000000001'))
 const cols=monthly.slice(1).split('\r\n')[0].split(','),row=monthly.slice(1).split('\r\n')[1].split(',')
 assert.equal(row[cols.indexOf('net')],'');assert.equal(row[cols.indexOf('depreciation')],'')
 assert.ok(!monthly.includes('Rp '));assert.ok(!monthly.includes('9.0B'))
})
test('source routes reuse real V2 transaction, bill and invoice deep links',()=>{
 const links=sourceLinks({transaction_id:'7',bills:[{id:'9',type:'payable'},{id:'8',type:'receivable'}],payroll:[{id:'p'}]})
 assert.deepEqual(links.map(x=>x.href),['/business/transactions?tx=7','/business/payables/9','/business/receivables/8','/business/payroll'])
})
test('existing AI note link preserves report currency and a strictly read-only metric',()=>{
 assert.equal(safeTarget('/business/performance?month=2026-08&currency=USD&detail=operating_cost'),'/business/performance?month=2026-08&currency=USD&detail=operating_cost')
 assert.equal(safeTarget('/business/performance?detail=delete'),null)
 assert.equal(safeTarget('/business/performance?currency=USD%29,other'),null)
})
test('supported languages explicitly distinguish cash estimate and unsupported accrual',()=>{
 for(const lang of ['en','ru','id']){const c=copy(lang);assert.ok(c.cash);assert.ok(c.accrual);assert.ok(c.netNote);assert.ok(c.missing)}
})
test('all clickable waterfall totals equal the signed records inside their panel',()=>{
 const r=buildReport(fixture(),{businessId:B,month:'2026-08',compare:'2026-07'})
 for(const metric of ['revenue','direct_cost','gross','operating_cost','ebitda','other_income','interest','tax','cash_result']){
  const d=metricDetail(r,'2026-08',metric)
  assert.equal(d.total,metricTotal(r,'2026-08',metric))
  const sum=d.groups.flatMap(g=>g.categories.flatMap(c=>c.entries)).reduce((n,e)=>difference(n,difference('0',e.contribution)),'0')
  assert.equal(sum,d.total,metric)
 }
 assert.equal(metricDetail(r,'2026-08','net_profit').total,null)
 assert.equal(metricDetail(r,'2026-08','net_profit').groups.length,0)
 const series=reportSeries(r,['2026-07','2026-08']);assert.equal(series[1].revenue,'975.1');assert.equal(series[1].net,null)
 const cats=expenseBreakdown(r,'2026-08','2026-07');assert.ok(cats.changes.some(x=>x.category==='Rent'&&x.now==='90.3'&&x.before==='0.1'))
 assert.ok(reportCsv(r).includes('SYN-RENT'))
})
