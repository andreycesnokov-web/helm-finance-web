// Server-side scope for a reminder row.
//
// WHY THIS EXISTS
// `POST /api/reminders` used to insert `{ ...req.body, user_id }`, so `business_id`
// came from the client and was never verified. Two things were wrong with that:
//
//   1. SECURITY — a caller could name any business_id, including one they are not a
//      member of, and the row was written there.
//   2. CORRECTNESS — the only reader of reminders (GET /api/pulse) filters strictly
//      on `business_id.eq.<active business>`; the legacy "business_id IS NULL" union
//      was removed from bizOrFilter after migration 017 backfilled old rows. The web
//      form (client/src/pages/Add.jsx) sends no business_id at all, so every reminder
//      it created landed with business_id = NULL and was invisible forever.
//
// Both are fixed by the same rule: the scope is decided by the server, from the
// authenticated + membership-verified business, never by the request body.
//
// WHY user_id IS THE ACTOR, NOT bizWriteFields' OWNER
// `PATCH /api/reminders/:id/done` and `/snooze` filter by `user_id = req.user.userId`.
// Stamping the business owner (what bizWriteFields does for financial records) would
// mean a manager could create a reminder and then be unable to complete it. Reminders
// are "who set this", not an owned financial record, so the acting user is correct.
'use strict';

/**
 * Build the row to insert for a new reminder.
 *
 * @param body          req.body as sent by the client (untrusted)
 * @param biz           resolved business from requireBusiness() — membership verified
 * @param actorUserId   req.user.userId — the authenticated caller
 * @returns the insert row, with server-decided scope that the body cannot override
 */
function buildReminderRow(body, biz, actorUserId) {
  const row = { ...(body || {}) };

  // A client never chooses identity or audit columns.
  delete row.id;
  delete row.created_at;

  // Assigned LAST so anything of the same name in the body is overwritten, not merged.
  // This is the whole security property: business_id is server-resolved, always.
  row.business_id = biz.business.id;
  row.user_id = actorUserId;

  return row;
}

module.exports = { buildReminderRow };
