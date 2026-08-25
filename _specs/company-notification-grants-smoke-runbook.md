# Company Notification Grants — Smoke & Concurrency Runbook (PR46.2)

**Status:** prepared for review. **Nothing here has been run against production.**
**Verdict:** ✅ **DISPOSABLE PostgreSQL / Supabase ONLY.** ⛔ **NEVER run the smoke in production.**

- Migrations under test: `046_company_notification_grants.sql` + `047_notification_grants_actor_authorization.sql`
  (both live in production; the smoke requires **both** applied to the disposable DB).
- Smoke: [`_specs/sql/company-notification-grants-smoke.sql`](sql/company-notification-grants-smoke.sql)
- Residue check: [`_specs/sql/company-notification-grants-residue-check.sql`](sql/company-notification-grants-residue-check.sql)
- Both feature flags remain **OFF**. This runbook enables nothing, applies nothing, deploys nothing.

---

## 1. ⛔ Why never in production — two independent blockers

### A. `BIGSERIAL` sequence advancement is not transactional
`business_member_notification_grants.id` is `BIGSERIAL`. `nextval()` fires on every `INSERT`
(including `INSERT … ON CONFLICT`, which evaluates the column default **before** detecting the
conflict) and is **never rolled back** — this is documented PostgreSQL behaviour, not a quirk.

The smoke's grant/revoke operations perform several such inserts, so the sequence **advances and
does not undo** on `ROLLBACK`. Measured on a disposable Postgres (PGlite) with 046+047:
```
grants sequence: before=1 after=5 (advanced by 4, survives ROLLBACK)
RESIDUE (synthetic-scoped): {users:0, biz:0, members:0, grants:0, grant_audit:0}
```
Rows roll back cleanly (zero synthetic residue); the sequence does not. The exact advance depends on
how many grant inserts run and on `ON CONFLICT` `nextval` timing — do **not** treat a specific number
as a contract; the point is only that **it advances and cannot be undone in-transaction**. A
production run is therefore not residue-free. We do **not** `setval()` to "reset" it (a gap in a
surrogate key is harmless, and resetting a sequence is itself a mutation).

### B. Supabase SQL Editor rollback semantics are not guaranteed
Data safety holds regardless — an aborted Postgres transaction can only roll back, never commit — but
the web SQL Editor's handling of a hand-authored `BEGIN…ROLLBACK` with a mid-script assertion failure
is version-dependent and undocumented for this shape. Do **not** rely on it. Run deterministically:
```bash
psql "$DISPOSABLE_URL" -v ON_ERROR_STOP=1 -f _specs/sql/company-notification-grants-smoke.sql
psql "$DISPOSABLE_URL" -f _specs/sql/company-notification-grants-residue-check.sql   # all synthetic cols = 0
```

---

## 2. What the smoke covers (all baseline-relative on audit)

Every audit assertion is a **before/after delta** scoped to the two synthetic businesses, so the
smoke is correct even on a **non-empty** disposable DB (a sanitised production copy). Verified: a
pre-seeded, non-synthetic `notification_grant` audit row was left untouched (before=1, after=1).

