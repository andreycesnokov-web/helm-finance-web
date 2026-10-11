# Ambiguity: `wallets.scope = 'personal'` on a company-owned wallet

Raised: 2026-09-11, verifying the Accounts scope tabs before removing them.
Status: **OPEN — code paths established, production data NOT inspected.**
Workspace type: Business.
Severity: to be determined — depends on whether any such row exists, which this
report cannot answer.

## What was verified in code

### The API selection is reliable

`GET /api/wallets` (`server/index.js:8807`) is restricted to the active company
and cannot reach a personal workspace:

- `requireBusiness()` → `resolveActiveBusiness()`
  (`server/lib/businessResolver.js:46`) throws `business_workspace_required` for
  any workspace with `businesses.type = 'personal'`. A personal workspace can
  never be the active business for this endpoint.
- `bizOrFilter()` (`server/index.js:875-884`) returns exactly
  `business_id.eq.<active business id>`. The legacy `business_id IS NULL` union
  was removed deliberately, with the comment noting it "only risked leaking one
  business's (or orphaned) rows into another business the same user owns".
- The wallet query adds no other predicate than `.eq('is_active', true)`.

So every row the page receives is linked to the selected company by
`business_id`, which is the only column that establishes ownership.

### The `scope` column does not establish ownership

`wallets.scope` was added by migration `007_wallet_scope.sql` as
`TEXT NOT NULL DEFAULT 'business' CHECK (scope IN ('business','personal'))`. It
is a label, not a foreign key, and nothing constrains it against `business_id`.

**Two code paths put `scope='personal'` on a row carrying a company's
`business_id`:**

1. **Migration 017 backfill** (`017_business_scoped_financial_data.sql`):

   ```sql
   WITH default_biz AS (
     SELECT DISTINCT ON (owner_user_id) owner_user_id, id AS business_id
     FROM businesses ORDER BY owner_user_id, created_at ASC
   )
   UPDATE wallets w SET business_id = db.business_id
   FROM default_biz db WHERE w.user_id = db.owner_user_id AND w.business_id IS NULL;
   ```

   There is **no `scope` predicate**. Every wallet a user owned — including any
   created as `scope='personal'` after migration 007 — was assigned that user's
   earliest-created business. This is the path most likely to have produced such
   rows, and it ran against real data.

2. **`POST /api/wallets`** (`server/index.js:8852-8864`) accepts
   `scope: 'personal'` and writes it into the **active business** when the
   backend flag `PERSONAL_WORKSPACE_ENABLED` is true:

   ```js
   const walletScope = (scope === 'personal' && PERSONAL_WORKSPACE_ENABLED) ? 'personal' : 'business';
   ```

   The flag is off by default and documented as "the old within-business wallet
   scope" (`server/index.js:71-73`). Its value in production is not readable from
   the repository.

Note what is **not** a source: Personal Account v1. `GET /api/personal/wallets`
(`server/index.js:610-619`) selects `.eq('business_id', ws.id).eq('scope','personal')`
where `ws` is the user's **personal workspace** — a separate `businesses` row
with `type='personal'`. Those wallets carry a different `business_id` and can
never appear in a company's list.

### Transactions

`transactions` carries both `wallet_id` and `business_id`, and the same 017
backfill assigned transactions by `user_id` with no scope predicate. A
personal-scoped wallet holding a company `business_id` can therefore have
transactions that are themselves company-scoped, and those transactions are what
`GET /api/wallets` sums into that wallet's balance
(`server/index.js:8827-8843`).

## What this means for the page

The scope tabs defaulted to **All**, and the total-balance card totalled the
**filtered** collection. So on the page's default view, a `scope='personal'` row
carrying the company's `business_id` was **already included in the company's
total balance** before this change. Removing the tabs does not add it — it was
never excluded by default.

What removing the tabs does change: the reader loses the ability to *switch* to a
Business-only view and see a total that excludes such rows.

**Mitigation applied in PR #84:** the Business/Personal chip stays on every wallet
row. The flag remains visible per wallet; only the filter is gone. Nothing is
hidden, reclassified, deleted, or re-totalled.

## The open question this report cannot close

**Do any rows with `scope='personal'` and a company `business_id` actually
exist?** That needs a read against production, which was deliberately not
performed. The read-only query is:

```sql
-- Company-owned wallets flagged personal, and whether they carry money.
SELECT w.id, w.name, w.scope, w.currency, w.business_id,
       b.name AS business_name, b.type AS business_type,
       COUNT(t.id) AS tx_count
FROM wallets w
JOIN businesses b ON b.id = w.business_id
LEFT JOIN transactions t ON t.wallet_id = w.id
WHERE w.scope = 'personal'
  AND b.type <> 'personal'
  AND w.is_active
GROUP BY w.id, w.name, w.scope, w.currency, w.business_id, b.name, b.type
ORDER BY tx_count DESC;
```

An empty result means the tabs were filtering nothing and their removal is purely
a simplification. A non-empty result means some company balances include wallets
someone labelled personal, and that is a **data question, not a design one**:

- Are they genuinely company money that was mislabelled (an expense card, a
  petty-cash float) — in which case the label is wrong and should be corrected?
- Or genuinely personal money that migration 017 pulled into a company — in which
  case the `business_id` is wrong, and the money should not be in the company
  total at all?

Nothing in the wallet row distinguishes the two. `created_by_user_id` and
`entity_name` may help a human decide; neither is authoritative.

## What must NOT be done about it

- Do not delete, re-flag or re-parent any wallet.
- Do not change the balance computation to exclude `scope='personal'` rows: that
  would silently change a company's reported total, and for case (a) above it
  would be wrong.
- Do not treat the flag as proof of ownership in either direction.

## Related

Two other findings from the same page, filed separately:

- `_specs/accounts-wallet-share-percentage-defect.md` — the per-wallet share can
  exceed 100% and hides the sign of a negative balance.
- `_specs/business-add-surface-migration.md` — `/add` and `/accounts/:id` both
  drop the user into the legacy shell.

Fixed inside PR #84 because it defeated the page's own purpose: the wallet list
did not re-fetch when the company was switched (`useEffect(..., [])` while
`switchTo()` bumps `scopeKey` without remounting), so the previous company's
wallets, balances and total stayed on screen under the new company's name. The
API was correct throughout; the client simply never asked again.
