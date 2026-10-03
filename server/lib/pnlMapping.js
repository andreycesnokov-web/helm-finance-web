// Category → profit group mapping (Design v2 P-10; migration 062).
//
// A business's cashflow_categories rows get a pnl_group only when a person confirms it
// (PATCH /api/pnl-mapping, owner/ceo/admin/cfo, audited). industry_templates hold
// SUGGESTIONS per KBLI prefix; nothing here writes a suggestion into a mapping.
//
// Pure — validation and matching only. Tested in tests/pnlMapping.test.js.
'use strict';

// The 9 groups (DECISIONS.md "P-10 decisions"). Mirrors the CHECK in migration 062.
const GROUPS = ['revenue', 'direct_cost', 'operating_cost', 'interest', 'other_income', 'tax', 'asset_purchase', 'funding', 'transfer'];
// Same people who restructure categories (canManageCategories in server/index.js).
const EDIT_ROLES = ['owner', 'ceo', 'admin', 'cfo'];
const MAX_ITEMS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const canEditMapping = (role) => EDIT_ROLES.includes(role);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** KBLI codes of a business from its tax profile (primary + additional), digits only. */
function kbliCodes(profile) {
  const raw = [profile?.primary_kbli, ...(Array.isArray(profile?.additional_kbli) ? profile.additional_kbli : [])]
  return [...new Set(raw.map((k) => String(k || '').replace(/\D/g, '')).filter(Boolean))]
}

/**
 * Suggestion for one category name: the most specific matching template wins
 * (a KBLI prefix the business has, longest first), then the generic '*' row.
 * @returns {{ pnl_group, note, source } | null}
 */
function suggestFor(name, templates = [], codes = []) {
  const n = norm(name)
  if (!n) return null
  const hits = (templates || []).filter((t) => norm(t.category_name) === n
    && (t.kbli_prefix === '*' || codes.some((c) => c.startsWith(String(t.kbli_prefix)))))
  if (!hits.length) return null
  hits.sort((a, b) => (b.kbli_prefix === '*' ? 0 : b.kbli_prefix.length) - (a.kbli_prefix === '*' ? 0 : a.kbli_prefix.length))
  const h = hits[0]
  return { pnl_group: h.pnl_group, note: h.note || null, source: h.kbli_prefix === '*' ? 'generic' : `kbli_${h.kbli_prefix}` }
}

/** Template rows that apply to this business but have no category of that name yet. */
function missingTemplateCategories(categories = [], templates = [], codes = []) {
  const have = new Set((categories || []).map((c) => norm(c.name)))
  const out = new Map()
  for (const t of templates || []) {
    if (t.kbli_prefix === '*' || !codes.some((c) => c.startsWith(String(t.kbli_prefix))) || have.has(norm(t.category_name))) continue
    const k = norm(t.category_name)
    const prev = out.get(k)
    // One row per name; the most specific KBLI prefix wins.
    if (!prev || String(t.kbli_prefix).length > String(prev.kbli_prefix).length)
      out.set(k, { name: t.category_name, pnl_group: t.pnl_group, note: t.note || null, kbli_prefix: t.kbli_prefix })
  }
  return [...out.values()]
}

/**
 * Validate PATCH body { mappings: [{ category_id, pnl_group | null }] }.
 * @returns {{ items: Array, error?: string }}
 */
function mappingsFromBody(b = {}) {
  const list = b && b.mappings
  if (!Array.isArray(list) || list.length === 0) return { items: [], error: 'mappings_required' }
  if (list.length > MAX_ITEMS) return { items: [], error: 'too_many_mappings' }
  const seen = new Set()
  const items = []
  for (const m of list) {
    if (!m || typeof m.category_id !== 'string' || !UUID_RE.test(m.category_id)) return { items: [], error: 'invalid_category_id' }
    if (seen.has(m.category_id)) return { items: [], error: 'duplicate_category_id' }
    seen.add(m.category_id)
    const g = m.pnl_group === '' ? null : m.pnl_group
    if (g !== null && !GROUPS.includes(g)) return { items: [], error: 'invalid_pnl_group' }
    items.push({ category_id: m.category_id, pnl_group: g })
  }
  return { items }
}

module.exports = { GROUPS, EDIT_ROLES, MAX_ITEMS, canEditMapping, kbliCodes, suggestFor, missingTemplateCategories, mappingsFromBody };