| # | Assertion | Result on disposable DB |
|---|---|---|
| 1 | Owner grants **CFO** (positive) — enabled, +1 `granted` | ✅ |
| 2 | Owner grants **CEO** (positive) — enabled, +1 `granted` | ✅ |
| 3 | Denied targets **manager, accountant, employee** — `member_not_grantable`, **+0 audit** | ✅ |
| 4 | **Non-owner actor** (047) — `actor_not_authorized`, **+0 audit** | ✅ |
| 5 | Cross-business — `member_not_grantable`, **+0 audit** | ✅ |
| 6 | **INACTIVE** target (dedicated member) — `member_not_grantable`, **+0 audit** | ✅ |
| 7 | **REMOVED** target (dedicated member, separate from #6) — `member_not_grantable`, **+0 audit** | ✅ |
| 8 | Transition **auto-revoke** — grant disabled, +1 `auto_revoked` (NULL/system actor); re-promotion does not restore | ✅ |
| 9 | Same-value update preserves a valid grant | ✅ |
| 10 | **Revoke** (+1 `revoked`) then **idempotent** repeat (+0 audit) | ✅ |
| 11 | Unknown category — `unknown_category`, no row, **+0 audit** | ✅ |

Denied roles now include **employee/staff** (not just manager/accountant); **inactive and removed**
are separate dedicated members; forbidden attempts assert **no new audit event**.

Not in the SQL smoke — the two concurrency cases, which need two sessions (§3).

---

## 3. Two-session concurrency procedure (disposable DB only)

The `FOR UPDATE` locks — on the **target** row (046) and the **actor** row (047) — only manifest with
concurrent sessions. Open two `psql` sessions (A and B) against the **same disposable** database.
Each scenario uses its **own dedicated members** so scenarios never leave a fixture broken for the
next — in particular scenario 3 uses two different owners so the actor-demotion in 3a does not spoil
the owner→manager race in 3b.

> ⚠️ **How to read the "PGlite" note below vs this procedure.** The final states in every table
> below have been checked against real PostgreSQL semantics (via PGlite), but **PGlite is a single
> in-process connection: it validates the FINAL STATE only. It does NOT — and cannot — prove real
> lock BLOCKING between two separate database connections.** The blocking rows below ("**BLOCKS**")
> must be verified **manually** in a disposable PostgreSQL / Supabase database using **two separate
> psql sessions**, exactly as laid out. **Never run any of this in production.**

The UUID is **inlined** in every statement below so each line is copy-paste runnable in `psql` as-is
(no `\set`/`:var` needed, which would otherwise have to be re-declared in each session).

### Common fixture (session A, committed — disposable DB only)
```sql
INSERT INTO users (id) VALUES (-9990001001),(-9990001002),(-9990001003),(-9990001004),(-9990001005);
INSERT INTO businesses (id, owner_user_id, name) VALUES
  ('dede0000-0000-0000-0000-0000000000c1', -9990001001, 'CONC Co');
INSERT INTO business_members (business_id, user_id, role, status) VALUES
  ('dede0000-0000-0000-0000-0000000000c1', -9990001001, 'owner', 'active'),  -- owner/actor (scenarios 1, 2)
  ('dede0000-0000-0000-0000-0000000000c1', -9990001002, 'cfo',   'active'),  -- TARGET for scenarios 1, 3
  ('dede0000-0000-0000-0000-0000000000c1', -9990001003, 'cfo',   'active'),  -- TARGET for scenario 2
  ('dede0000-0000-0000-0000-0000000000c1', -9990001004, 'owner', 'active'),  -- actor for scenario 3a
  ('dede0000-0000-0000-0000-0000000000c1', -9990001005, 'owner', 'active');  -- actor for scenario 3b (fresh owner)
```
Cleanup at the end: `DELETE` the CONC Co rows on the disposable DB, or just discard the whole
disposable environment.

### Scenario 1 — TARGET demotion vs grant (046 target lock)
Target = CFO `-9990001002`, actor = owner `-9990001001`.

| Step | Session A | Session B |
|---|---|---|
| 1 | `BEGIN;` `SELECT apply_notification_grants('dede0000-0000-0000-0000-0000000000c1', -9990001002, -9990001001, 'owner', '{"company_financial":true}'::jsonb);` — takes the **target** row lock, not yet committed | |
| 2 | | `BEGIN;` `UPDATE business_members SET role='manager' WHERE business_id='dede0000-0000-0000-0000-0000000000c1' AND user_id=-9990001002;` — **BLOCKS** on A's target-row lock |
| 3 | `COMMIT;` — grant committed (enabled) | |
| 4 | | unblocks; its trigger disables the just-made grant; `COMMIT;` |

**Expected blocking:** B blocks at step 2 until A commits.
**Expected final state:** `enabled = false` for `-9990001002` `company_financial`; **one** `granted`
audit then **one** `auto_revoked` audit. No enabled stale grant.

### Scenario 2 — TARGET demotion first, then grant refused
Target = CFO `-9990001003`.

| Step | Session B | Session A |
|---|---|---|
| 1 | `BEGIN;` `UPDATE business_members SET role='manager' WHERE business_id='dede0000-0000-0000-0000-0000000000c1' AND user_id=-9990001003;` — takes the target row lock | |
| 2 | | `BEGIN;` `SELECT apply_notification_grants('dede0000-0000-0000-0000-0000000000c1', -9990001003, -9990001001, 'owner', '{"company_financial":true}'::jsonb);` — **BLOCKS** on B's lock (target `FOR UPDATE`) |
| 3 | `COMMIT;` | |
| 4 | | unblocks, re-reads role='manager', **raises `member_not_grantable`**; `ROLLBACK;` |

**Expected final state:** no grant row enabled for `-9990001003`; no audit written by A.

### Scenario 3 — ACTOR demotion vs grant (047 actor lock)
Target = CFO `-9990001002`. Scenario 1 demoted `-9990001002` to manager, so **reset it to an active
CFO first, and COMMIT** before scenario 3 (session A):
```sql
UPDATE business_members SET role='cfo', status='active'
  WHERE business_id='dede0000-0000-0000-0000-0000000000c1' AND user_id=-9990001002;
-- COMMIT (or run outside a transaction) so both sessions see the reset.
```

**3a — grant-first (actor = owner `-9990001004`):**
| Step | Session A | Session B |
|---|---|---|
| 1 | `BEGIN;` `SELECT apply_notification_grants('dede0000-0000-0000-0000-0000000000c1', -9990001002, -9990001004, 'owner', '{"tax_compliance":true}'::jsonb);` — takes the **actor** row lock (`-9990001004`) | |
| 2 | | `BEGIN;` `UPDATE business_members SET role='manager' WHERE business_id='dede0000-0000-0000-0000-0000000000c1' AND user_id=-9990001004;` — **BLOCKS** on A's actor-row lock |
| 3 | `COMMIT;` — grant made while actor was still a valid owner | |
| 4 | | unblocks; demotes the (now ex-)owner; `COMMIT;` |

**Expected final state:** the `tax_compliance` grant for `-9990001002` **stands** — it was an
authorised-at-the-time decision; the actor's later demotion does not retroactively void it.

**3b — actor-demotion-first (actor = fresh owner `-9990001005`, still an owner):**
| Step | Session B | Session A |
|---|---|---|
| 1 | `BEGIN;` `UPDATE business_members SET role='manager' WHERE business_id='dede0000-0000-0000-0000-0000000000c1' AND user_id=-9990001005;` — takes the **actor** row lock (a real owner→manager demotion) | |
| 2 | | `BEGIN;` `SELECT apply_notification_grants('dede0000-0000-0000-0000-0000000000c1', -9990001002, -9990001005, 'owner', '{"documents_review":true}'::jsonb);` — **BLOCKS** on B's lock (actor `FOR UPDATE`) |
| 3 | `COMMIT;` — the owner `-9990001005` is now a manager | |
| 4 | | unblocks, re-derives the actor's role = 'manager', **raises `actor_not_authorized`**; `ROLLBACK;` |

**Expected final state:** no `documents_review` grant; a just-demoted owner cannot slip a grant
through. (3b uses `-9990001005`, a still-owner at step 1, so this is a genuine owner→manager
demotion race — not a manager who was already demoted by 3a.)

**No deadlock in normal use:** the API only ever calls the RPC as an owner granting a *distinct*
CEO/CFO, so the actor row (an `owner` row) and the target row (a `ceo`/`cfo` row) are disjoint and
cannot be locked in opposite order by two callers. Pathological direct `service_role` misuse could in
principle deadlock; PostgreSQL then aborts one transaction, and since everything is one transaction,
atomicity is preserved.

---

## 4. How to run — summary (disposable only)
1. Provision a throwaway Postgres/Supabase (or `supabase start`).
2. Create the base tables (`users`, `businesses`, `business_members`, `audit_events`) — or restore a
   sanitised copy — then apply **046 then 047**.
3. Smoke: `psql … -v ON_ERROR_STOP=1 -f …-smoke.sql` → ends with `all … PASSED`.
4. Residue: `psql … -f …-residue-check.sql` → every synthetic column `0`.
5. Concurrency: run §3 scenarios 1, 2, 3a, 3b in two sessions.
6. Discard the disposable environment (the advanced sequence dies with it).

**Never point any of this at production. Never enable either flag as part of the smoke.**

---

## 5. Unavoidable side effects (disclosure)
- `business_member_notification_grants_id_seq` advances and does **not** roll back — the sole reason
  (with §1B) the smoke is disposable-only. Irrelevant on a throwaway DB.
- No other sequence advances (businesses/members/audit ids are UUID; synthetic user ids are explicit).
- No rows persist after `ROLLBACK` (measured: zero synthetic residue).
- Pre-existing, non-synthetic data is untouched (measured: baseline audit row preserved).
- No `COMMIT`/`DELETE`/`TRUNCATE`/`DROP`/`ALTER`/`setval` in either SQL file.
