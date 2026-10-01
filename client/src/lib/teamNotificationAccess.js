// Company-admin notification access — the decisions behind the Team "Notification access" dialog,
// kept out of the component so they can be tested by the repo's node --test runner (the client has
// no component test framework).
//
// The server is the authority: GET /api/team/notification-grants returns each member's role,
// whether they are grantable, and their current grants. This module only shapes that for display —
// it never decides eligibility itself, so it cannot drift from server/lib/notificationPolicy.js.

// Human labels for the six grantable categories, in a stable display order.
export const CATEGORY_LABELS = {
  company_financial:    'Company financial',
  tax_compliance:       'Tax & compliance',
  payables_receivables: 'Payables & receivables',
  documents_review:     'Documents to review',
  team_approvals:       'Team approvals',
  ai_cfo_summary:       'AI CFO summary',
}

/** Order categories for display: whatever the server sent, but in the stable label order above. */
export function orderCategories(categories) {
  const known = Object.keys(CATEGORY_LABELS)
  const set = new Set(categories || [])
  return known.filter((c) => set.has(c))
}

/**
 * One-line access summary for a member row.
 *
 * The owner always receives company alerts (read-only). A grantable member shows a count. Anyone
 * else is explicitly ineligible — the copy says why rather than leaving a blank the owner has to
 * interpret.
 */
export function accessSummary(member) {
  if (!member) return ''
  if (member.is_owner) return 'Owner · receives all company alerts'
  if (!member.grantable) return 'Not eligible for company alerts'
  const on = Object.values(member.granted || {}).filter((v) => v === true).length
  if (on === 0) return 'No company alerts'
  return `${on} categor${on === 1 ? 'y' : 'ies'} granted`
}

/**
 * Why a member cannot be granted anything, for the dialog. Null when they CAN (grantable), or when
 * they are the owner (whose access is shown, not explained).
 */
export function ineligibleReason(member) {
  if (!member || member.is_owner || member.grantable) return null
  return 'Only a CEO or CFO can be granted company notifications. Change this member’s role to grant access.'
}

/**
 * The minimal diff to PUT: only categories whose value changed from the loaded state. Sending the
 * whole map would work, but a diff keeps the audit trail honest — one row per real change, not one
 * per toggle rendered.
 */
export function grantsDiff(original, edited) {
  const out = {}
  for (const [category, value] of Object.entries(edited || {})) {
    if ((original || {})[category] !== value) out[category] = value
  }
  return out
}

/** Is there anything to save? Drives the Save button's enabled state. */
export function hasChanges(original, edited) {
  return Object.keys(grantsDiff(original, edited)).length > 0
}
