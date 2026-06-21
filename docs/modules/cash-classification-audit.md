# Cash-Classification Call-Site Audit

All backend financial cash-direction logic routes through the single source of truth
[`server/lib/transactionClass.js`](../../server/lib/transactionClass.js)
(`CASH_IN_LEGACY = ['income']`, `CASH_OUT_LEGACY = ['expense','payroll']`).

**Reconciling the report counts:** there are **10 array constants** (`CASH_IN`/`CASH_OUT`
pairs) defined across **9 source lines** (one line, the reports zone, defines both on a
single line), grouped into **6 functional zones**. "9 sites replaced" = 9 edited lines;
"10 call sites" = 10 array constants; "six zones" = the functional grouping below.

| file | line / function | old logic | new module call | financial output affected |
|------|-----------------|-----------|-----------------|---------------------------|
| server/index.js | 230 — burn/runway helper | inline `const CASH_OUT = ['expense','payroll']` | `TX.CASH_OUT_LEGACY` | burn rate & runway input (monthly expense series) |
| server/index.js | 331 — `totalBalance`/Pulse | inline `const CASH_IN = ['income']` | `TX.CASH_IN_LEGACY` | total business cash, Pulse income |
| server/index.js | 332 — `totalBalance`/Pulse | inline `const CASH_OUT = ['expense','payroll']` | `TX.CASH_OUT_LEGACY` | total business cash, Pulse expense, per-source balance map |
| server/index.js | 2232 — Bank Import module | inline `const CASH_IN_TYPES = ['income']` | `TX.CASH_IN_LEGACY` | bank-import signed direction / reconcile |
| server/index.js | 4875 — wallet balances | inline `const WALLET_CASH_IN = ['income']` | `TX.CASH_IN_LEGACY` | per-wallet native balance (also reused L5293, L5787) |
| server/index.js | 4876 — wallet balances | inline `const WALLET_CASH_OUT = ['expense','payroll']` | `TX.CASH_OUT_LEGACY` | per-wallet native balance (also reused L5294, L5788) |
| server/index.js | 6096 — AI CFO context | inline `const CASH_IN = ['income']` | `TX.CASH_IN_LEGACY` | AI CFO cash figures, personal balance |
| server/index.js | 6097 — AI CFO context | inline `const CASH_OUT = ['expense','payroll']` | `TX.CASH_OUT_LEGACY` | AI CFO cash figures, personal balance |
| server/index.js | 6307 — reports/summary | inline `const CASH_IN = ['income'], CASH_OUT = ['expense','payroll']` | `TX.CASH_IN_LEGACY`, `TX.CASH_OUT_LEGACY` | report signed totals, revenue, operating expenses |

**Functional zones (6):** burn/runway · totalBalance+Pulse · Bank Import · wallet balances · AI CFO context · reports/summary.

## Repository-wide search results (backend)
- `CASH_IN` / `CASH_OUT` — only the 10 documented constants + the module definition. No inline literals remain.
- `['income']` / `['expense','payroll']` — backend: only inside `transactionClass.js`. (Frontend: `Add.jsx` form dropdown — not classification; `WalletDetail.jsx` migrated to `client/src/lib/money.js`.)
- `Number(amount_idr` — **0 matches**.
- `parseFloat(amount` — **0 matches**.
- `Number(amount` — remaining matches are input-validation / payment-amount parsing on request payloads (`isNaN` guards, payment value), **not** ledger classification or balance math.

**Conclusion:** no undocumented backend financial classification remains.

> NOTE: the legacy wallet-balance sites (4909/5293/5787) still read `amount_idr` as the
> reporting figure for display. This is intentional back-compat (legacy rows have
> `amount_reporting = amount_idr`); the universal source of truth going forward is
> `amount_reporting` + `reporting_currency`.
