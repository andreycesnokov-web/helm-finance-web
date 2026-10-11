# Incoming Payments — Production Apply + Flag-Enable Runbook (operator-run)

Apply migrations **048 + 049 + 050 together**, verify, then — and only with explicit approval —
enable `INCOMING_PAYMENTS_ENABLED`.

Status when this was written: code is **dark-deployed to `main`** (commit `5cb4e21d`),
production health OK, flag OFF/absent, **no migration applied**.

**Do not enable the flag in the same sitting as the migration unless you have time to watch it.**
The migration is inert on its own; the flag is what makes the feature reachable.

---

## Migration summary

### 048 — `incoming_payments` foundation
Creates **one table**, `incoming_payments` (32 columns), plus:
- 2 UNIQUE indexes — `incoming_payments_idempotency_uidx`
  `(business_id, source_type, COALESCE(provider,''), idempotency_key)` and
  `incoming_payments_provider_txn_uidx` `(business_id, COALESCE(provider,''),
  provider_transaction_id) WHERE provider_transaction_id IS NOT NULL`
- 4 lookup indexes (business/created_at, status, reconciliation_status, provider)
- 2 CHECK constraints — `net_consistent` (net = gross − fee − withholding when all are known)
  and `review_stamp` (reviewer and review time move together)
- 1 function + 1 trigger (`updated_at` maintenance)
- 4 foreign keys → `businesses` (RESTRICT), `wallets`, `transactions`, `debts` (SET NULL)

### 049 — bank-import provenance
**Alters `incoming_payments` only**, adding 2 nullable columns:
`bank_import_batch_id`, `bank_import_row_id` (both FK → migration 021 tables, ON DELETE SET NULL).
Plus `incoming_payments_bank_row_uidx` — UNIQUE `(business_id, bank_import_row_id)` where not
null, guaranteeing **one payment per statement line** — and one batch lookup index.

### 050 — match candidates
Creates **one table**, `incoming_payment_match_candidates`, plus:
- 1 UNIQUE index (one proposal per payment+target) and 2 lookup indexes
- 2 CHECK constraints — `one_target` and `decision_stamp`
- 1 function + 1 trigger — `fn_incoming_payment_candidate_guard`, the **cross-company guard**:
  it refuses any candidate whose target debt/transaction belongs to a different business, on
  INSERT *and* UPDATE
- 4 foreign keys → `businesses` (RESTRICT), `incoming_payments` (CASCADE), `debts`,
  `transactions` (CASCADE)

### Additive-only — confirmed
Across all three files there is **no** `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN … TYPE`,
`TRUNCATE`, `DELETE`, or `UPDATE`. Verified by grep over the branch diff. No existing table is
modified except `incoming_payments` itself (created moments earlier by 048). No backfill, no
seed. Both new tables start empty.

### They must be applied together — confirmed
Not a preference; a hard coupling:
- The API selects `bank_import_batch_id` and `bank_import_row_id` **by name** in its shared
  column list, which backs **all** `/api/incoming-payments` reads. With only 048 applied,
  PostgREST errors on the unknown column and **every incoming-payments route returns 500**.
- The review queue reads `incoming_payment_match_candidates` (050).
- 049 and 050 both depend on `incoming_payments` existing (048).

The combined script therefore wraps all three in a **single transaction**: all three apply, or
none do. There is no partially-applied state to recover from.

---

## Files

| Purpose | Path |
|---|---|
| Preflight (read-only) | `_specs/sql/incoming-payments-preflight.sql` |
| **Combined apply** | `_specs/sql/incoming-payments-apply-048-049-050.sql` |
| Postflight (read-only) | `_specs/sql/incoming-payments-postflight.sql` |

The combined script was generated from the three migration files and **verified in PGlite to
produce a byte-identical schema** to applying them individually (47 columns, 13 indexes, 47
constraints, 2 triggers), and to be idempotent on re-run.

---

## STEP 0 — Pick the production project
Supabase Dashboard → select the **production** project. Confirm the project name aloud before
continuing. Everything below is irreversible without the Step 1 restore point.

## STEP 1 — Backup / restore point  ⛔ blocker
Dashboard → **Database → Backups**.
- Confirm a recent daily backup exists, then click **Create backup** (or note the current
  **PITR** timestamp).
- ✅ Record the restore-point timestamp: `__________________`

**Do not continue until the restore point is visible.** This is the rollback strategy (§Rollback).

## STEP 2 — Preflight  ⛔ blocker
SQL Editor → New query → paste `_specs/sql/incoming-payments-preflight.sql` → Run each block.

