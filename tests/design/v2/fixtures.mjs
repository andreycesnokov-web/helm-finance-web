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

export const routes = {
  'GET /api/pulse': () => pulse,
  'GET /api/workspaces': () => workspaces,
  'PATCH /api/workspace-preferences': () => ({ ok: true }),
  'GET /api/admin/status': () => ({ is_admin: true }),
  'GET /api/access/status': () => ({ limits: {}, usage: {}, plan: { effective_plan: 'founder' } }),
  'GET /api/business/financial-counts': () => ({ ok: true, counts: { transactions: 40, wallets: 3, debts: 7 } }),
  'GET /api/debts': () => debts,
}
