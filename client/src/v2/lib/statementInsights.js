// What a bank statement row probably is — rules, not a guess (design k/K4). The server's
// suggestion engine (POST /api/bank-imports/:id/suggest: rules, counterparty history, matches with
// bills / payroll, AI for the rest) proposes a category; this adds what a foreign owner needs to
// know about the row: money between the company's own accounts or its other companies, a gateway
// settlement, money from or to a private person, a payment abroad, rent, bank fees — and which tax
// that can create. Nothing here is applied by itself: the user confirms every row.
//
// Tax notes are general rules (the accountant confirms): PPh 21 for pay to individuals, PPh 26 20%
// for payments abroad (or a treaty rate with a DGT form), PPh 4(2) 10% for rent of land/buildings.

// Upper case, letters and digits only, a space where letters meet digits ("INDONE07721538064").
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
const COMPANY = /\b(PT|CV|TBK|UD|PERSERO|KOPERASI|YAYASAN|LTD|LLC|INC|CORP|PTE)\b/
const STOP = new Set(['PT', 'CV', 'TBK', 'BANK', 'THE', 'KE', 'DARI', 'DR', 'KBB', 'TRF', 'TRANSFER', 'NEW', 'PEB', 'BIFAST', 'BI', 'FAST', 'CR', 'DB'])

/** Words of a company name that identify it ("HELM CARE INDONESIA" → HELM, CARE, INDONESIA). */
const nameWords = (s) => norm(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w))

/** Does the row text name this company? All of its words (prefixes allowed: banks cut names). */
export function mentions(text, companyName) {
  const words = nameWords(companyName)
  if (words.length < 2) return false
  const tokens = norm(text).split(' ')
  // Words in order and next to each other, as the bank prints the name. A bank cuts names to
  // ~18 characters ("HELM CARE INDONE"), so a token that starts a name word counts.
  for (let i = 0; i < tokens.length; i++) {
    let k = 0
    while (k < words.length && i + k < tokens.length && (tokens[i + k] === words[k] || (tokens[i + k].length >= 4 && words[k].startsWith(tokens[i + k])))) k++
    if (k >= Math.min(words.length, 3) || (k === words.length)) return true
    if (k >= 2 && i + k === tokens.length) return true   // the name was cut at the end of the line
  }
  return false
}

/** The other party as printed: "KE 008 NAME KBB", "DR 013 NAME", "TRF KE NAME 123…", "PB DARI NAME". */
export function counterpartyOf(description) {
  const d = norm(description)
  const pats = [
    /\b(?:KE|DR) \d{3} (.+?)(?: KBB\b|$)/,
    /\bPB (?:DARI|KE) (.+?)(?: PERMATA\b| NEW\b| \d{6,}|$)/,
    /\bTRF (?:BIFAST )?KE ([A-Z][A-Z ]+?)(?: \d|$)/,
    /\bE BANKING (?:DB|CR) [\dA-Z ]*? \d+ \d+ (.+)$/,
  ]
  for (const re of pats) {
    const m = re.exec(d)
    if (m && m[1]) {
      const v = m[1].replace(/\b(KBB|NEW|PEB|BANK [A-Z ]+)\b.*$/, '').replace(/^(\d+ )+/, '').trim()
      if (v.length >= 3) return v.slice(0, 60)
    }
  }
  return null
}

const FEE = /\b(BIAYA|ADM|ADMIN|FEE|CHARGE|PROVISI|MATERAI|BEA)\b/
const INTEREST = /\b(BUNGA|INTEREST|JASA GIRO)\b/
const GATEWAY = /\b(PERMATA GATEWAY|MIDTRANS|XENDIT|DOKU|IPAYMU|DUITKU|HITPAY|NICEPAY|FLIP)\b/
const FOREIGN = /\b(USD|SGD|EUR|AUD|GBP|SWIFT|TELEX|OCBC SG|TT OUT|REMITTANCE|VALAS)\b/
const RENT = /\b(RENT|SEWA|LEASE|CIRCLE ?K|CIRCLEKA)\b/
const TAX = /\b(DJP|PAJAK|MPN|PPH|PPN|BILLING PAJAK)\b/

/**
 * @param row  { description, amount, direction, currency? }
 * @param ctx  { company: this company's name, otherCompanies: [names], walletCurrency }
 * @returns { kind, counterparty, category: suggested default category name | null, ask: bool, tax: null | 'pph21'|'pph26'|'pph42'|'final_interest' }
 */
export function insightOf(row, ctx = {}) {
  const d = norm(row.description)
  const dir = row.direction
  const cp = counterpartyOf(row.description)
  const res = (kind, extra = {}) => ({ kind, counterparty: cp, category: null, ask: false, tax: null, ...extra })
  if (FEE.test(d) && Number(row.amount) <= 1000000 && dir === 'out') return res('bank_fee', { category: 'Bank fee and admin' })
  if (INTEREST.test(d)) return res('interest', { category: dir === 'in' ? 'Other income' : 'Bank fee and admin', tax: dir === 'in' ? 'final_interest' : null })
  if (TAX.test(d) && dir === 'out') return res('tax_payment', { category: 'Taxes (PPh, PPN)' })
  if (ctx.company && mentions(row.description, ctx.company)) return res('own_transfer', { category: dir === 'in' ? 'Transfer between own accounts — in' : 'Transfer between own accounts — out' })
  const other = (ctx.otherCompanies || []).find((n) => mentions(row.description, n))
  if (other) return res('intercompany', { other, category: dir === 'in' ? 'Intercompany — in' : 'Intercompany — out', ask: true })
  if (GATEWAY.test(d) && dir === 'in') return res('gateway', { category: 'Payment gateway settlement' })
  if (FOREIGN.test(d) && dir === 'out') return res('foreign', { tax: 'pph26', ask: true })
  if (RENT.test(d) && dir === 'out') return res('rent', { category: 'Rent', tax: 'pph42' })
  const person = cp && !COMPANY.test(` ${cp} `)
  // The owner is a person too, but money to or from the owner is not pay: loan, reimbursement or dividends.
  if (person && (ctx.ownerNames || []).some((n) => nameWords(n).length >= 2 && mentions(cp, n))) {
    return res('owner', { category: dir === 'in' ? 'Owner funding (loan)' : 'Owner withdrawal / dividends', ask: true })
  }
  if (person && dir === 'in') return res('from_person', { category: 'Owner funding (loan)', ask: true })
  if (person && dir === 'out') return res('to_person', { tax: 'pph21', ask: true })
  return res('other')
}

/** Group a statement's rows for the review header: counts by kind. */
export function insightSummary(rows, ctx) {
  const out = {}
  for (const r of rows) { const k = insightOf(r, ctx).kind; out[k] = (out[k] || 0) + 1 }
  return out
}
