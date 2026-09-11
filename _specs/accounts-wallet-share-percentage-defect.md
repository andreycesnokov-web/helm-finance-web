# Defect: a wallet's "% share" can exceed 100% and hides a negative sign

Raised: 2026-09-11, during the Wallets & Accounts design completion.
Status: **OPEN — not fixed in the design PR, deliberately.**
Workspace type: Business.
Severity: medium — a visibly wrong figure on the Accounts list. No stored data is
affected and no total is wrong; this is the derived share percentage only.

## Not introduced by the design PR

The expression is unchanged. It was moved verbatim from `Accounts.jsx` into
`AccountsBlocks.jsx` during the restyle:

```js
// origin/main:client/src/pages/Accounts.jsx:444
const pct = grp && grp.total > 0 ? Math.round(((w.balance || 0) / grp.total) * 100) : 0

// now client/src/pages/AccountsBlocks.jsx:169-171 — same arithmetic
const pct = group && group.total > 0
  ? Math.round(((Number(balance) || 0) / group.total) * 100)
  : 0
```

What the design PR changed is that the defect is now **visible in a screenshot**:
`artifacts/design-accounts/10-accounts-stress-desktop-1440x900.png` shows a row
reading **"103% share"**. Before this PR the preview rendered no wallet list at
all, so no fixture ever exercised it.

## The two problems

### 1. A share above 100%

`group.total` is the sum of every balance in that currency group, **including
negative ones**. When a wallet in the group is overdrawn, the total shrinks below
the largest wallet and its share passes 100%.

From the stress fixture (`client/src/pages/DesignPreview.jsx`, `WALLETS_STRESS`):

| wallet | balance |
|---|---|
| Mandiri · Operating account | 148 900 000 |
| Petty cash · overdrawn | −4 250 000 |
| Escrow · unused | 0 |
| **group total** | **144 650 000** |

`148 900 000 / 144 650 000 = 1.0294` → **103% share**.

The share bar is separately clamped with `Math.min(100, …)`, so the bar and the
label disagree: the bar reads full, the label reads 103%.

### 2. `Math.abs()` hides the sign

```js
{group ? `${Math.abs(pct)}${t('accounts.share')}` : …}
```

The overdrawn wallet is −2.9% of its group's total and the row prints **"3%
share"** — indistinguishable from a wallet holding a positive 3%. The balance
beside it is correctly red, so the row carries a red negative amount next to a
positive-looking share.

`Math.abs` is also applied to the bar width, so a negative wallet draws a bar as
though it held a positive share; only its colour differs.

## Impact

- Presentation only. `walletsSummary()` and `partitionWallets()` are unaffected,
  the total-balance card is correct, and nothing is written anywhere.
- Visible whenever one currency group holds both a positive and a negative
  balance — an overdrawn account, or a wallet whose opening balance was entered
  as a correction.
- Not visible in a single-wallet group or where every balance is positive, which
  is why it survived: the previous fixtures were four positive IDR wallets.

## Why it is not fixed here

The task that produced this report says plainly: record a calculation error with
its code reference and impact, and do not repair accounting logic inside a design
PR. "Share of total" is a derived figure a user reads as a fact about their
money, and deciding what it should say when the denominator contains negatives is
a product question, not a styling one.

## What a fix has to decide

1. **What the denominator should be.** Sum of absolute values? Sum of positives
   only? Or is a share simply undefined for a group whose total is not the sum of
   its parts in the ordinary sense?
2. **Whether a negative wallet has a share at all** — and if so, whether it reads
   `−3%`, `3% (overdrawn)`, or nothing.
3. **Whether to clamp the label** as the bar already is, or to let a >100% figure
   through as a signal that something in the group is negative.
4. Whether the share is worth keeping at all on a page whose headline is already
   a per-currency total.

Whatever is chosen, the bar and the label must agree — today they do not.

## Reproducing it

No live data needed:

```
node tests/design/captureScreenshots.mjs
open artifacts/design-accounts/10-accounts-stress-desktop-1440x900.png
```

or run the gated preview at `/design-preview?shell=accounts-stress`.

## Related

- `_specs/ai-cfo-cross-currency-cash-defect.md` — cash summed across currencies
  server-side, also found during a design pass and also filed rather than fixed.
- `_specs/business-add-surface-migration.md` — the Add surface still lives in the
  legacy shell.
