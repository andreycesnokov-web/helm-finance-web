'use strict';
// The cash-flow categories a new company starts with. Before this, POST /api/businesses created a
// company with NO categories (the only templates were Russian, vending-specific and global), so
// statement rows and manual entries had nothing to be filed under. English names (data, not UI
// copy); ordinary company categories — the owner can rename or archive any of them.
//
// Technical rows (own-account transfers, intercompany) keep money moved between the company's
// own accounts — or between its companies — out of revenue and expenses. The names are chosen so
// lib/financialInsights classifies them (transfer / financing / tax / capex / revenue keywords):
// tests/defaultCategories.test.js checks each class.

const DEFAULT_BUSINESS_CATEGORIES = Object.freeze([
  ['Sales revenue', 'inflow', 'operating'],
  ['Service revenue', 'inflow', 'operating'],
  ['Payment gateway settlement', 'inflow', 'operating'],
  ['Supplier refunds', 'inflow', 'operating'],
  ['Other income', 'inflow', 'operating'],
  ['Owner funding (loan)', 'inflow', 'financing'],
  ['Capital contribution', 'inflow', 'financing'],
  ['Loan proceeds', 'inflow', 'financing'],
  ['Transfer between own accounts — in', 'inflow', 'technical'],
  ['Intercompany — in', 'inflow', 'technical'],
  ['Supplier invoices', 'outflow', 'operating'],
  ['Rent', 'outflow', 'operating'],
  ['Salary and wages', 'outflow', 'operating'],
  ['Payroll tax (PPh 21) and BPJS', 'outflow', 'operating'],
  ['Taxes (PPh, PPN)', 'outflow', 'operating'],
  ['Utilities', 'outflow', 'operating'],
  ['Internet and telecom', 'outflow', 'operating'],
  ['Marketing and advertising', 'outflow', 'operating'],
  ['Office expenses', 'outflow', 'operating'],
  ['Professional services', 'outflow', 'operating'],
  ['Software and subscriptions', 'outflow', 'operating'],
  ['Transport and logistics', 'outflow', 'operating'],
  ['Bank fee and admin', 'outflow', 'operating'],
  ['Payment gateway fees', 'outflow', 'operating'],
  ['Customer refunds', 'outflow', 'operating'],
  ['Other expenses', 'outflow', 'operating'],
  ['Equipment and fixed assets', 'outflow', 'investing'],
  ['Loan repayments', 'outflow', 'financing'],
  ['Owner withdrawal / dividends', 'outflow', 'financing'],
  ['Transfer between own accounts — out', 'outflow', 'technical'],
  ['Intercompany — out', 'outflow', 'technical'],
]);

/** Rows to insert for a company that already has `existingNames` (idempotent by name). */
function defaultCategoryRows({ businessId, userId, existingNames = [] }) {
  const have = new Set(existingNames.map((n) => String(n).trim().toLowerCase()));
  return DEFAULT_BUSINESS_CATEGORIES
    .map(([name, group_type, activity_type], i) => ({ name, group_type, activity_type, sort_order: i }))
    .filter((r) => !have.has(r.name.toLowerCase()))
    .map((r) => ({ ...r, business_id: businessId, user_id: userId, is_system: false, is_active: true, source: 'default' }));
}

/** Seed the defaults into a company. Never throws: a company without them still works. */
async function seedBusinessCategories(supabase, businessId, userId) {
  try {
    const { data: existing } = await supabase.from('cashflow_categories').select('name').eq('business_id', businessId);
    const rows = defaultCategoryRows({ businessId, userId, existingNames: (existing || []).map((r) => r.name) });
    if (!rows.length) return { inserted: 0 };
    const { error } = await supabase.from('cashflow_categories').insert(rows);
    if (error) { console.error(`[categories] default seed failed for ${businessId}: ${error.message}`); return { inserted: 0, error: error.message }; }
    return { inserted: rows.length };
  } catch (e) {
    console.error(`[categories] default seed failed for ${businessId}: ${e.message}`);
    return { inserted: 0, error: e.message };
  }
}

module.exports = { DEFAULT_BUSINESS_CATEGORIES, defaultCategoryRows, seedBusinessCategories };
