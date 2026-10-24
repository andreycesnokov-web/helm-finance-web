'use strict';
// A company's confirmed P&L group for every category it can use:
//   * its own categories → cashflow_categories.pnl_group (business_id = the company);
//   * shared system categories → business_category_pnl_groups (migration 20261024120000), keyed by
//     (business_id, category_id), so one company's choice never reclassifies another company.
// Read-only. Every read is scoped to the company or to the shared system rows; nothing here writes.
const MAX_ROWS = 1000;
const OVERLAY = 'business_category_pnl_groups';
// PostgREST / PostgreSQL answers for a table that does not exist yet (migration not applied).
const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));

async function loadSystemMapping(db, businessId, signal) {
  const withSignal = (q) => (signal ? q.abortSignal(signal) : q);
  const { data: system, error: sErr } = await withSignal(db.from('cashflow_categories').select('id,business_id,name,pnl_group,is_system')
    .is('business_id', null).eq('is_system', true).order('id', { ascending: true }).limit(MAX_ROWS));
  if (sErr || !Array.isArray(system)) throw Error('source_read_failed');
  if (system.length >= MAX_ROWS) throw Error('report_row_limit');
  const { data: overlay, error: oErr } = await withSignal(db.from(OVERLAY).select('business_id,category_id,pnl_group')
    .eq('business_id', businessId).order('category_id', { ascending: true }).limit(MAX_ROWS));
  if (oErr && isMissingTable(oErr)) return { systemCategories: system.filter((c) => c.business_id == null && c.is_system), categoryGroups: [], available: false };
  if (oErr || !Array.isArray(overlay)) throw Error('source_read_failed');
  if (overlay.some((r) => r.business_id !== businessId)) throw Error('source_scope_or_pagination_error');
  return { systemCategories: system.filter((c) => c.business_id == null && c.is_system), categoryGroups: overlay, available: true };
}

// Company categories first, then system categories carrying THIS company's overlay group.
// By id always; by name only when the name is unique, and a company name always wins over a system name.
function resolver({ businessId, companyCategories = [], systemCategories = [], categoryGroups = [] }) {
  const own = companyCategories.filter((c) => c.business_id === businessId);
  const overlay = new Map(categoryGroups.filter((g) => g.business_id === businessId).map((g) => [String(g.category_id), g.pnl_group]));
  const system = systemCategories.filter((c) => c.business_id == null).map((c) => ({ ...c, pnl_group: overlay.get(String(c.id)) || null, scope: 'system' }));
  const all = [...own.map((c) => ({ ...c, scope: 'company' })), ...system];
  const byId = new Map(all.map((c) => [String(c.id), c]));
  const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const index = (list) => { const m = new Map(); for (const c of list) { const k = norm(c.name); m.set(k, [...(m.get(k) || []), c]); } return m; };
  const ownByName = index(own), systemByName = index(system);
  const category = (tx) => {
    if (tx.cashflow_category_id != null) return byId.get(String(tx.cashflow_category_id)) || null;
    const k = norm(tx.category);
    const hits = ownByName.get(k) || systemByName.get(k) || [];
    return hits.length === 1 ? (byId.get(String(hits[0].id)) || null) : null;
  };
  return { category, categories: all };
}

// Evidence the cash insights use before keywords: the funding register's links and the confirmed groups.
// A table that does not exist yet (funding 064, the overlay) only means less evidence, never an error.
async function loadInsightEvidence(db, businessId) {
  const read = async (q) => { const { data, error } = await q; if (error && !isMissingTable(error)) throw error; return data || []; };
  const [records, repayments, companyCategories] = await Promise.all([
    read(db.from('business_funding_records').select('business_id,received_transaction_id').eq('business_id', businessId)),
    read(db.from('business_funding_repayments').select('business_id,paid_transaction_id,principal').eq('business_id', businessId)),
    read(db.from('cashflow_categories').select('id,business_id,name,pnl_group').eq('business_id', businessId)),
  ]);
  const { systemCategories, categoryGroups } = await loadSystemMapping(db, businessId);
  const fundingTx = new Map();
  for (const r of records) if (r.business_id === businessId && r.received_transaction_id != null) fundingTx.set(String(r.received_transaction_id), null);
  for (const r of repayments) if (r.business_id === businessId && r.paid_transaction_id != null && !fundingTx.has(String(r.paid_transaction_id)))
    fundingTx.set(String(r.paid_transaction_id), Number(r.principal) || 0);
  return { fundingTx, categoryOf: resolver({ businessId, companyCategories, systemCategories, categoryGroups }).category };
}

module.exports = { loadSystemMapping, loadInsightEvidence, resolver, isMissingTable, OVERLAY };
