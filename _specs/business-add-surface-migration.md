# Task: migrate the Add surface into the business workspace

Raised: 2026-09-10, during the AI CFO design-system migration review.
Status: **OPEN — not started.**
Workspace type: Business.
Severity: medium — a navigation dead end, not a data or isolation problem.

## The problem

`/add` is registered as `<Layout><Add /></Layout>` (`client/src/App.jsx`). `Layout`
is the **legacy** chrome: `Sidebar` + `BottomNav`, not `WorkspaceShell`.

Navigating there from anywhere in `/business/*` replaces the workspace switcher
and the business navigation with a sidebar whose six destinations are

```
/    /add    /radar    /cfo    /accounts    /settings
```

— **none** of them a `/business/*` route. Once on `/add` there is no control on
screen that returns the user to the business workspace; only the browser's Back
button does.

After a successful save, `Add.jsx` offers follow-on links to `/transactions`,
`/receivables`, `/payables` and `/payroll` (`client/src/pages/Add.jsx`, around
L430-L462) — legacy routes again, so the journey continues outside the shell.

Data is **not** at risk: `apiFetch` sends `x-business-id` from the stored active
workspace, so a transaction added here lands in the correct business. This is a
navigation and orientation defect only.

## Why AI CFO no longer points at it

The AI CFO migration briefly registered `/business/add` — the same `Add`
component wrapped in `BusinessShell` — because the page's no-data state had `/add`
as its only call to action, and a brand-new business's first click therefore
ejected it from its own workspace.

That route was **removed** during review, deliberately. It held the shell only
until the first save: `Add`'s own post-save links go straight back to the legacy
routes, so the user still ends up outside the workspace, one step later and with
less warning. A route that looks migrated and is not is worse than one that is
plainly not, because nothing downstream gets fixed while it appears done.

AI CFO now points at surfaces that already exist inside the workspace:

| Was | Now | Why |
|---|---|---|
| Empty-state CTA → `/add` | **"Set up wallets" → `/business/accounts`** | A wallet is the prerequisite every transaction needs, and Accounts is where wallets are created. |
| Quick navigation "Add Transaction" → `/add` | **"Transactions" → `/business/transactions`** | An existing workspace surface, named for what it actually is. |

## Known gap this leaves

There is currently **no way to add a transaction from inside the business
workspace shell.** `/business/transactions` is a read-and-filter view with no add
control (`client/src/pages/business/index.jsx`, `BusinessTransactions`). A user
who has wallets but no transactions can reach the transactions list from AI CFO's
quick navigation, and then has nowhere in-shell to go.

That gap is the reason this task exists. It is not hidden behind a route that
half-closes it.

## What the task has to cover

1. **A business add surface.** Either register `Add` inside `BusinessShell` **and**
   fix its internal navigation, or build a business-native add flow. Deciding
   which is part of the task.
2. **`Add.jsx`'s post-save links** (`/transactions`, `/receivables`, `/payables`,
   `/payroll`) must resolve to `/business/*` when the user arrived from a business
   workspace. They are currently unconditional.
3. **Its other in-page navigations** — `/accounts` ("add wallets in Accounts →")
   and `/settings` — have the same problem.
4. **An add control on `/business/transactions`**, or an explicit decision that
   adding happens elsewhere.
5. **The legacy `/add` route** stays reachable by direct URL for the legacy shell;
   removing it is out of scope and would break the legacy navigation.

## Not to be bundled

Not into a design PR. It changes routing and post-save destinations across a
component shared by the legacy shell and the business shell, so it needs its own
regression pass over both.

## Related

- `_specs/ai-cfo-cross-currency-cash-defect.md` — the other defect found during
  the same review, also filed rather than fixed.
- `client/src/App.jsx` — the `BusinessLayout` route group and the comment above
  it describing the "existing components rendered INSIDE the premium shell"
  pattern, which is the pattern a proper migration would follow.
