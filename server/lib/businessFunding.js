// Business funding register (Design v2 P-03; migration 064). Pure; tested in
// tests/businessFunding.test.js.
//
// Equity and loans a business raised. Never revenue. Repayment principal is not a cost;
// loan interest is the only part that reaches profit (the 'interest' group, below EBITDA),
// counted in the month its repayment falls due. A founder loan is business-side only:
// nothing here knows about Personal or the bridge.
'use strict';

const SOURCES = ['founder', 'investor', 'bank', 'other_lender'];
const INSTRUMENTS = ['equity', 'loan'];
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCHEDULE = 360;

const canEditFunding = (role) => EDIT_ROLES.includes(role);
const round2 = (n) => Math.round(n * 100) / 100;
const money = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\s*\d+(\.\d{1,2})?\s*$/.test(v)) ? Number(v) : NaN);
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(new Date(v).getTime());
const txId = (v) => (v == null || v === '' ? null : /^\d+$/.test(String(v)) ? Number(v) : NaN);

function repaymentFromBody(b = {}) {
  if (!isDate(b.due_on)) return { error: 'invalid_due_on' };
  const principal = b.principal == null || b.principal === '' ? 0 : money(b.principal);
  const interest = b.interest == null || b.interest === '' ? 0 : money(b.interest);
  if (!(principal >= 0) || !(interest >= 0) || !(principal + interest > 0)) return { error: 'invalid_repayment_amounts' };
  return { row: { due_on: b.due_on, principal: round2(principal), interest: round2(interest) } };
}

/** Validate POST /api/business-funding (a record and, for a loan, an optional schedule). */
function recordFromBody(b = {}) {
  if (!SOURCES.includes(b.source_kind)) return { error: 'invalid_source_kind', allowed: SOURCES };
  if (!INSTRUMENTS.includes(b.instrument)) return { error: 'invalid_instrument', allowed: INSTRUMENTS };
  const amount = money(b.amount);
  if (!(amount > 0)) return { error: 'invalid_amount' };
  if (!isDate(b.received_on)) return { error: 'invalid_received_on' };
  const cp = b.counterparty_id == null || b.counterparty_id === '' ? null : b.counterparty_id;
  if (cp !== null && !(typeof cp === 'string' && UUID_RE.test(cp))) return { error: 'invalid_counterparty_id' };
  const lender = typeof b.lender_name === 'string' && b.lender_name.trim() ? b.lender_name.trim().slice(0, 200) : null;
  if (!cp && !lender) return { error: 'lender_required' };
  const rx = txId(b.received_transaction_id);
  if (Number.isNaN(rx)) return { error: 'invalid_received_transaction_id' };
  const loan = b.instrument === 'loan';
  let rate = null, due = null;
  if (b.interest_rate_annual != null && b.interest_rate_annual !== '') {
    if (!loan) return { error: 'equity_has_no_interest' };
    const r = Number(b.interest_rate_annual);
    if (!(typeof b.interest_rate_annual !== 'boolean' && Number.isFinite(r) && r >= 0 && r <= 100)) return { error: 'invalid_interest_rate_annual' };
    rate = r;
  }
  if (b.due_on != null && b.due_on !== '') {
    if (!loan) return { error: 'equity_has_no_due_date' };
    if (!isDate(b.due_on) || b.due_on < b.received_on) return { error: 'invalid_due_on' };
    due = b.due_on;
  }
  const schedule = [];
  if (b.schedule != null) {
    if (!loan) return { error: 'equity_has_no_repayments' };
    if (!Array.isArray(b.schedule) || b.schedule.length > MAX_SCHEDULE) return { error: 'invalid_schedule' };
    for (const s of b.schedule) { const v = repaymentFromBody(s); if (v.error) return { error: `schedule_${v.error}` }; schedule.push(v.row); }
  }
  return { row: { source_kind: b.source_kind, instrument: b.instrument, counterparty_id: cp, lender_name: lender, amount: round2(amount), currency: 'IDR',
    received_on: b.received_on, received_transaction_id: rx, interest_rate_annual: rate,
    terms_text: typeof b.terms_text === 'string' && b.terms_text.trim() ? b.terms_text.trim().slice(0, 2000) : null, due_on: due }, schedule };
}

function paidFromBody(b = {}) {
  if (!isDate(b.paid_on)) return { error: 'invalid_paid_on' };
  const tx = txId(b.paid_transaction_id);
  if (Number.isNaN(tx)) return { error: 'invalid_paid_transaction_id' };
  return { paid_on: b.paid_on, paid_transaction_id: tx };
}

/**
 * Register summary. `today` YYYY-MM-DD, `months` YYYY-MM keys for interest by month.
 * Outstanding = loan amount − principal of PAID repayments.
 */
function summarize(records = [], repayments = [], { today, months = [] } = {}) {
  const byRec = {};
  for (const r of repayments || []) (byRec[r.funding_record_id] ||= []).push(r);
  const recs = (records || []).map((rec) => {
    const reps = (byRec[rec.id] || []).slice().sort((a, b) => (a.due_on < b.due_on ? -1 : 1));
    const paidPrincipal = reps.filter((r) => r.paid_on).reduce((s, r) => s + Number(r.principal || 0), 0);
    const outstanding = rec.instrument === 'loan' && rec.status === 'active' ? round2(Math.max(0, Number(rec.amount) - paidPrincipal)) : 0;
    const next = reps.find((r) => !r.paid_on) || null;
    return { ...rec, repayments: reps, outstanding, next_repayment: next };
  });
  const upcoming = recs.flatMap((rec) => rec.repayments.filter((r) => !r.paid_on).map((r) => ({
    id: r.id, funding_record_id: rec.id, due_on: r.due_on, principal: Number(r.principal), interest: Number(r.interest),
    amount: round2(Number(r.principal) + Number(r.interest)), lender: rec.lender_name || null, counterparty_id: rec.counterparty_id || null,
    overdue: !!today && r.due_on < today,
  }))).sort((a, b) => (a.due_on < b.due_on ? -1 : 1));
  const interestByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  for (const r of repayments || []) { const k = String(r.due_on).slice(0, 7); if (k in interestByMonth) interestByMonth[k] = round2(interestByMonth[k] + Number(r.interest || 0)); }
  const sum = (xs, f) => round2(xs.reduce((s, x) => s + f(x), 0));
  return {
    records: recs, upcoming,
    totals: {
      raised_equity: sum(recs.filter((r) => r.instrument === 'equity'), (r) => Number(r.amount)),
      raised_loans: sum(recs.filter((r) => r.instrument === 'loan'), (r) => Number(r.amount)),
      loans_outstanding: sum(recs, (r) => r.outstanding),
      next_repayment: upcoming[0] || null,
    },
    interest_by_month: interestByMonth,
    // Payments that settle a repayment: Performance splits them into principal (funding,
    // never profit) and interest (the 'interest' group) instead of their category.
    repayment_transactions: (repayments || []).filter((r) => r.paid_transaction_id != null).map((r) => String(r.paid_transaction_id)),
  };
}

module.exports = { SOURCES, INSTRUMENTS, EDIT_ROLES, canEditFunding, recordFromBody, repaymentFromBody, paidFromBody, summarize };
