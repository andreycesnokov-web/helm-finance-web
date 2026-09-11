# Defect: the Personal Accounts page reads the BUSINESS wallet endpoint

Raised: 2026-09-11, while verifying that removing the Accounts scope tabs could
not affect personal space.
Status: **OPEN — not fixed. Personal Workspace must not be enabled until it is.**
Workspace type: Personal.
Severity: high if reached — it would show a company's wallets and balances inside
the personal workspace. Currently **unreachable in production** (see below).

## The defect

`PersonalAccounts` (`client/src/pages/personal/index.jsx`, around L135) fetches:

```jsx
export function PersonalAccounts() {
  const w = useScoped('/wallets')          // ← the BUSINESS wallet endpoint
  …
  <PageHeader eyebrow="Personal Workspace" title="Accounts" …/>
```

`/api/wallets` is the business endpoint. The personal one is
`/api/personal/wallets` (`server/index.js:610`), which selects
`.eq('business_id', ws.id).eq('scope', 'personal')` against the user's **personal
workspace** row.

The resolution then makes it concrete. In a personal workspace,
`WorkspaceProvider.applyActive()` (`client/src/shell/WorkspaceProvider.jsx:37`)
does:

```js
if (w.type === 'personal') setActiveBusinessId(null)
```

so `apiFetch` sends **no** `x-business-id` header. Server-side,
`resolveActiveBusiness()` with no requested id falls through to
`ensureDefaultBusiness(userId)` — the user's **default company**.

Net effect: a page headed "Personal Workspace · Accounts" would render the
wallets, balances and per-wallet figures of the user's default **company**.

This is the personal→business direction of exactly the mixing the Accounts scope
review was checking for. The server is not at fault: `/api/wallets` behaved
correctly and returned the company whose context it was given.

## Why it is not reachable today

The entire `/personal/*` route group is gated
(`client/src/App.jsx:610`):

```jsx
{PERSONAL_FUNDING_UI ? ( …/personal, /personal/accounts, /personal/transactions… )
                     : <Route path="/personal/*" element={<Navigate to="/" replace />} />}
```

with `const PERSONAL_FUNDING_UI = import.meta.env.VITE_PERSONAL_FUNDING_UI_ENABLED === 'true'`
(`App.jsx:86`). It is a build-time flag, documented as dark, and when it is off
the routes are not registered at all — `/personal/*` redirects to `/`.

So today nobody can reach this page. The defect is latent, and it is latent in
the one place where turning a flag on is the whole activation step.

## What must happen before Personal Workspace is enabled

1. **Point the page at the personal endpoint.** `useScoped('/personal/wallets')`,
   whose response shape differs (`id, name, type, currency, color, is_active,
   sort_order` plus a computed `balance`) — the render needs checking against it,
   not just the URL swapping.
2. **Audit every other fetch under `pages/personal/`** for the same mistake.
   `PersonalOverview` and `PersonalTransactions` are in the same file and were not
   examined as part of this report.
3. **Decide what a personal workspace should do when `x-business-id` is null.**
   Falling through to `ensureDefaultBusiness()` is a reasonable default for a
   business route and a dangerous one for a personal context. A personal page
   asking a business endpoint should fail closed, not resolve to a company.
4. **An isolation test.** The mock-API harness added in PR #84
   (`tests/design/accountsMockApi.test.mjs`, `tests/design/harness/`) already
   mounts a real page against a scriptable API and asserts which workspace a
   request carried; the same shape would cover this — assert that a personal page
   never issues a request that resolves to a company.

## Not changed here

PR #84 is a design pass on the business Accounts page. It does not touch
`pages/personal/`, and the fix belongs with whoever activates Personal Workspace,
together with the isolation tests that activation needs anyway.

Verified during PR #84: no file under `client/src/pages/personal/` appears in its
diff, and `/business/accounts` renders `Accounts.jsx` while `/personal/accounts`
renders `PersonalAccounts` — two separate components. Personal Account v1 wallets
(`/api/personal/wallets`) live under a `businesses` row with `type='personal'` and
can never appear in a company's list.

## Related

- `_specs/accounts-personal-scope-ambiguity.md` — the business→personal direction:
  wallets flagged `scope='personal'` that carry a company's `business_id`.
- `_specs/accounts-wallet-share-percentage-defect.md`
- `_specs/business-add-surface-migration.md`
