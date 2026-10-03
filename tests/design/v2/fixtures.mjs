// Synthetic API answers for the design-v2 visual harness. TEST DATA ONLY — this
// file is never imported by client code. Figures are invented for a fictional
// "Test Facilities" workspace and dated relative to "today" so the screens
// exercise overdue / upcoming / pending states on any day the harness runs.
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString() }

const debt = (id, type, counterparty, amount, due, extra = {}) => ({
  id, type, counterparty, amount, original_amount: amount, paid_amount: 0, remaining_amount: amount,
  due_date: day(due), status: due < 0 ? 'overdue' : 'open', days_overdue: due < 0 ? -due : 0,
  approval_status: 'approved', description: extra.description || '', currency: 'IDR', created_at: iso(-20), ...extra,
})

export const DEBTS = [
  debt('d1', 'receivable', 'CV Harbor Supply', 12500000, -9, { description: 'Invoice INV-0412' }),
  debt('d2', 'receivable', 'PT Coastal Resorts', 17500000, 6, { description: 'Invoice INV-0416' }),
  debt('d3', 'receivable', 'PT Northwind', 48200000, 14, { description: 'Invoice INV-0418' }),
  debt('d4', 'payable', 'PT Office Tower', 7400000, 4, { description: 'Office rent' }),
  debt('d5', 'payable', 'PT Legal Partners', 10000000, 8, { approval_status: 'pending_approval', description: 'Legal services' }),
  debt('d6', 'payable', 'PT Clean Chem', 15600000, 18, { description: 'Cleaning chemicals' }),
  debt('d7', 'payable', 'Loan interest', 200000, 12, { description: 'Monthly interest' }),
  debt('d8', 'payable', 'Old supplier', 3000000, -40, { status: 'paid', is_settled: true, paid_amount: 3000000, remaining_amount: 0 }),
  debt('d9', 'payable', 'Budi Santoso', 300000, 2, { approval_status: 'pending_approval', description: 'Fuel for site visits' }),
]

const TXS = Array.from({ length: 24 }).map((_, i) => ({
  id: `t${i}`, type: i % 3 === 0 ? 'income' : 'expense', amount_original: (i % 3 === 0 ? 9000000 : 2500000) + i * 10000,
  amount_idr: (i % 3 === 0 ? 9000000 : 2500000) + i * 10000, currency_original: 'IDR',
  description: i % 3 === 0 ? `Customer payment ${i}` : `Supplier ${i}`, category: i % 5 === 0 ? null : (i % 3 === 0 ? 'Sales' : 'Supplies'),
  transaction_date: day(-i * 4), created_at: iso(-i * 4), scope: 'business', source: 'BCA', wallet_id: 'w1',
}))

export const PULSE = {
  scope: 'business', totalBalance: 122900000, income: 78700000, expenses: 153900000,
  burnRate: 2130000, runway: 58, burnWindowDays: 30,
  receivables: 78200000, payables: 33200000, netPosition: 167900000,
  operating: { revenue: 78700000, cash_out: 153900000, net_position: -75200000 },
  other_cash_movement: {}, needs_review_count: 3,
  pendingReceivables: 0, pendingPayables: 10300000,
  aiStatus: 'attention', aiText: 'Runway 58 days. Check receivables.',
  accounts: [
    { id: 'w1', name: 'BCA Operating', balance: 98000000, currency: 'IDR', type: 'bank' },
    { id: 'w2', name: 'Mandiri', balance: 20000000, currency: 'IDR', type: 'bank' },
    { id: 'w3', name: 'Cash box', balance: 4900000, currency: 'IDR', type: 'cash' },
  ],
  debts: DEBTS, reminders: [], todayFocus: [], recentTxs: TXS.slice(0, 5),
}

export const WORKSPACES = {
  personal: [{ id: 'p1', name: 'Personal', type: 'personal', is_primary: true }],
  business: [
    { id: 'b1', name: 'Test Facilities', type: 'business', role: 'owner', is_default: true, is_last_active: true },
    { id: 'b2', name: 'Second Company', type: 'business', role: 'cfo' },
  ],
}

export function route(method, path) {
  const p = path.split('?')[0]
  const R = {
    'GET /api/pulse': PULSE,
    'GET /api/workspaces': WORKSPACES,
    'PATCH /api/workspace-preferences': { ok: true },
    'GET /api/admin/status': { is_admin: true },
    'GET /api/profile': { language: 'en' },
    'GET /api/access/status': {
      business: { id: 'b1', name: 'Test Facilities' }, membership: { role: 'owner' },
      effective_plan: 'business', plan_label: 'Business', features: {
        payroll_enabled: true, approval_flow_enabled: true, advanced_radar_enabled: true,
      },
    },
    'GET /api/debts': DEBTS,
    'GET /api/transactions': { transactions: TXS },
    'GET /api/wallets': { wallets: PULSE.accounts.map((a) => ({ ...a, is_active: true, scope: 'business' })) },
    'GET /api/accountant/summary': { upcoming: [
      { title: 'PPh 23 — monthly payment', due_date: day(12), days: 12, status: 'upcoming', period: 'prev', rule_code: 'PPH23_MONTHLY' },
    ], overdue: [] },
    'GET /api/business/financial-counts': { ok: true, counts: { transactions: 24, wallets: 3, debts: 9 } },
  }
  const key = `${method} ${p}`
  if (key in R) return { status: 200, body: R[key] }
  return null
}