Record the results. **STOP** if any of these hold:
- Block 1 returns **exactly one** non-null → partially-applied unit; do not proceed, investigate.
- Block 2 has **any NULL**. If `bank_import_batches` / `bank_import_rows` are NULL, **migration
  021 was never applied to this database** and 049 cannot apply — stop and raise it.
- Block 3 types differ from: `businesses.id`=uuid, `wallets.id`=uuid, `transactions.id`=bigint,
  `debts.id`=bigint, `bank_import_*.id`=uuid.
- Block 4 errors (no `gen_random_uuid()`).
- Block 6 returns any pre-existing index/function/trigger of those names.

✅ Copy the **block 5 baseline row counts** somewhere — postflight compares against them.

## STEP 3 — Apply
SQL Editor → New query → paste the **entire** contents of
`_specs/sql/incoming-payments-apply-048-049-050.sql` → **Run**.

Expected: `Success. No rows returned`.

If it errors, the whole transaction rolls back and **nothing is applied** — you are back at the
pre-apply state. Fix the cause (usually a preflight item that was skipped) before retrying.

## STEP 4 — Postflight  ⛔ blocker
SQL Editor → New query → paste `_specs/sql/incoming-payments-postflight.sql` → Run each block.

All must pass:

| # | Check | Expected |
|---|---|---|
| 1 | Both tables exist | both non-null |
| 2 | `incoming_payments` column count | **34**, and both 049 columns listed |
| 3 | Index count | **13**, and all 4 UNIQUE indexes listed |
| 4 | CHECK constraints | all **4** present |
| 5 | Foreign keys | **10** rows, delete rules as documented |
| 6 | Triggers / functions | **2** triggers, **2** functions |
| 7 | New tables empty | **0** and **0** |
| 8 | Existing row counts | **identical to preflight block 5** |

A column count below 34 or an index count below 13 means part of the unit is missing — **do not
enable the flag**, restore from Step 1 and investigate.

## STEP 5 — Health check (flag still OFF)
```
curl -s https://app.cfo-ai.site/api/health
```
✅ Healthy. The app should behave **exactly as before** — the flag is still off, so every
incoming-payments route 404s before touching the database. Applying the schema alone changes no
behaviour.

Optional confirmation that the feature is still dark:
```
curl -s -o /dev/null -w "%{http_code}\n" https://app.cfo-ai.site/api/incoming-payments
```
✅ `401` (no token) or `404` — **never** 200 or 500.

## STEP 6 — Enable the flag  ⛔ requires explicit owner approval
Only after Steps 4 and 5 pass, and only if the owner approves **in writing**:

Railway → web service → **Variables** → set `INCOMING_PAYMENTS_ENABLED=true` → redeploy/restart
(backend flags are runtime; the service must restart to pick it up).

**Prefer a non-production deploy first if one is available.**

Do **not** set this variable in the same change as anything else. Do not add any provider
credential — there are none, and none are needed: nothing in this feature calls an external API.

## STEP 7 — Smoke test (after the flag is on)
See §Smoke test plan.

## STEP 8 — Record
Append the restore-point timestamp, preflight/postflight results and the enable decision to
`_specs/PROJECT_STATE.md`.

---

## Rollback strategy

**Preferred: restore from the Step 1 backup / PITR timestamp.** This is the only rollback that
is unconditionally safe, and it is why Step 1 is a blocker.

**If the flag was enabled and something is wrong, roll back the FLAG first, not the schema.**
Set `INCOMING_PAYMENTS_ENABLED=false` and restart. That takes the feature offline instantly and
leaves the (inert) schema in place. In almost every failure this is the right move and no
schema change is needed at all — the tables are empty of anything the rest of the app reads.

**Do not write a destructive down-migration.** Dropping `incoming_payments` /
`incoming_payment_match_candidates` would destroy payment evidence if any had been recorded,
and D9 (archive-first) applies. If the schema genuinely must go and **both tables are provably
empty** (postflight block 7 = 0/0) and the flag has been off since apply, a drop is technically
safe — but it still requires explicit owner approval and a fresh backup first. It is never the
default.

**The apply itself needs no rollback**: it is a single transaction, so a failure leaves nothing
behind.

---

## Flag-enable checklist

- [ ] Restore point created and timestamp recorded (Step 1)
- [ ] Preflight run, no STOP conditions (Step 2)
- [ ] Baseline row counts recorded
- [ ] **Migrations 048+049+050 applied together, in one transaction** (Step 3)
- [ ] Postflight: all 8 checks pass, especially column count 34 and index count 13 (Step 4)
- [ ] Existing row counts unchanged vs baseline
- [ ] `/api/health` healthy with the flag still OFF (Step 5)
- [ ] `/api/incoming-payments` still 401/404 with the flag OFF
- [ ] **Explicit owner approval to enable, in writing**
- [ ] Non-production deploy tried first, if one exists
- [ ] `INCOMING_PAYMENTS_ENABLED=true` set, service restarted (Step 6)
- [ ] Smoke test passed (Step 7)
- [ ] Outcome recorded in `PROJECT_STATE.md` (Step 8)

