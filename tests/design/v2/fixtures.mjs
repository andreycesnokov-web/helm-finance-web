// Synthetic API responses for the design-v2 screenshot harness. NOT shipped, NOT
// demo data from the designs: a fictional "Demo Trading Co" with made-up figures,
// used only to render the v2 screens locally (tests/design/v2/serve.mjs).
const today = new Date()
const iso = (offsetDays) => { const d = new Date(today); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10) }

export const debts = [
  { id: 'd1', type: 'payable', counterparty: 'PT Example Supplies', description: 'Office supplies', amount: 8400000, remaining_amount: 8400000, original_amount: 8400000, paid_amount: 0, due_date: iso(3), status: 'open', approval_status: 'pending_approval', currency: 'IDR', created_at: iso(-4) },
  { id: 'd2', type: 'receivable', counterparty: 'CV Sample Client', description: 'Invoice 0007', amount: 14100000, remaining_amount: 14100000, original_amount: 14100000, paid_amount: 0, due_date: iso(-6), status: 'overdue', days_overdue: 6, approval_status: 'approved', currency: 'IDR', created_at: iso(-30) },
  { id: 'd3', type: 'payable', counterparty: 'Landlord Example', description: 'Office rent', amount: 5200000, remaining_amount: 5200000, original_amount: 5200000, paid_amount: 0, due_date: iso(5), status: 'open', approval_status: 'approved', currency: 'IDR', created_at: iso(-10) },
  { id: 'd4', type: 'receivable', counterparty: 'PT Test Resort', description: 'Maintenance contract', amount: 19300000, remaining_amount: 19300000, original_amount: 19300000, paid_amount: 0, due_date: iso(6), status: 'open', approval_status: 'approved', currency: 'IDR', created_at: iso(-12) },
  { id: 'd5', type: 'payable', counterparty: 'Small Vendor', description: 'Cleaning cloths', amount: 350000, remaining_amount: 350000, original_amount: 350000, paid_amount: 0, due_date: iso(9), status: 'open', approval_status: 'approved', currency: 'IDR', created_at: iso(-2) },
  { id: 'd6', type: 'payable', counterparty: 'Tax office (PPh 23)', description: 'Withholding', amount: 710000, remaining_amount: 710000, original_amount: 710000, paid_amount: 0, due_date: iso(12), status: 'open', approval_status: 'approved', currency: 'IDR', created_at: iso(-1) },
  { id: 'd7', type: 'payable', counterparty: 'PT Contractor Demo', description: 'Site repair', amount: 22600000, remaining_amount: 22600000, original_amount: 22600000, paid_amount: 0, due_date: iso(18), status: 'open', approval_status: 'approved', currency: 'IDR', created_at: iso(-3) },
]

export const recentTxs = [
  { id: 't1', type: 'income', description: 'Client payment', amount_original: 9200000, currency_original: 'IDR', transaction_date: iso(-1) },
  { id: 't2', type: 'expense', description: 'Fuel', amount_original: 420000, currency_original: 'IDR', transaction_date: iso(-2), category: null },
  { id: 't3', type: 'expense', description: 'Payroll', amount_original: 21000000, currency_original: 'IDR', transaction_date: iso(-5), category: 'Payroll' },
]

export const pulse = {
  scope: 'business', totalBalance: 96400000, income: 61200000, expenses: 118300000,
  burnRate: 1900000, runway: 51, burnWindowDays: 30,
  receivables: 33400000, payables: 37110000, netPosition: 92690000,
  operating: { revenue: 61200000, cash_out: 118300000, net_position: -57100000 },
  other_cash_movement: 0, needs_review_count: 4,
  pendingReceivables: 0, pendingPayables: 8400000,
  aiStatus: 'healthy', aiText: 'Runway 51 days.',
  accounts: [
    { id: 'w1', name: 'BCA Operating', balance: 71200000, currency: 'IDR', type: 'bank', scope: 'business' },
    { id: 'w2', name: 'Mandiri Payroll', balance: 23100000, currency: 'IDR', type: 'bank', scope: 'business' },
    { id: 'w3', name: 'Cash box', balance: 2100000, currency: 'IDR', type: 'cash', scope: 'business' },
  ],
  debts, reminders: [], todayFocus: [], recentTxs,
}

