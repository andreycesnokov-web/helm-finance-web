// What the AI Accountant knows about THIS company, and how sure it is.
//
// Every figure here is copied from a read the product already performs. Nothing
// in this file adds, averages, converts, projects or rounds. The scope is the
// whole of the company's bookkeeping — transactions, wallets, receivables,
// payables, payroll, documents, period close and tax — not tax alone.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: absence and zero are different
// answers and must stay different all the way to the model. A company with no
// payroll records has an UNKNOWN payroll position; a company whose payroll
// withholding was computed and came to nothing has a payroll position of zero.
// Collapsing those is how an assistant ends up telling someone they owe nothing.
//
// So every measure is shaped as { value, status } where status is one of:
//   'measured'  a real figure the product computed
//   'zero'      measured, and the measurement is zero
//   'absent'    nothing recorded — NOT zero, and must never be rendered as one
//   'unknown'   the product does not compute this yet
'use strict';

const MEASURED = 'measured';
const ZERO = 'zero';
const ABSENT = 'absent';
const UNKNOWN = 'unknown';

/**
 * Wrap a number with the status that says how much it is worth.
 *
 * @param value   the figure, or null/undefined when nothing was recorded
 * @param present whether the underlying records exist at all. A count of 0
 *                records means ABSENT even if the sum is 0 — that is the whole
 *                distinction.
 */
function measure(value, present) {
  if (!present) return { value: null, status: ABSENT };
  const n = Number(value);
  if (!Number.isFinite(n)) return { value: null, status: ABSENT };
  return { value: n, status: n === 0 ? ZERO : MEASURED };
}

const counted = (n) => ({ value: Number(n) || 0, status: Number(n) > 0 ? MEASURED : ZERO });
const unknown = () => ({ value: null, status: UNKNOWN });

/**
 * Assemble the accounting picture.
 *
 * `cfo` is the object buildAiCfoContext() already returns — the product's
 * existing, tested cash/receivable/payable computation. It is read, never
 * recomputed. `accountant` is buildAccountantData()'s output. `extras` carries
 * the counts that tell absence from zero, which the two builders do not expose.
 */
function buildAccountingContext({ business, cfo = null, accountant = null, extras = {} }) {
  const c = cfo || {};
  const cash = c.cash || {};
  const recv = c.receivables || {};
  const pay = c.payables || {};

  const txCount = Number(extras.transactions_count ?? c.transactions_count ?? 0);
  const walletCount = Number(extras.wallets_count ?? 0);
  // buildAiCfoContext exposes totals and a top-5 list, never a count, so the
  // counts arrive from the caller's own read. A list length would cap at 5 and
  // quietly turn a 40-invoice company into a 5-invoice one.
  const recvCount = Number(extras.receivables_count ?? 0);
  const payCount = Number(extras.payables_count ?? 0);
  const payrollRuns = Number(extras.payroll_runs_count ?? 0);
  const employees = Number(extras.employees_count ?? 0);
  const docCount = Number(extras.documents_count ?? 0);
  const invoiceCount = Number(extras.invoices_count ?? 0);

  const profile = accountant?.profile || null;

  return {
    company: {
      id: business?.id || null,
      name: business?.name || null,
      base_currency: business?.base_currency || 'IDR',
      jurisdiction: accountant?.jurisdiction || profile?.jurisdiction || null,
      legal_entity_type: profile?.legal_entity_type || null,
      tax_regime: profile?.tax_regime || null,
      vat_status: profile?.vat_status || null,
      employee_status: profile?.employee_status || null,
      financial_year: profile?.financial_year_start && profile?.financial_year_end
        ? `${profile.financial_year_start} → ${profile.financial_year_end}` : null,
    },

    // ── the ledger ─────────────────────────────────────────────────────────
    books: {
      transactions_recorded: counted(txCount),
      wallets_active: counted(walletCount),
      // A company with no transactions has no cash POSITION, not a cash
      // position of zero — its books simply do not say.
      total_cash: measure(cash.total_balance, txCount > 0 || walletCount > 0),
      runway_days: c.runway_days === null || c.runway_days === undefined
        ? unknown() : { value: Number(c.runway_days), status: MEASURED },
    },

    receivables: {
      count: counted(recvCount),
      total_outstanding: measure(recv.total_remaining, recvCount > 0),
      overdue_count: counted(extras.receivables_overdue_count ?? 0),
      overdue_total: measure(extras.receivables_overdue_total, Number(extras.receivables_overdue_count ?? 0) > 0),
    },

    payables: {
      count: counted(payCount),
      total_outstanding: measure(pay.total_remaining, payCount > 0),
      overdue_count: counted(extras.payables_overdue_count ?? 0),
      overdue_total: measure(extras.payables_overdue_total, Number(extras.payables_overdue_count ?? 0) > 0),
    },

    payroll: {
      employees: counted(employees),
      runs_recorded: counted(payrollRuns),
      // The figure the PPh 21/26 obligation needs. No runs means the withholding
      // position is ABSENT — the single most consequential absent-vs-zero case
      // on this page, because "zero withholding" reads as "nothing to remit".
      withholding_recorded: measure(extras.payroll_withholding_total, payrollRuns > 0),
    },

    documents: {
      stored: counted(docCount),
      invoices: counted(invoiceCount),
      // The compliance checklist is the product's own source of truth for what
      // is still needed; it is passed through, never re-derived here.
      checklist_available: extras.checklist_available === true,
      missing_required: extras.missing_required_documents ?? null,
      needs_confirmation: extras.documents_needing_confirmation ?? null,
    },

    // ── tax and compliance ─────────────────────────────────────────────────
    tax: {
      profile_fields_missing: accountant?.missing_profile_fields || [],
      profile_completeness_percent: accountant?.completeness?.percent ?? null,
      // Rules that passed the activation gate. Zero of these in production
      // today, which is a fact the assistant has to be able to state.
      activated_rules_count: (accountant?.applicable_rules || []).length,
      active_unverified_rules: accountant?.active_unverified ?? 0,
      obligations: (extras.obligations || []).map((o) => ({
        obligation_type: o.obligation_type,
        title: o.title,
        status: o.status,
        // An obligation the engine could not compute has NO amount. It is not
        // an amount of zero, and the shape must not let it become one.
        amount: o.status === 'calculated'
          ? measure(o.amount, o.amount !== null && o.amount !== undefined)
          : { value: null, status: o.status === 'insufficient_data' ? ABSENT : UNKNOWN },
        period: o.period || null,
        due_date: o.due_date || null,
        source_label: o.source_label || null,
      })),
      upcoming_deadlines: (accountant?.upcoming || []).slice(0, 8).map((e) => ({
        title: e.title, due_date: e.due_date, status: e.status, period: e.period || null,
      })),
      overdue_events: (accountant?.overdue || []).slice(0, 8).map((e) => ({
        title: e.title, due_date: e.due_date, status: e.status,
      })),
    },
  };
}

