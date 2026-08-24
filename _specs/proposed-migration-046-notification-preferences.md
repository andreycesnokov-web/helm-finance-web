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

Review caught a genuine defect in the first draft, corrected below.

**The defect:** `business_id UUID NULL` combined with `PRIMARY KEY (user_id, business_id, category)`
does not work. A primary key makes every one of its columns `NOT NULL`, so the nullable column
that was supposed to express "this preference is global" could never actually hold NULL. The
global case was unrepresentable — the schema contradicted the feature it existed for.

### Option A — surrogate key plus two partial unique indexes (recommended)

```sql
-- Migration 046 — notification preferences (PROPOSED, NOT APPLIED)
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category    TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One business-scoped preference per (user, business, category).
CREATE UNIQUE INDEX IF NOT EXISTS user_notification_prefs_biz_uidx
  ON user_notification_preferences (user_id, business_id, category)
  WHERE business_id IS NOT NULL;

-- One global preference per (user, category).
CREATE UNIQUE INDEX IF NOT EXISTS user_notification_prefs_global_uidx
  ON user_notification_preferences (user_id, category)
  WHERE business_id IS NULL;
```

Two partial indexes rather than one constraint, because a plain `UNIQUE(user_id, business_id,
category)` would not constrain the global rows at all: Postgres treats NULLs as distinct, so a
user could accumulate any number of contradictory global rows for the same category. This is the
same partial-unique-index shape migration 045 already uses for active channel links, so the
pattern is established in this codebase rather than novel.

### Option B — two tables

```sql
CREATE TABLE user_notification_preferences_global (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
CREATE TABLE user_notification_preferences_business (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category TEXT NOT NULL, enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id, category)
);
```

Both keys are natural and neither column is nullable, so the ambiguity cannot arise. The cost is
two tables, two loaders and two endpoints for one concept.

**Recommendation: Option A.** It keeps one table and one query, and the constraint it needs is a
pattern already in use here. Option B is the safer choice only if the two kinds of preference are
expected to diverge in shape later, which nothing currently suggests.

### Unchanged from the first draft

- **Rows are overrides, not state.** Absence means "not configured" → ON. The table starts empty
  and nothing needs backfilling. A default of OFF would mute every existing user on deploy.
- **`enabled` is `NOT NULL`** — a three-state column would put "not configured" in two places at
  once (absent row, NULL value) and the two would drift.
- **No `CHECK` on `category`** — it would need altering for every new category, and a stale row
  is already inert (`categoryPolicy()` returns `null`). The application owns the vocabulary.
- **Additive and re-runnable**, matching the project's migration invariant.
- `REVOKE ALL … FROM PUBLIC/anon/authenticated`, matching 045.

### Precedence, which now has to be decided

With both kinds of row representable, the loader must define which wins. Proposed: **the
business-scoped row wins where one exists, otherwise the global row, otherwise ON.** This needs to
be settled before the migration is written, not discovered later from whichever row a query
happened to return first — that ordering assumption is exactly what produced the cross-tenant
notification bug this branch just fixed.

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

---

## Follow-up: `notifyBusinessAdminsViaTelegram` is now misnamed

Not changed in this branch — renaming a function with five call sites during a security fix adds
diff noise to the change that most needs to be read closely.

The name dates from when the function fanned out to `['owner','ceo','admin','cfo']`. Admins are no
longer default recipients of anything financial: the audience is active owners of the named
business. A reader who trusts the name will believe admins are notified, which is now false.

Suggested rename: `notifyBusinessOwnersViaTelegram`, or `sendCategorizedTelegramNotification` if
the audience is expected to widen again once preferences ship. The first positional parameter
`ownerUserId` should go at the same time — it no longer selects recipients and is retained only
for log context, which is precisely the shape that invites someone to route by it again.