export const workspaces = {
  personal: [{ id: 'p1', name: 'My personal', type: 'personal', is_primary: true }],
  business: [
    { id: 'b1', name: 'Demo Trading Co', type: 'business', role: 'owner', is_default: true, is_last_active: true },
    { id: 'b2', name: 'Second Demo Ltd', type: 'business', role: 'manager' },
  ],
}

export const wallets = [
  { id: 'w1', name: 'BCA Operating', currency: 'IDR', type: 'bank', scope: 'business', balance: 71200000, is_active: true },
  { id: 'w2', name: 'Mandiri Payroll', currency: 'IDR', type: 'bank', scope: 'business', balance: 23100000, is_active: true, entity_name: 'Payroll' },
  { id: 'w3', name: 'Cash box', currency: 'IDR', type: 'cash', scope: 'business', balance: 2100000, is_active: true },
]
export const counterparties = [
  { id: 'c1', name: 'PT Example Supplies', legal_name: 'PT Example Supplies', display_name: 'PT Example Supplies', role: 'vendor', npwp: '0123456789012345', pkp_status: 'pkp', bank_accounts: [{ account_number: '1234567890' }], source_system: 'mcp' },
  { id: 'c2', name: 'Example Supply', legal_name: 'Example Supply', display_name: 'Example Supply', role: 'vendor', npwp: null, pkp_status: 'unknown', bank_accounts: [{ account_number: '1234567890' }] },
  { id: 'c3', name: 'CV Sample Client', legal_name: 'CV Sample Client', display_name: 'CV Sample Client', role: 'customer', npwp: '987654321098765', pkp_status: 'non_pkp', bank_accounts: [] },
  { id: 'c4', name: 'PT Test Resort', legal_name: 'PT Test Resort', display_name: 'PT Test Resort', role: 'customer', npwp: '111122223333444', pkp_status: 'pkp', bank_accounts: [], default_tax_treatment: 'Possibly PPh 23 — needs accountant review' },
]
export const transactions = [
  { id: 101, type: 'income', description: 'Gateway settlement', category: 'Sales', amount_original: 3100000, currency_original: 'IDR', wallet_id: 'w1', transaction_date: iso(-1), scope: 'business', bank_import_batch_id: 'b1' },
  { id: 102, type: 'expense', description: 'TRF 0192 FUEL', category: null, amount_original: 450000, currency_original: 'IDR', wallet_id: 'w1', transaction_date: iso(-2), scope: 'business', bank_import_batch_id: 'b1' },
  { id: 103, type: 'expense', description: 'Electricity', category: 'Utilities', amount_original: 2050000, currency_original: 'IDR', wallet_id: 'w1', transaction_date: iso(-3), scope: 'business' },
  { id: 104, type: 'transfer', description: 'BCA → Mandiri', category: 'Transfer', amount_original: 20000000, currency_original: 'IDR', wallet_id: 'w1', transaction_date: iso(-6), scope: 'business' },
  { id: 105, type: 'expense', description: 'Marketplace order', category: '', amount_original: 380000, currency_original: 'IDR', wallet_id: 'w3', transaction_date: iso(-7), scope: 'business' },
  { id: 106, type: 'payroll', description: 'Payroll', category: 'Payroll', amount_original: 21000000, currency_original: 'IDR', wallet_id: 'w2', transaction_date: iso(-5), scope: 'business' },
]
export const routes = {
  'GET /api/pulse': () => pulse,
  'GET /api/workspaces': () => workspaces,
  'PATCH /api/workspace-preferences': () => ({ ok: true }),
  'GET /api/admin/status': () => ({ is_admin: true }),
  'GET /api/access/status': () => ({ limits: {}, usage: {}, plan: { effective_plan: 'founder' } }),
  'GET /api/business/financial-counts': () => ({ ok: true, counts: { transactions: 40, wallets: 3, debts: 7 } }),
  'GET /api/debts': () => debts,
  'GET /api/wallets': () => ({ wallets }),
  'GET /api/counterparties': () => ({ counterparties }),
  'GET /api/transactions': (u) => (u.searchParams.get('type') === 'transfer' ? transactions.filter((t) => t.type === 'transfer') : transactions),
  'GET /api/cashflow-categories': () => ({ categories: [{ name: 'Sales' }, { name: 'Supplies' }, { name: 'Utilities' }, { name: 'Fuel' }] }),
  'GET /api/bank-import/batches': () => ({ batches: [{ id: 'b1', wallet_id: 'w1', statement_end: iso(-1), status: 'review_required' }] }),
  'GET /api/accountant/rules': () => ({ jurisdiction: 'ID', rules: [{ id: 'r1', rule_code: 'ID_PPH23_SERVICES', title: 'PPh 23 · services', obligation_type: 'withholding', parameters: { rate: 2 } }] }),
  'GET /api/accountant/summary': () => ({ overdue: [], upcoming: [
    { id: 'ev1', rule_code: 'ID_PPH21', title: 'PPh 21', period: iso(-20).slice(0, 7), due_date: iso(7), status: 'upcoming', payment_status: 'unpaid', estimated_amount: 140000, days: 7 },
    { id: 'ev2', rule_code: 'ID_SPT_MASA', title: 'SPT Masa PPh 21', period: iso(-20).slice(0, 7), due_date: iso(12), status: 'upcoming', payment_status: 'unpaid', days: 12 },
  ], missing_profile_fields: [] }),
  'POST /api/accountant/ask': () => ({ answer: 'Synthetic answer for the screenshot harness.', used_rules: [{ rule_code: 'ID_PPH23_SERVICES' }] }),
  'GET /api/accountant/profile': () => ({ profile: { company_legal_name: 'PT Demo Trading', legal_entity_type: 'pt', foreign_owned: 'no', country: 'ID', financial_year_start: '01-01', financial_year_end: '12-31', npwp: '0123456789012345', pkp_status: 'non_pkp', tax_regime: 'general', primary_kbli: '81210', field_verification: {} }, completeness: { percent: 86 } }),
  'GET /api/accountant/applicability': () => ({ applicable_rules: [{ rule_code: 'ID_PPH21', title: 'PPh 21', reason: 'You have employees.' }, { rule_code: 'ID_PPH23_SERVICES', title: 'PPh 23', reason: 'You pay for services.' }],
    excluded_rules: [{ rule_code: 'ID_PPN', reason: 'Not PKP.' }], missing_profile_fields: [] }),
  'GET /api/ai-accountant/required-documents': () => ({ items: [{ type: 'akta', status: 'uploaded' }, { type: 'nib', status: 'uploaded' }, { type: 'npwp', status: 'needs_review' }, { type: 'sk_kemenkumham', status: 'missing' }] }),
  'GET /api/documents': () => ({ documents: [
    { id: 'doc1', document_type: 'receipt', review_status: 'needs_review', links: [], created_at: iso(-2), file: { file_name: 'IMG_0042.jpg', upload_channel: 'telegram' } },
    { id: 'doc2', document_type: 'invoice', review_status: 'confirmed', links: [{ id: 'l1' }], gross_amount: 8400000, currency: 'IDR', created_at: iso(-1), file: { file_name: 'invoice-demo-supplies.pdf', upload_channel: 'mcp' } },
  ] }),
  'GET /api/ai-cfo/context': () => ({
    cash: { total_balance: pulse.totalBalance }, runway_days: 51,
    current_month: { income: 61200000, expenses: 118300000, net_flow: -57100000 },
    receivables: { total_remaining: 33400000, overdue_total: 14100000, overdue_count: 1 },
    pending_submissions: { count: 1 },
    ai_alert: { status: 'warning', headline: 'Costs are running ahead of sales', description: 'Collections would lift the low point.' },
    cfo_score: { score: 58, status: 'warning', label: 'Needs attention', summary: 'Spending and collections pull the score down.',
      factors: { cash_health: { score: 70, impact: 'neutral' }, runway: { score: 55, impact: 'negative' }, receivables: { score: 40, impact: 'negative' }, payables: { score: 85, impact: 'positive' }, expense_control: { score: 38, impact: 'negative' } } },
    next_actions: [
      { title: 'Follow up: CV Sample Client', description: 'Overdue — send a payment reminder.', priority: 'high', route: '/receivables', amount: 14100000 },
      { title: 'Review payables due this week', description: 'Two bills fall due within 7 days.', priority: 'medium', route: '/payables' },
      { title: 'Hold new hires', description: 'Spending exceeds income this month.', priority: 'low', route: '/payroll' },
    ],
    usage: { max_ai_questions_per_month: 200, remaining_ai_questions: 200 },
  }),
  'POST /api/ai-cfo/ask': () => ({ answer: 'Synthetic harness answer. Costs rose after the [site expansion](cfo://performance?month=2026-04&compare=2026-03&focus=site-expansion); collections are late.', context_summary: { total_balance: pulse.totalBalance, runway_days: 51 }, used_ai_provider: false }),
  'GET /api/team': () => ({ members: [{ id: 'm1', user_id: 1, role: 'owner', display_name: 'Demo Owner' }, { id: 'm2', user_id: 2, role: 'accountant', display_name: 'Demo Accountant' }] }),
  'GET /api/payroll/overview': () => ({
    employees: [{ id: 'e1', name: 'Employee One', role: 'Operations', default_salary: 6000000, default_wallet_id: 'w2' }, { id: 'e2', name: 'Employee Two', role: 'Sales', default_salary: 4000000 }],
    payments: [
      { id: 'p1', employee_id: 'e1', employee_name: 'Employee One', period_month: iso(-5).slice(0, 7), payment_date: iso(-5), status: 'paid', gross_amount: 6000000, net_amount: 5820000,
        payroll_payment_items: [{ direction: 'addition', amount: 6000000, label: 'Salary' }, { direction: 'deduction', amount: 60000, label: 'PPh 21' }, { direction: 'deduction', amount: 120000, label: 'BPJS' }] },
      { id: 'p2', employee_id: 'e2', employee_name: 'Employee Two', period_month: iso(-5).slice(0, 7), payment_date: iso(-5), status: 'paid', gross_amount: 4000000, net_amount: 3920000,
        payroll_payment_items: [{ direction: 'addition', amount: 4000000, label: 'Salary' }, { direction: 'deduction', amount: 80000, label: 'BPJS' }] },
    ], summary: {} }),
  'GET /api/pulse/advanced-insights': (u) => ({ ok: true, metrics: u.searchParams.get('to') === iso(-31)
    ? { operating_revenue: 52300000, operating_cash_out: 70100000, capex: 0, tax_expense: 0, interest_expense: 0 }
    : { operating_revenue: 61200000, operating_cash_out: 96100000, capex: 14800000, tax_expense: 1200000, interest_expense: 0 } }),
  'GET /api/accountant/obligations': () => ({ period: '2026-09', obligations: [
    { obligation_type: 'pph_21_26', title: 'PPH 21/26', currency: 'IDR', period: '2026-09', due_date: iso(7), status: 'calculated', amount: 1340000 },
    { obligation_type: 'pph_23', title: 'PPH 23', currency: 'IDR', period: '2026-09', due_date: iso(7), status: 'insufficient_data', amount: null },
  ] }),
}
