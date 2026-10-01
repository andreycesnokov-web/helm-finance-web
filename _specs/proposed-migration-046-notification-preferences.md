# 046 — company-admin notification grants (BUILT) · notification preferences (deferred)

**This document once conflated two different features under one migration number. They are now
separated.** The distinction is the whole point, so it is stated up front:

| | who decides | direction | default | migration |
| --- | --- | --- | --- | --- |
| **Grants** (this PR) | the **owner**, for a CEO/CFO | opt-**in** — adds a recipient | **off** (nobody) | **046, written** |
| **Preferences** (later) | the **user**, for themselves | opt-**out** — removes themselves | **on** | later, deferred |

They must never share a table. A grant is one person deciding what *another* person may receive;
a preference is a person muting *their own* alerts. Storing them together would make "who turned
this off, the owner or the member?" unanswerable — and the answer changes whether re-enabling is a
security decision or a personal one.

## Part 1 — company-admin notification grants (migration 046, CREATED)

**Status: WRITTEN as `migrations/046_company_notification_grants.sql`. NOT applied to production.**

Table `business_member_notification_grants`: an owner grants specific financial categories to a
CEO or CFO of the same business. Additive, idempotent, starts empty, no backfill, backend-only
privileges (`REVOKE … FROM PUBLIC/anon/authenticated`, `GRANT` to `service_role`) matching 045.

Key decisions, and why:

- **`business_id NOT NULL`, no global grants.** A grant always names its business. There is no
  "grant everywhere" — that would be a cross-tenant hole by construction. This also side-steps the
  nullable-primary-key defect that sank the first preferences draft (see Part 2): with a natural
  `NOT NULL` scope the surrogate key is a convenience, not a necessity.
- **Unique `(business_id, user_id, category)`.** One row per grant; toggling UPSERTs it.
- **No role or Telegram id stored.** Role lives in `business_members` and is read fresh at send
  time, so a demotion makes a grant inert with no row to clean up. Telegram identity lives in
  `user_channel_links` (045). Copying either here would be a second source of truth that drifts —
  the exact failure the identity PRs spent months removing.
- **`enabled BOOLEAN NOT NULL`** rather than presence-means-granted: an explicit `false` row
  records a deliberate revoke and gives the audit trail a real before/after.
- **`granted_by_user_id`** records who granted, for the audit trail; `ON DELETE SET NULL` so a
  departed owner does not cascade-delete live grants.

The resolver reads these as a widening of the owner-only baseline and re-checks the member's live
role and business, so a forged or stale grant row cannot promote anyone. Default-off: the grant
map defaults every category to **false**, the mirror of the preference map's **true**.

## Part 2 — user self-service preferences (DEFERRED, not written)

**Status: PROPOSAL only. No migration file. This is a LATER task, not part of this PR.**

This is the opt-out half: a user muting their own categories. It is independent of grants and
should ship on its own, with its own migration number when it comes.

## Why a preferences table is needed (deferred)

The policy layer (`server/lib/notificationPolicy.js`) takes preferences as an argument and defaults
every category to ON. What is missing is only **persistence**. Today a user cannot turn a category
off, because there is nowhere to record that they did.

## Shape

Review caught a genuine defect in the first draft, corrected below.

**The defect:** `business_id UUID NULL` combined with `PRIMARY KEY (user_id, business_id, category)`
does not work. A primary key makes every one of its columns `NOT NULL`, so the nullable column
that was supposed to express "this preference is global" could never actually hold NULL. The
global case was unrepresentable — the schema contradicted the feature it existed for.

### Option A — surrogate key plus two partial unique indexes (recommended)

```sql
-- Migration 04X — user notification preferences (DEFERRED, later task, NOT written)
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
