# Defect: AI CFO cash totals are summed across currencies

Raised: 2026-09-10, during the AI CFO design-system migration.
Status: **OPEN — not fixed by that PR, and deliberately out of its scope.**
Workspace type: Business.
Severity: high — a wrong headline figure on a page whose purpose is a financial verdict.

## This is not a multi-currency feature request

The AI CFO design PR is presentation only. It adds a currency prefix to figures
that previously had none, using the same `currencyPrefix()` helper Radar uses,
and changes no server code, no query and no arithmetic.

Naming the currency does not create this defect and does not fix it. It makes an
existing, silent claim visible: the page has always shown this number, and has
always labelled it with the business's base currency in the supporting text. The
prefix moves that label next to the figure.

**Do not describe the design PR as adding multi-currency support. It does not.**
Nothing in it converts, groups or separates currencies.

## The defect

`buildAiCfoContext()` sums transaction amounts across every business wallet
without regard to each wallet's own currency, then reports the result under the
business's single `base_currency`.

### Exact sources

`buildAiCfoContext()` begins at `server/index.js:10697`. Line numbers verified
against commit `eb10e3ad`.

| What | Line | Expression |
|---|---|---|
| Wallets loaded | 10715 | `.from('wallets').select('id,name,currency,type,scope').eq('is_active', true)` — `currency` **is** selected |
| Business wallets | 10723 | `allWallets.filter(w => (w.scope \|\| 'business') === 'business')` — no currency filter |
| Income | 10742 | `bizTxs.filter(t => CASH_IN.includes(t.type)).reduce((s,t) => s + Number(t.amount_original\|\|0), 0)` |
| Expenses | 10743 | same shape, `CASH_OUT` |
| Corrections | 10744 | same shape, `type === 'correction'` |
| **Total cash** | **10745** | `const totalBalance = allIncome - allExpenses + allCorrections` |
| This month | 10754 | `bizMonthTxs`, same reduce over `amount_original` |
| Burn + runway | 10759 | `computeBurnAndRunway(bizTxs, totalBalance)` |
| Per-wallet balances | 10763 | `allWallets.map(...)`, same reduce; carries `currency` into the row but never groups by it |
| Currency label | 10818 | `base_currency: (accessData?.business \|\| {}).base_currency \|\| 'IDR'` |

The column being summed is `transactions.amount_original` — the amount **in the
transaction's own currency**. The wallet's `currency` is loaded and carried into
`walletList`, and is never consulted before adding.

So for a workspace holding an IDR wallet and a USD wallet:

```
IDR wallet:  120 000 000  (rupiah)
USD wallet:        8 000  (dollars)
totalBalance =  120 008 000  ← labelled "Rp"
```

The dollars are added to the rupiah at 1:1 and the sum is reported as rupiah.

### Affected figures

Everything downstream of `totalBalance`, which is most of the page:

- **Cash** — the flagship headline figure and its exact companion.
- **Runway** — `computeBurnAndRunway(bizTxs, totalBalance)`, so both the day count
  and the burn rate inherit the mixed sum.
- **CFO Score** — `calculateCfoScore()` reads `cash.total_balance` for the Cash
  Health factor (`bal / mExpense`) and for the Payables factor
  (`payOverdue > bal`, `payDueSoon > bal`). A wrong balance moves the weighted
  score and can move its status band.
- **AI Alert** — `calculateAiAlertStatus()` compares `bal` against overdue and
  due-soon payables.
- **Hiring Readiness** — `calculateHiringReadiness()` derives `safe_monthly_salary`
  from the same balance.
- **Risks** — the `negative_balance`, `runway_critical` and `runway_low` entries
  and their `amount` fields.
- **Monthly income / expenses / net flow** — same `amount_original` reduce over
  `bizMonthTxs`.
- **Receivables / payables totals** — `debts.remaining_amount`, summed with no
  currency check either.

### Blast radius beyond AI CFO

**Confirmed, not assumed:** `GET /api/pulse` carries the identical defect at
`server/index.js:1040-1044` —

```js
const allIncome      = (allTxs || []).filter(t => CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
const allExpenses    = (allTxs || []).filter(t => CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
const allCorrections = (allTxs || []).filter(t => t.type === 'correction').reduce((s, t) => s + Number(t.amount_original), 0);
const totalBalance = allIncome - allExpenses + allCorrections;
```

— with no currency grouping either, and without the `|| 0` guard the AI CFO copy
has. That endpoint feeds **Pulse** and **Radar** (`/api/pulse?scope=business`),
so the same wrong headline reaches all three pages. Any fix should cover both
call sites, or the pages will disagree with each other.

`computeBurnAndRunway()` (`server/index.js:924`) takes the mixed total as its
`totalBalance` argument, so runway is downstream of the defect on every page.

## Why it has not bitten yet

Production workspaces are IDR-only in practice, where reporting and native
currency coincide and the sum is exact. The defect is latent until a business
adds a wallet in another currency — which the product allows today: wallet
currency is a required, ISO-validated field (PR #80), so a USD wallet can be
created right now.

## Relationship to PR #80

PR #80 fixed exactly this class of defect on the Accounts page, and the reasoning
there applies unchanged:

> a currency is only totalled once its native balance is provable

Accounts now totals only IDR and states plainly how many wallets it left out.
`client/src/lib/walletBalanceContract.js` holds that rule and its justification.
AI CFO has no equivalent guard.

Note the two pages derive balances from **different columns**, so the fix is not
a copy-paste:

- Accounts reads `GET /api/wallets`, whose balance is `SUM(transactions.amount_idr)`
  — the IDR-reporting column.
- AI CFO reads `SUM(transactions.amount_original)` — the native column.

## What a fix has to decide

Not decided here; this is a report, and the choice is the owner's.

1. **Fail closed, like Accounts.** Total only wallets whose currency matches
   `base_currency`; report the rest separately and never in the headline. The
   CFO Score would then be computed on a provable balance, which changes scores
   for any mixed workspace — a financial-behaviour change requiring review.
2. **Refuse to score a mixed workspace.** Return `insufficient_data` for the
   affected factors, per RISKS_AND_TESTS R7 ("if deterministic data is absent,
   show `insufficient_data` or `unavailable`").
3. **Real multi-currency.** Needs a base-currency conversion layer with dated
   rates. Large, and explicitly not started — see ARCHITECTURE "PLANNED / NOT
   IMPLEMENTED".

Option 1 or 2 is the honest short-term fix. Both change reported financial
figures, so both need the financial review a design PR must not perform.

## Verification for whoever takes this

No live smoke was run — that would mean writing a foreign-currency wallet into a
real workspace. Reproduce on a disposable business:

1. Create a business with `base_currency = 'IDR'`.
2. Add an IDR wallet and a USD wallet.
3. Record `120000000` into the IDR wallet and `8000` into the USD wallet.
4. `GET /api/ai-cfo/context` and read `cash.total_balance`.
5. Expected today: `120008000`, labelled IDR. That is the bug.

## Not to be bundled

Do not fix this inside a design PR. It changes reported financial figures, the
CFO Score and the hiring recommendation, and needs its own review, its own
regression tests and an owner decision on which of the three options above the
product takes.
