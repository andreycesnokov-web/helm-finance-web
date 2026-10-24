// Client copy of the server's transaction classifier (server/lib/financialInsights.js,
// classifyTransaction). Performance needs it per transaction for the drill-down and for
// signed funding, which the monthly series cannot give. Read-only and pure.
// tests/design/v2CashClass.test.mjs runs both on the same rows and fails if they disagree,
// so this file cannot drift from the server.
//
// AC-0 / I-1: GET /api/transactions returns `cash_class`, the server's answer with the evidence the client does not
// have (funding register, business purpose, confirmed category groups). When present it is the answer, so Pulse,
// Performance and the server figures classify the same operation the same way.
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
    /capital\s+(injection|contribution|funding)/i, /\bfinancing\b/i, /\bmodal\s+(disetor|usaha)\b/i,
    /shareholder\s+loan/i, /\bfunding\b/i, /\bdividend\b/i,
    /liquidity\s+reserve/i, /capital\s+reserve/i, /treasury\s+reserve/i],
  revenue: [/\brevenue\b/i, /\bsales\b/i, /\bpenjualan\b/i, /wash\s+revenue/i,
    /advertising\s+slot/i, /co-?branding/i, /partner\s+settlement/i,
    /xendit\s+settlement/i, /\bsettlement\b/i, /\bincome\b/i,
    /(client|customer)\s+payment/i, /payment\s+(from|by)\s+(client|customer)/i,
    /pembayaran\s+(dari\s+)?(klien|pelanggan)/i, /pelunasan\s+piutang/i,
    /client\s+(fee|retainer|project|contract)/i, /customer\s+(invoice|fee|billing)/i],
  direct_cost: [/refill/i, /liquid\s+supplies/i, /\bsupplies\b/i, /\bmaintenance\b/i,
    /\belectricity\b/i, /\blistrik\b/i, /\blogistics\b/i, /\bcogs\b/i,
    /direct\s+cost/i, /\bconsumables?\b/i],
  operating_expense: [/\brent\b/i, /\bsewa\b/i, /\bsalary\b/i, /\bpayroll\b/i, /\bgaji\b/i,
    /\bmarketing\b/i, /\bsoftware\b/i, /subscription/i, /\bbank\b.*\bfee\b/i,
    /admin\s+fee/i, /\butilit(y|ies)\b/i, /\binsurance\b/i, /\boffice\b/i,
    /(vendor|supplier)\s+invoice/i, /invoice\s+(pembelian|vendor|supplier)/i,
    /pembayaran\s+(ke\s+|kepada\s+)?(vendor|supplier)/i, /tagihan\s+vendor/i],
}
const NOT_CAPEX = [/maintenance/i, /\brepair/i, /\bservicing\b/i, /\brental\b/i, /\brent\b/i]
const hay = (tx) => `${(tx && tx.category) || ''} ${(tx && tx.description) || ''} ${(tx && tx.notes) || ''}`.trim()
const hit = (list, s) => list.some((re) => re.test(s))
const CLASSES = ['revenue', 'direct_cost', 'operating_expense', 'capex', 'tax', 'interest', 'financing',
  'opening_balance', 'transfer', 'balance_correction', 'other', 'unknown', 'personal']

function wordsClass(s, type) {
  if (!s) return null
  if (hit(RE.balance_correction, s)) return 'balance_correction'
  if (hit(RE.opening_balance, s)) return 'opening_balance'
  if (hit(RE.transfer, s)) return 'transfer'
  if (hit(RE.capex, s) && !hit(NOT_CAPEX, s)) return 'capex'
  if (hit(RE.tax, s)) return 'tax'
  if (hit(RE.interest, s)) return 'interest'
  if (hit(RE.financing, s)) return 'financing'
  if (type === 'income') return hit(RE.revenue, s) ? 'revenue' : null
  if (type === 'expense') {
    if (hit(RE.direct_cost, s)) return 'direct_cost'
    if (hit(RE.operating_expense, s)) return 'operating_expense'
  }
  return null
}

/** Same buckets and order as the server (without its evidence). Returns the class name only. */
export function classOf(tx) {
  if (tx && CLASSES.includes(tx.cash_class)) return tx.cash_class
  const type = (tx && tx.type) || ''
  const src = (tx && tx.source) || ''
  // Ledger facts first. D4-A: a moved opening anchor (and its reversal) is an opening balance, not a correction.
  if (/^opening_reanchor(_reversal)?$/.test(src)) return 'opening_balance'
  if (type === 'correction') return 'balance_correction'
  if ((tx && tx.is_opening_balance === true) || /wallet_opening_balance/i.test(src)) return 'opening_balance'
  if (type === 'transfer' || (tx && tx.transfer_id)) return 'transfer'
  if (type === 'payroll') return 'operating_expense'
  // The category a person chose, then the bank's wording.
  return wordsClass(String((tx && tx.category) || '').trim(), type) || wordsClass(hay(tx), type) || 'unknown'
}

/** Operating cost classes: what "costs" means in Performance. */
export const COST_CLASSES = ['direct_cost', 'operating_expense']