/**
 * Everything the context says it does not know.
 *
 * The assistant is required to show the user what is missing, and it must come
 * from the data rather than from the model's impression of it. Walking the
 * context for ABSENT and UNKNOWN produces exactly that list.
 */
function gaps(ctx) {
  const out = [];
  const walk = (node, trail) => {
    for (const [k, v] of Object.entries(node || {})) {
      if (v && typeof v === 'object' && 'status' in v && 'value' in v) {
        if (v.status === ABSENT) out.push({ field: [...trail, k].join('.'), kind: 'no_records' });
        else if (v.status === UNKNOWN) out.push({ field: [...trail, k].join('.'), kind: 'not_computed' });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, [...trail, k]);
      }
    }
  };
  walk(ctx.books, ['books']);
  walk(ctx.receivables, ['receivables']);
  walk(ctx.payables, ['payables']);
  walk(ctx.payroll, ['payroll']);
  for (const f of ctx.tax?.profile_fields_missing || []) {
    out.push({ field: `tax.profile.${f}`, kind: 'profile_field_missing' });
  }
  for (const o of ctx.tax?.obligations || []) {
    if (o.amount.status === ABSENT) {
      out.push({ field: `tax.obligations.${o.obligation_type}`, kind: 'insufficient_data', detail: o.source_label });
    }
  }
  if (!ctx.tax?.activated_rules_count) {
    out.push({ field: 'tax.activated_rules', kind: 'no_activated_rules' });
  }
  return out;
}

/**
 * The context as the model sees it.
 *
 * Delivered as JSON with the statuses intact, and preceded by the one paragraph
 * that tells the model what the statuses mean. A model given bare numbers has
 * no way to keep absence out of its arithmetic.
 */
function renderContextForPrompt(ctx) {
  return [
    '<<<COMPANY_RECORDS',
    '# Facts from THIS company\'s own records. Authoritative for what the company',
    '# has recorded. Every measure is { value, status }:',
    '#   measured = a real figure;  zero = measured and it is zero;',
    '#   absent   = NOTHING IS RECORDED. This is not zero. Never report it as a',
    '#              number, never include it in a sum, never conclude from it',
    '#              that there is nothing to pay or nothing to do;',
    '#   unknown  = the product does not compute this yet.',
    '# Do not restate a value whose status is absent or unknown as a figure.',
    JSON.stringify(ctx),
    'COMPANY_RECORDS>>>',
  ].join('\n');
}

module.exports = {
  buildAccountingContext,
  gaps,
  renderContextForPrompt,
  measure,
  STATUS: { MEASURED, ZERO, ABSENT, UNKNOWN },
};
