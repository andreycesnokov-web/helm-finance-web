export const payrollMoneyFields = ['salary','bonus','earnings','pph21','bpjs','other','employer_bpjs']
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
  const deduction=numbers.pph21+numbers.bpjs+numbers.other
  return {...numbers,gross,deduction,net:gross-deduction}
}
export function payrollLine(employee,payment=null) {
  const result={id:employee.id,name:employee.name,on:true,...Object.fromEntries(payrollMoneyFields.map(k=>[k,'']))}
  result.salary=String(employee.default_salary||'')
  if(payment){
    result.salary='0'
    for(const item of payment.payroll_payment_items||[])if(payrollMoneyFields.includes(item.item_type))result[item.item_type]=String(item.amount)
    result.employer_bpjs=String(payment.employer_bpjs||0)
  }
  return result
}
