// Who may decide an item waiting for approval — mirrors the server so the screen never
// offers a button that answers 403 (review 8.2, SHOULD FIX). Server rules (server/index.js):
//   approve / reject / request-info   owner, ceo, admin, cfo   (canApproveFinancialRecord)
//   approve your own submission       owner and ceo only        (self-approval guard)
// The server still checks; this only hides what it would refuse. Pure; tested in
// tests/design/v2Decisions.test.mjs.
export const DECIDE_ROLES = ['owner', 'ceo', 'admin', 'cfo']
const SELF_APPROVE_ROLES = ['owner', 'ceo']

/** @returns {{ known: boolean, canDecide: boolean, canApprove: boolean, why: null|'role'|'own' }} */
export function decisionRights({ role, userId, debt }) {
  if (!role) return { known: false, canDecide: false, canApprove: false, why: null }
  if (!DECIDE_ROLES.includes(role)) return { known: true, canDecide: false, canApprove: false, why: 'role' }
  const own = userId != null && debt?.created_by_user_id != null && String(debt.created_by_user_id) === String(userId)
  if (own && !SELF_APPROVE_ROLES.includes(role)) return { known: true, canDecide: true, canApprove: false, why: 'own' }
  return { known: true, canDecide: true, canApprove: true, why: null }
}
