// Every amount a payroll line can carry. `bpjs` is BPJS entered as one sum (no split); the accountant's sheet
// splits it into BPJS Kesehatan / TK JP / TK JHT, which go to two different payees.
export const payrollMoneyFields = ['salary','bonus','earnings','pph21','bpjs_kes','bpjs_jp','bpjs_jht','bpjs','other','employer_bpjs']
export const payrollBpjsParts = ['bpjs_kes','bpjs_jp','bpjs_jht']
// The columns of the accountant's monthly sheet, in its order; the rest open under "More".
export const payrollMainFields = ['salary','bonus','pph21','bpjs_kes','bpjs_jp','bpjs_jht']
export const payrollMoreFields = ['earnings','bpjs','other','employer_bpjs']
export function payrollErrorMessage(error,t) {
 const code=error?.data?.error||error?.code
 const key=code==='payroll_stale_review'?'stale':code==='payroll_employee_period_exists'?'exists':
  ['payroll_forbidden','financial_recovery_forbidden'].includes(code)?'forbidden':
  code==='payroll_transaction_mismatch'?'bankMismatch':code==='payroll_transaction_already_allocated'?'bankAllocated':
  code==='payroll_bank_evidence_required'?'bankEvidenceMissing':code==='payroll_migration_required'?'migration':
  code==='payroll_paid_history_locked'?'locked':null
 return t(key?'payr.errors.'+key:'payr.error')
}
export function parsePayrollMoney(value) {
  const text=String(value??'').trim()
  if(text==='')return 0
  if(!/^(?:\d+|\d{1,3}(?:[., ]\d{3})+)$/.test(text))return NaN
  const n=Number(text.replace(/[., ]/g,''))
  return Number.isSafeInteger(n)&&n<=1e12?n:NaN
}
export function payrollTotals(row) {
  const numbers=Object.fromEntries(payrollMoneyFields.map(k=>[k,parsePayrollMoney(row[k])]))
  const gross=numbers.salary+numbers.bonus+numbers.earnings
  const bpjsTotal=numbers.bpjs_kes+numbers.bpjs_jp+numbers.bpjs_jht+numbers.bpjs
  const deduction=numbers.pph21+bpjsTotal+numbers.other
  return {...numbers,gross,bpjsTotal,deduction,net:gross-deduction}
}
// The saved line: `bpjs` is the employee's TOTAL BPJS deduction, the parts are its split.
export function payrollPayloadLine(row) {
  const c=payrollTotals(row)
  return {employee_id:row.id,salary:String(c.salary),bonus:String(c.bonus),earnings:String(c.earnings),pph21:String(c.pph21),
    bpjs:String(c.bpjsTotal),...Object.fromEntries(payrollBpjsParts.map(k=>[k,String(c[k])])),other:String(c.other),employer_bpjs:String(c.employer_bpjs)}
}
export function payrollLine(employee,payment=null) {
  const result={id:employee.id,name:employee.name,on:true,...Object.fromEntries(payrollMoneyFields.map(k=>[k,'']))}
  result.salary=String(employee.default_salary||'')
  if(payment){
    result.salary='0'
    // Stored items: each BPJS part under its own type; `bpjs` holds only the unsplit remainder.
    for(const item of payment.payroll_payment_items||[])if(payrollMoneyFields.includes(item.item_type))result[item.item_type]=String(item.amount)
    result.employer_bpjs=String(payment.employer_bpjs||0)
  }
  return result
}
