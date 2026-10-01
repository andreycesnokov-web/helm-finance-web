# CFO AI Telegram Bot

Companion bot for the CFO AI web app. It is a **thin interface** — it never
touches the database, only calls the backend with the `x-bot-secret` header.

## Run

```bash
cd helm-finance-bot
npm install
cp .env.example .env   # fill BOT_TOKEN, CFO_API_URL, TELEGRAM_WEBHOOK_SECRET
npm start
```

Requires Node 18+ (uses global `fetch`).

## Environment

| Var | Where | Notes |
|---|---|---|
| `BOT_TOKEN` | bot | From @BotFather |
| `CFO_API_URL` | bot | Backend base URL, no trailing slash |
| `TELEGRAM_WEBHOOK_SECRET` | bot **and** web | Must match on both sides; falls back to `BOT_TOKEN` if unset |
| `TELEGRAM_BOT_USERNAME` | web | e.g. `HCfinance_Bot` — used to build deep links |

## Flows

1. **Connect** — user opens `https://t.me/<bot>?start=cfo_<memberId32>_<hmac10>`
   from the web tutorial → bot calls `POST /api/telegram/connect`.
2. **Company selection** — `/company` or any ambiguous write calls
   `GET /api/telegram/active-business?telegram_id=...` and shows inline company
   buttons when the user belongs to more than one business. The selected company
   is saved through `POST /api/telegram/active-business`, then the pending action
   is retried.
3. **Clarification** — if the parser is uncertain, the bot asks with inline
   buttons: Expense / Income / Payable / Receivable.
4. **Training** — messages starting with `TEST:` / `ТЕСТ:` are classified
   (payable / receivable / expense_request) and sent to
   `POST /api/team/onboarding/training-submission` (`is_training=true`, no cash impact).
5. **Real** — non-TEST financial messages call `POST /api/debts/from-telegram`
   → pending-approval record (owner/admin approves in the web app).
6. **Role-aware help/menu** — employees get expense-recording guidance only.
   Reports/balances are blocked for employees and remain web-only for managers
   until dedicated backend report endpoints exist.

## Limitations (V1)

- Live multi-business selection requires backend migration 043 and
  `TELEGRAM_ACTIVE_BUSINESS_ENABLED=true`. If that backend flag is off, the bot
  fails closed with a clear message instead of guessing a company.
- No inline Approve/Reject callback buttons from this bot process yet.
- No voice / photo / invoice OCR.
- No Telegram report/balance payloads yet; managers are directed to the web app.
- Heuristic NLP parser (keywords + simple amount/date), not a full model.