---

## Smoke test plan (after the flag is on)

Use a **real business workspace** and an owner/CFO token. Record `business_id` and the created
payment id. The point of every check below is that this layer is **ledger-inert**: it records
evidence and books nothing.

### 1. List route responds
```
GET /api/incoming-payments        (header: x-business-id: <BUSINESS_ID>)
```
✅ `200` with `{ business_id, payments: [] }` — empty is correct, nothing has been ingested.

### 2. Create one manual draft receipt
```
POST /api/incoming-payments
{ "source_type": "manual_bank_entry", "gross_amount": 1000, "net_amount": 1000,
  "currency": "IDR", "description": "smoke test", "idempotency_key": "smoke-test-001" }
```
✅ `201`, and the returned payment has `status: "draft"`,
`reconciliation_status: "unmatched"`, `linked_transaction_id: null`, `linked_debt_id: null`.

### 3. No transaction was auto-created  ⛔ the load-bearing check
```sql
SELECT count(*) FROM transactions WHERE business_id = '<BUSINESS_ID>';
```
✅ **Identical to the count immediately before step 2.** Take that count first.

```sql
SELECT count(*) FROM debts WHERE business_id = '<BUSINESS_ID>';
```
✅ Also unchanged.

### 4. No revenue booked
✅ Open the Business dashboard / Pulse. Income, balance and runway are **unchanged** — an
incoming payment is cash evidence, not revenue, and nothing reads this table into the ledger.
✅ The wallet balance is unchanged (the receipt has no `wallet_id` and moves no money).

### 5. Business scoping
```
GET /api/incoming-payments/<PAYMENT_ID>    with x-business-id: <OTHER_BUSINESS_ID>
```
✅ `404` — not 200, and not 403. A different workspace must not be able to confirm the row even
exists.

```
GET /api/incoming-payments                 with x-business-id: <OTHER_BUSINESS_ID>
```
✅ `200` with an empty list — the smoke-test receipt must not appear.

### 6. Idempotency
Re-send the **exact** step-2 body.
✅ `200` with `idempotent_replay: true` and the **same payment id** — not a second row.

### 7. Clean up
The smoke-test row can be left in place (it is inert and visible in the review queue as an
unmatched receipt), or removed by an admin with a targeted delete recorded in
`PROJECT_STATE.md`. Do **not** leave it if the workspace is a real customer-facing one.

---

## Risks / STOP conditions

**Stop immediately and do not enable the flag if:**

1. **Preflight block 2 shows `bank_import_batches` or `bank_import_rows` missing** — migration
   021 was never applied here; 049 cannot apply and the unit is impossible as written.
2. **Preflight block 1 shows exactly one of the two tables present** — partially applied.
3. **Postflight column count ≠ 34 or index count ≠ 13** — part of the unit is missing; the API
   will 500 on every route.
4. **Postflight block 8 differs from the preflight baseline** — data changed; something other
   than this schema change ran. Restore from backup.
5. **`/api/health` degrades after the apply** — the schema change should be invisible; if it is
   not, restore.
6. **Any route returns 500 after enabling** — set the flag back to `false` and restart first,
   investigate second.

**Known risks carried into production (none blocking, all documented):**

- **Match scoring is unvalidated against real data.** The engine compares against a receivable's
  true outstanding balance; nobody has yet checked its thresholds against a real Helm Care
  statement. The amount-disqualification rule may prove too strict for customers who habitually
  underpay. It only ever *proposes*; a human accepts.
- **No UI exists.** Even with the flag on, nothing is reachable from the app — this is API-only.
  That also means the smoke test is the only way to exercise it.
- **CI never ran on this code.** It was pushed to `main` with branch protection bypassed, and
  CI triggers on pull requests, not on push to `main`. The client build in particular has not
  been exercised — low risk, since the branch touches zero client files, but unverified.
- **Agent B has not reviewed commit `0702a80f`** (the receivable-balance fix), which landed after
  its last pass.
- **The legacy bank-import path has no characterization tests** (B's P2-PRE-1). The bridge is
  covered at both confirm routes, but the ~980-line path it hooks into is not. Pre-existing.
- **Audit writes are best-effort** — a payment write and its `audit_events` row are not one
  transaction.

**External blockers — do not work around these by inventing behaviour:**
a real Midtrans settlement sample (spec Q1/Q2), real bank export formats (Q3), tax treatment per
revenue type from the accountant (Q5), and the receiving-account list plus the
`counterparties` business-scoping gap (Q4).
