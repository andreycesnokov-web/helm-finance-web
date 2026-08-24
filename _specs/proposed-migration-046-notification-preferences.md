# Proposed migration 046 — notification preferences

**Status: PROPOSAL. Not written, not applied.** The task said to stop and propose before adding
schema, so this is the proposal. No file exists in `migrations/`.

## Why a table is needed at all

The policy layer (`server/lib/notificationPolicy.js`) is finished and tested without it: it takes
preferences as an argument and defaults every category to ON. That is deliberate — the permission
half of the system is useful on its own, and it ships in this PR with nothing to migrate.

What is missing is only **persistence**. Today a user cannot turn a category off, because there is
nowhere to record that they did.

## Shape

```sql
-- Migration 046 — notification preferences (PROPOSED, NOT APPLIED)
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id, category)
);
```

Notes on the choices, since each one is a decision someone will want to revisit:

- **Rows are overrides, not state.** Absence means "not configured" → ON. The table therefore
  starts empty and nothing needs backfilling. A default of OFF would mute every existing user the
  moment the migration landed.
- **`enabled` is `NOT NULL`.** A three-state column (`true`/`false`/`NULL`) would put the "not
  configured" case in two places at once — an absent row and a NULL — and the two would drift.
- **No `CHECK` on `category`.** A CHECK constraint would have to be altered every time a category
  is added, and a stale row for a removed category is already inert: `categoryPolicy()` returns
  `null` and it is ignored. The application owns the vocabulary; `CATEGORIES` is the single list.
- **`business_id` is nullable** so a preference can be global (`NULL`) or per-business. Postgres
  treats NULLs as distinct in a primary key, so a global row and a per-business row can coexist —
  **the resolver must decide precedence explicitly** (per-business wins) rather than relying on
  which row happens to come back first. Worth settling before this is written.
- **Additive and re-runnable**, matching the project's migration invariant.

Also needed, and not written: `REVOKE ALL … FROM PUBLIC/anon/authenticated`, matching 045.

## What would follow

1. A loader that reads the table and returns the `{ [userId]: { [category]: boolean } }` map the
   resolver already accepts. The resolver itself does not change.
2. `GET`/`PUT /api/account/notification-preferences`, owner-scoped to the caller.
3. Settings UI. Categories the user's role cannot receive render **disabled with a reason** —
   `categoriesForRole()` and `unavailableReason()` already return exactly what that needs, so the
   UI never has to re-derive permission and cannot drift from the policy.

## One risk to weigh first

The loader must **fail closed on read error, but fail OPEN on absence**. Those are different
cases and the distinction is easy to lose:

- table/row absent → user has no preferences → ON (today's behaviour)
- query errored → we do not know what the user chose → do not send

Getting this backwards in either direction is bad: fail-closed-on-absence mutes everyone, and
fail-open-on-error sends notifications a user explicitly switched off. It is the same reasoning
the identity resolver uses, where `error` must never collapse into `unlinked`.
