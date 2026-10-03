// Client copy of the server's transaction classifier (server/lib/financialInsights.js,
// classifyTransaction). Performance needs it per transaction for the drill-down and for
// signed funding, which the monthly series cannot give. Read-only and pure.
// tests/design/v2CashClass.test.mjs runs both on the same rows and fails if they disagree,
// so this file cannot drift from the server.
const RE = {
  opening_balance: [/opening\s+balance/i, /wallet_opening_balance/i, /\bsaldo\s+awal\b/i],
  transfer: [/\btransfer\b/i, /intercompany/i, /\bmove\s+to\b/i, /between\s+wallets/i],
  balance_correction: [/balance\s+correction/i, /\breconcil/i],
  capex: [/\bequipment\b/i, /\bmachine(ry)?\b/i, /\bhardware\b/i, /\bdevice\b/i,
    /asset\s+purchase/i, /purchase\s+of\s+(a\s+)?(machine|equipment|device)/i,
    /\bperalatan\b/i, /\bmesin\b/i, /capital\s+expenditure/i, /\bcapex\b/i],
  tax: [/\bdjp\b/i, /\bpph\b/i, /\bppn\b/i, /\bpajak\b/i, /tax\s+payable/i,
    /withholding/i, /\bbukti\s+potong\b/i, /\btax\b/i],
  interest: [/\binterest\b/i, /\bbunga\b/i, /loan\s+interest/i],
  financing: [/loan\s+(repayment|principal|proceeds)/i, /owner\s+(funding|withdrawal|draw)/i,
    /capital\s+(injection|contribution)/i, /\bfinancing\b/i, /\bmodal\b/i,
    /shareholder\s+loan/i, /\bfunding\b/i, /\bdividend\b/i],
  revenue: [/\brevenue\b/i, /\bsales\b/i, /\bpenjualan\b/i, /wash\s+revenue/i,
    /advertising\s+slot/i, /co-?branding/i, /partner\s+settlement/i,
    /xendit\s+settlement/i, /\bsettlement\b/i, /\bincome\b/i],
  direct_cost: [/refill/i, /liquid\s+supplies/i, /\bsupplies\b/i, /\bmaintenance\b/i,
    /\belectricity\b/i, /\blistrik\b/i, /\blogistics\b/i, /\bcogs\b/i,
    /direct\s+cost/i, /\bconsumables?\b/i],
  operating_expense: [/\brent\b/i, /\bsewa\b/i, /\bsalary\b/i, /\bpayroll\b/i, /\bgaji\b/i,
    /\bmarketing\b/i, /\bsoftware\b/i, /subscription/i, /\bbank\b.*\bfee\b/i,
    /admin\s+fee/i, /\butilit(y|ies)\b/i, /\binsurance\b/i, /\boffice\b/i],
}
const NOT_CAPEX = [/maintenance/i, /\brepair/i, /\bservicing\b/i, /\brental\b/i, /\brent\b/i]
const hay = (tx) => `${(tx && tx.category) || ''} ${(tx && tx.description) || ''} ${(tx && tx.notes) || ''}`.trim()
const hit = (list, s) => list.some((re) => re.test(s))

/** Same buckets and order as the server. Returns the class name only. */
export function classOf(tx) {
  const s = hay(tx)
  const type = (tx && tx.type) || ''
  const src = (tx && tx.source) || ''
  if (type === 'correction' || hit(RE.balance_correction, s)) return 'balance_correction'
  if (hit(RE.opening_balance, s) || /wallet_opening_balance/i.test(src)) return 'opening_balance'
  if (type === 'transfer' || hit(RE.transfer, s)) return 'transfer'
  if (!s) return 'unknown'
  if (hit(RE.capex, s) && !hit(NOT_CAPEX, s)) return 'capex'
  if (hit(RE.tax, s)) return 'tax'
  if (hit(RE.interest, s)) return 'interest'
  if (hit(RE.financing, s)) return 'financing'
  if (type === 'income') return hit(RE.revenue, s) ? 'revenue' : 'unknown'
  if (type === 'payroll') return 'operating_expense'
  if (type === 'expense') {
    if (hit(RE.direct_cost, s)) return 'direct_cost'
    if (hit(RE.operating_expense, s)) return 'operating_expense'
    return 'unknown'
  }
  return 'unknown'
}

/** Operating cost classes: what "costs" means in Performance. */
export const COST_CLASSES = ['direct_cost', 'operating_expense']
