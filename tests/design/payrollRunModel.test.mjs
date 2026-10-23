import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parsePayrollMoney,payrollTotals,payrollLine,payrollPayloadLine,payrollMainFields,payrollMoreFields,payrollMoneyFields} from '../../client/src/v2/lib/payrollRunModel.js'
import {canonicalFinancialIntent,requestDescription} from '../../server/lib/financialIntent.mjs'
import {latestPayrollRun} from '../../client/src/v2/lib/obligations.js'
test('draft/cancelled or separately grouped durable runs cannot be labelled paid by the legacy summary',()=>{
 const payments=[{period_month:'2026-08',status:'draft'},{period_month:'2026-08',status:'cancelled'},
  {period_month:'2026-08',status:'scheduled',run_id:'run'}]
 assert.equal(latestPayrollRun({payments}),null)
})
test('whole IDR formatting, invalid/negative/nonfinite values and upper bounds',()=>{
 for(const s of ['1500000','1.500.000','1,500,000','1 500 000'])assert.equal(parsePayrollMoney(s),1500000)
 for(const s of ['-1','1.50','1,2','1e8','Infinity','1,000.00','1000000000001'])assert.ok(Number.isNaN(parsePayrollMoney(s)))
})
test('employer BPJS never reduces take-home and drafts reconstruct stored items',()=>{
 const row={salary:'1000000',bonus:'100000',earnings:'50000',pph21:'10000',bpjs:'20000',other:'5000',employer_bpjs:'50000'}
 assert.equal(payrollTotals(row).net,1115000)
 assert.equal(payrollTotals({...row,employer_bpjs:'999999'}).net,1115000)
 const r=payrollLine({id:'x',name:'Demo',default_salary:1},{employer_bpjs:50000,payroll_payment_items:[{item_type:'salary',amount:1150000},{item_type:'pph21',amount:0}]})
 assert.equal(r.salary,'1150000');assert.equal(r.pph21,'0');assert.equal(r.employer_bpjs,'50000')
})
test('accountant sheet: BPJS split gives the sheet take-home, saves bpjs as the total and rebuilds from items',()=>{
 // Gaji bulan ini 8,474,663 − PPh 21 154,663 − BPJS KS 80,000 − JP 80,000 − JHT 160,000 = Gaji bersih 8,000,000.
 const row={id:'e1',salary:'8474663',bonus:'',earnings:'',pph21:'154663',bpjs_kes:'80000',bpjs_jp:'80000',bpjs_jht:'160000',bpjs:'',other:'',employer_bpjs:''}
 const c=payrollTotals(row);assert.equal(c.gross,8474663);assert.equal(c.bpjsTotal,320000);assert.equal(c.net,8000000)
 assert.deepEqual(payrollPayloadLine(row),{employee_id:'e1',salary:'8474663',bonus:'0',earnings:'0',pph21:'154663',bpjs:'320000',
  bpjs_kes:'80000',bpjs_jp:'80000',bpjs_jht:'160000',other:'0',employer_bpjs:'0'})
 // An unsplit BPJS sum (old drafts, or entered under More) adds to the parts.
 assert.equal(payrollPayloadLine({...row,bpjs:'5000'}).bpjs,'325000')
 const items=[['salary',8474663],['pph21',154663],['bpjs_kes',80000],['bpjs_jp',80000],['bpjs_jht',160000]].map(([item_type,amount])=>({item_type,amount}))
 const back=payrollLine({id:'e1',name:'Sheet employee 1'},{employer_bpjs:0,payroll_payment_items:items})
 assert.equal(payrollTotals(back).net,8000000);assert.equal(back.bpjs,'')
 assert.deepEqual([...payrollMainFields,...payrollMoreFields].sort(),[...payrollMoneyFields].sort())
 // The summary still counts every BPJS part as BPJS and never as tax.
 const run=latestPayrollRun({payments:[{status:'paid',period_month:'2026-09',gross_amount:8474663,net_amount:8000000,
  payroll_payment_items:items.slice(1).map(i=>({...i,label:i.item_type,direction:'deduction'}))}]})
 assert.equal(run.bpjs,320000);assert.equal(run.tax,154663)
})
test('all payroll actions reuse existing durable intent/recovery mechanism',()=>{
 assert.equal(requestDescription('/payroll/runs/action').operation,'payroll_run')
 const p={action:'approve',run_id:'abc',version:1}
 assert.deepEqual(canonicalFinancialIntent('payroll_run',{...p,request_key:'first'}),canonicalFinancialIntent('payroll_run',{...p,request_key:'second'}))
 assert.notDeepEqual(canonicalFinancialIntent('payroll_run',p),canonicalFinancialIntent('payroll_run',{...p,version:2}))
})
