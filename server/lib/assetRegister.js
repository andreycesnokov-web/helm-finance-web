// Asset register (Design v2 P-11; migration 063). Pure; tested in tests/assetRegister.test.js.
//
// Group and useful life come ONLY from the verified tax rule engine: an ACTIVE, VERIFIED
// tax_rules row with obligation_type = 'depreciation' whose parameters list the groups:
//   { method: 'straight_line', groups: [{ code, label, useful_life_months | useful_life_years,
//     asset_types: ['machines', …] }] }
// No such rule → no life, no depreciation (never a guessed life). Nothing here holds a rate.
//
// Straight line: cost ÷ useful_life_months each month, starting in the month of acquisition
// (the month the expenditure is made), until fully written off or the month of disposal.
'use strict';

const ASSET_TYPES = ['machines', 'vehicles', 'computers', 'furniture', 'buildings', 'other'];
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo', 'accountant'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const canEditAssets = (role) => EDIT_ROLES.includes(role);
const round2 = (n) => Math.round(n * 100) / 100;

/** Groups from verified depreciation rules. `isEffective(rule)` is the engine's own check. */
function depreciationGroups(rules = [], isEffective = () => false) {
  const out = [];
  for (const r of rules || []) {
    if (!r || r.obligation_type !== 'depreciation' || !isEffective(r)) continue;
    const p = r.parameters || {};
    if (p.method && p.method !== 'straight_line') continue;
    for (const g of Array.isArray(p.groups) ? p.groups : []) {
      const months = Number.isInteger(g?.useful_life_months) ? g.useful_life_months
        : Number.isFinite(Number(g?.useful_life_years)) && Number(g.useful_life_years) > 0 ? Math.round(Number(g.useful_life_years) * 12) : null;
      if (!g || !g.code || !(months >= 1 && months <= 600)) continue;
      out.push({ rule_id: r.id, rule_code: r.rule_code || null, code: String(g.code), label: g.label || String(g.code),
        useful_life_months: months, asset_types: (Array.isArray(g.asset_types) ? g.asset_types : []).filter((x) => ASSET_TYPES.includes(x)) });
    }
  }
  return out;
}

/** The group for an asset type: the requested one when it fits, the only candidate, or null. */
function groupFor(assetType, groups = [], requested = null) {
  const fits = (groups || []).filter((g) => g.asset_types.includes(assetType));
  if (requested) return fits.find((g) => g.code === requested) || (groups || []).find((g) => g.code === requested) || null;
  return fits.length === 1 ? fits[0] : null;
}

const monthKey = (d) => String(d).slice(0, 7);
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

/** Depreciation of one asset in one month (YYYY-MM). 0 outside its life or without a life. */
function depreciationIn(asset, month) {
  const life = Number(asset?.useful_life_months);
  if (!(life >= 1) || !asset.acquired_on) return 0;
  const idx = monthsBetween(monthKey(asset.acquired_on), month);
  if (idx < 0 || idx >= life) return 0;
  if (asset.disposed_on && month > monthKey(asset.disposed_on)) return 0;
  const cost = Number(asset.cost) || 0;
  const per = round2(cost / life);
  // The last month takes the rounding remainder so the total is exactly the cost.
  return idx === life - 1 ? round2(cost - per * (life - 1)) : per;
}

/** Accumulated depreciation up to and including `month`, and the book value. */
function bookValue(asset, month) {
  let acc = 0;
  const life = Number(asset?.useful_life_months);
  if (life >= 1 && asset.acquired_on) {
    const start = monthKey(asset.acquired_on);
    const n = Math.min(life, monthsBetween(start, month) + 1);
    for (let i = 0; i < n; i++) {
      const [y, m] = start.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      acc += depreciationIn(asset, `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  }
  acc = round2(acc);
  return { accumulated: acc, book_value: round2((Number(asset.cost) || 0) - acc) };
}

/** Validate POST /api/assets. Group/life are resolved from the verified rules, never the body. */
function assetFromBody(b = {}, groups = []) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { error: 'name_required' };
  if (!ASSET_TYPES.includes(b.asset_type)) return { error: 'invalid_asset_type', allowed: ASSET_TYPES };
  const cost = typeof b.cost === 'number' || (typeof b.cost === 'string' && /^\s*\d+(\.\d{1,2})?\s*$/.test(b.cost)) ? Number(b.cost) : NaN;
  if (!(cost > 0) || !Number.isFinite(cost) || cost > 1e15) return { error: 'invalid_cost' };
  const qty = b.quantity == null || b.quantity === '' ? 1 : Number(b.quantity);
  if (!Number.isInteger(qty) || qty < 1) return { error: 'invalid_quantity' };
  if (typeof b.acquired_on !== 'string' || !DATE_RE.test(b.acquired_on) || Number.isNaN(new Date(b.acquired_on).getTime())) return { error: 'invalid_acquired_on' };
  const ids = {};
  for (const [k, kind] of [['supplier_counterparty_id', 'uuid'], ['purchase_document_id', 'uuid'], ['purchase_debt_id', 'int'], ['purchase_transaction_id', 'int']]) {
    const v = b[k];
    if (v == null || v === '') continue;
    if (kind === 'uuid' ? !(typeof v === 'string' && UUID_RE.test(v)) : !/^\d+$/.test(String(v))) return { error: `invalid_${k}` };
    ids[k] = kind === 'int' ? Number(v) : v;
  }
  const g = groupFor(b.asset_type, groups, b.asset_group || null);
  if (b.asset_group && !g) return { error: 'unknown_asset_group' };
  const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  return { row: {
    name: name.slice(0, 200), asset_type: b.asset_type, quantity: qty, cost: round2(cost), currency: 'IDR', acquired_on: b.acquired_on,
    ...ids, location: text(b.location, 200), custodian: text(b.custodian, 200), notes: text(b.notes, 1000),
    asset_group: g ? g.code : null, useful_life_months: g ? g.useful_life_months : null, depreciation_rule_id: g ? g.rule_id : null,
  } };
}

/** Public shape with computed figures for `asOf` (YYYY-MM) and per-month depreciation. */
function publicAsset(a, asOf, months = []) {
  return { ...a, ...bookValue(a, asOf), monthly_depreciation: a.useful_life_months ? round2(Number(a.cost) / a.useful_life_months) : null,
    depreciation_by_month: Object.fromEntries(months.map((m) => [m, depreciationIn(a, m)])) };
}

module.exports = { ASSET_TYPES, EDIT_ROLES, canEditAssets, depreciationGroups, groupFor, depreciationIn, bookValue, assetFromBody, publicAsset };
