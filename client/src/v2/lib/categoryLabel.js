// The default categories (server/lib/defaultCategories.js) are stored in English — the
// classifier reads those words — and shown in the app language. A name the company typed
// itself, or renamed, is shown as it is. Values sent to the server stay the stored name.
const KEYS = {
  'Sales revenue': 'sales',
  'Service revenue': 'service',
  'Payment gateway settlement': 'gatewayIn',
  'Supplier refunds': 'supplierRefunds',
  'Other income': 'otherIncome',
  'Owner funding (loan)': 'ownerLoan',
  'Capital contribution': 'capital',
  'Loan proceeds': 'loanIn',
  'Transfer between own accounts — in': 'transferIn',
  'Intercompany — in': 'intercoIn',
  'Supplier invoices': 'supplierInvoices',
  'Rent': 'rent',
  'Salary and wages': 'salary',
  'Payroll tax (PPh 21) and BPJS': 'payrollTax',
  'Taxes (PPh, PPN)': 'taxes',
  'Utilities': 'utilities',
  'Internet and telecom': 'telecom',
  'Marketing and advertising': 'marketing',
  'Office expenses': 'office',
  'Professional services': 'professional',
  'Software and subscriptions': 'software',
  'Transport and logistics': 'transport',
  'Bank fee and admin': 'bankFee',
  'Payment gateway fees': 'gatewayFees',
  'Customer refunds': 'customerRefunds',
  'Other expenses': 'otherExpenses',
  'Equipment and fixed assets': 'equipment',
  'Loan repayments': 'loanOut',
  'Owner withdrawal / dividends': 'ownerOut',
  'Transfer between own accounts — out': 'transferOut',
  'Intercompany — out': 'intercoOut',
  'Opening balance': 'opening',
  'Transfer': 'transfer',
  'Payroll': 'payroll',
  'payroll': 'payroll',
  'Balance Correction': 'correction',
}

export function catLabel(t, name) {
  const k = KEYS[String(name || '').trim()]
  return k ? t(`cat.${k}`) : name
}

// Descriptions the server writes itself (opening balance, correction, transfer, payroll) are
// stored in English; they are shown in the app language. Anything else is shown as stored.
const DESC = [
  [/^Opening balance · (.+)$/, 'opening'],
  [/^Balance correction: (.+?)(?: \[admin:[^\]]*\])?$/, 'correction'],
  [/^Transfer: (.+) → (.+)$/, 'transfer'],
  [/^Payroll payment for (.+?)(?: — (\d{4}-\d{2}))?$/, 'payroll'],
]
export function descLabel(t, text) {
  const s = String(text || '')
  for (const [re, k] of DESC) {
    const m = s.match(re)
    if (m) return t(`txdesc.${k}${k === 'payroll' && !m[2] ? 'NoMonth' : ''}`, { a: m[1], b: m[2] || '' })
  }
  return text
}
