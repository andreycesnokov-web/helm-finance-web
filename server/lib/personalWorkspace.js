// Personal Account v1 — workspace resolver, provisioning, category seed, and the
// strict-isolation query helpers. Pure: every function takes the supabase client, so
// it is unit-testable over PGlite without booting Express.
//
// HARD ISOLATION CONTRACT (mirrors the business resolver, inverted):
//   • A "personal workspace" is a businesses row with type='personal', owned by the
//     caller. There is at most ONE per user (DB partial unique index, migration 044).
//   • Personal finance rows (wallets / transactions / cashflow_categories) are scoped
//     by business_id = personal_workspace_id AND scope='personal'. NEVER by bare
//     user_id (that would pull legacy business_id IS NULL rows into the personal view).
//   • Personal routes reject a type='business' id; business routes already reject
//     type='personal'. The two never mix.
//   • Provisioning is the ONLY allowed auto-create, and ONLY as type='personal'.

// Default personal categories (seeded server-side, idempotent). Business-related ones
// are stored PERSONALLY in v1 (activity_type='financing'); the actual personal→business
// bridge arrives later with 038/039 — not here.
const PERSONAL_CATEGORIES = {
  income: ['Salary', 'Freelance', 'Dividends', 'Business owner draw', 'Refund', 'Gift', 'Other income'],
  expense: ['Groceries', 'Restaurants & cafes', 'Transport', 'Fuel', 'Taxi', 'Rent', 'Utilities', 'Health',
    'Family', 'Education', 'Travel', 'Subscriptions', 'Shopping', 'Entertainment', 'Taxes', 'Bank fees', 'Other expense'],
  business_related: ['Paid for business', 'Reimbursable expense', 'Owner loan to business', 'Owner equity contribution'],
};

const WALLET_TYPES = ['cash', 'bank', 'card', 'ewallet', 'wise_paypal', 'other'];
const TX_KINDS = ['income', 'expense', 'transfer'];

function httpErr(message, status) { const e = new Error(message); e.status = status; return e; }

// The caller's single owned personal workspace, or null. Active membership + owner.
async function findPersonalWorkspace(supabase, userId) {
  const { data } = await supabase.from('business_members')
    .select('role, status, business_id, businesses(*)')
    .eq('user_id', userId).eq('status', 'active');
  const m = (data || []).find(x => x.businesses && x.businesses.type === 'personal' && x.businesses.owner_user_id === userId);
  return m ? m.businesses : null;
}

// Idempotent category seed: only inserts names not already present for this workspace.
async function seedPersonalCategories(supabase, businessId, userId) {
  const { data: existing } = await supabase.from('cashflow_categories').select('name').eq('business_id', businessId);
  const have = new Set((existing || []).map(r => r.name));
  const rows = []; let sort = 0;
  const add = (name, group_type, activity_type) => { if (!have.has(name)) rows.push({ business_id: businessId, user_id: userId, name, group_type, activity_type, sort_order: sort, is_system: true }); sort += 1; };
  PERSONAL_CATEGORIES.income.forEach(n => add(n, 'inflow', 'operating'));
  PERSONAL_CATEGORIES.expense.forEach(n => add(n, 'outflow', 'operating'));
  PERSONAL_CATEGORIES.business_related.forEach(n => add(n, 'outflow', 'financing'));
  if (rows.length) await supabase.from('cashflow_categories').insert(rows);
}

// Auto-provision: reuse if present (idempotent). Creates ONLY a type='personal'
// workspace + owner membership + seeded categories. Race-safe against the DB unique
// index (re-fetch on insert failure).
async function provisionPersonalWorkspace(supabase, userId) {
  const existing = await findPersonalWorkspace(supabase, userId);
  if (existing) { await seedPersonalCategories(supabase, existing.id, userId); return existing; }

  const { data: biz, error } = await supabase.from('businesses')
    .insert({ owner_user_id: userId, name: 'Personal', type: 'personal', base_currency: 'IDR', plan: 'free' })
    .select().single();
  if (error || !biz) {
    // Likely the partial unique index (concurrent provision) — re-fetch and reuse.
    const again = await findPersonalWorkspace(supabase, userId);
    if (again) return again;
    throw error || httpErr('personal_provision_failed', 500);
  }
  await supabase.from('business_members').insert({ business_id: biz.id, user_id: userId, role: 'owner', status: 'active' });
  await seedPersonalCategories(supabase, biz.id, userId);
  return biz;
}

// Resolve the caller's personal workspace. createIfMissing=true ONLY for the two
// designated first-action endpoints (summary, wallet create).
async function resolvePersonalWorkspace(supabase, userId, { createIfMissing = false } = {}) {
  const ws = await findPersonalWorkspace(supabase, userId);
  if (ws) return ws;
  if (createIfMissing) return provisionPersonalWorkspace(supabase, userId);
  throw httpErr('no_personal_workspace', 409);
}

// Guard: a personal route must reject an explicit business workspace id.
async function rejectBusinessWorkspaceId(supabase, workspaceId) {
  if (!workspaceId) return;
  const { data } = await supabase.from('businesses').select('id, type').eq('id', workspaceId).limit(1);
  const b = data?.[0];
  if (b && b.type === 'business') throw httpErr('personal_workspace_required', 409);
}

// Reduce raw personal transactions → per-wallet native balances. Transfer legs are
// ordinary income/expense legs (source prefixed 'xfer:'), so balance math needs no
// special-casing. Returns Map(wallet_id → balance).
function walletBalances(transactions) {
  const bal = new Map();
  for (const t of transactions || []) {
    if (!t.wallet_id) continue;
    const amt = Number(t.amount_original || 0);
    const cur = bal.get(t.wallet_id) || 0;
    bal.set(t.wallet_id, cur + (t.type === 'income' ? amt : -amt));
  }
  return bal;
}

const isTransferLeg = (t) => typeof t.source === 'string' && t.source.startsWith('xfer:');

module.exports = {
  PERSONAL_CATEGORIES, WALLET_TYPES, TX_KINDS,
  findPersonalWorkspace, seedPersonalCategories, provisionPersonalWorkspace,
  resolvePersonalWorkspace, rejectBusinessWorkspaceId, walletBalances, isTransferLeg,
};
